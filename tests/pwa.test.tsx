// PWA wiring: the manifest, the service worker, and the install prompt.
//
// The point of these tests is not that the files exist. It is that the two
// things which silently break a PWA are covered: a manifest that names a file
// the build does not emit, and a service worker whose caching rules contradict
// the _headers rules. Both failures are invisible until a real phone is offline
// on a bad connection, which is exactly when nobody is testing.
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import manifest from "../app/manifest.ts";
import InstallPrompt from "../components/InstallPrompt.tsx";
import { SKIP_WAITING, SW_URL } from "../lib/serviceWorker.ts";
import { assert } from "./helpers.ts";

const ROOT = resolve(".");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

test("manifest is installable", () => {
  const m = manifest();

  // The MetadataRoute.Manifest type marks most fields optional because a real
  // manifest may omit them, but every field this app relies on is required for
  // installability. Narrowing here means each assertion below is a real check
  // rather than an optional-chain no-op that passes vacuously.
  const shortName = m.short_name ?? "";
  const startUrl = m.start_url ?? "";
  const scope = m.scope ?? "";

  // name is what the launcher shows under the icon; short_name is what the
  // home screen label uses, and it is truncated hard on Android. Over ~12
  // characters it gets cut off mid-word.
  assert(shortName.length > 0, "manifest.short_name is required");
  assert(shortName.length <= 12, `short_name too long: ${shortName}`);
  assert(!!m.name, "manifest.name is required");
  assert(m.display === "standalone", "display must be standalone to open without browser chrome");

  // A start_url with no leading slash can resolve to a directory index the CDN
  // does not serve, which is why trailingSlash is on in next.config.ts.
  assert(startUrl.startsWith("/"), "start_url must be a root-relative path");
  assert(
    !startUrl.includes("#"),
    "start_url must not contain a fragment; it is stripped before the request",
  );

  // scope must cover every route, or /privacy/ and /terms/ stay uncached
  // offline while / appears to work.
  assert(scope === "/", `scope must be / to cover every route, got ${scope}`);
});

test("every manifest icon exists and is the size it claims", () => {
  // ?? [] rather than a bare loop: `icons` is optional in the type, and an
  // optional chain here would make the whole test pass on a manifest with no
  // icons at all, which is the exact failure it exists to catch.
  const icons = manifest().icons ?? [];
  assert(icons.length > 0, "manifest declares no icons");

  for (const icon of icons) {
    const src = icon.src ?? "";
    assert(src.startsWith("/"), `icon src must be root-relative: ${src}`);
    const path = resolve(ROOT, "public", src.replace(/^\//, ""));
    assert(existsSync(path), `manifest icon missing from public/: ${src}`);

    const declared = Number((icon.sizes ?? "").split("x")[0]);
    assert(Number.isFinite(declared), `icon has no usable size: ${src}`);

    // Read the PNG header to confirm the real dimensions. A manifest that lies
    // about size is rejected by some launchers, and a 0-byte placeholder passes
    // an existsSync check while rendering as nothing.
    const buf = readFileSync(path);
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    assert(isPng, `icon is not a PNG: ${icon.src}`);
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    assert(
      width === declared && height === declared,
      `${src} is ${width}x${height} but the manifest declares ${icon.sizes}`,
    );
  }
});

test("manifest ships both any and maskable icons", () => {
  const purposes = (manifest().icons ?? []).map((i) => i.purpose ?? "any");
  assert(purposes.includes("any"), "no purpose=any icon; some launchers require one");
  // Without a maskable icon Android crops a square icon to its own shape and
  // can cut through the middle of the logo.
  assert(purposes.includes("maskable"), "no maskable icon; the launcher may crop the mark");
});

test("manifest background and theme colours match the app", () => {
  const m = manifest();
  const css = read("app/globals.css");
  const layout = read("app/layout.tsx");
  const bg = m.background_color ?? "";
  const theme = m.theme_color ?? "";
  assert(bg.length > 0, "manifest.background_color is required");
  assert(theme.length > 0, "manifest.theme_color is required");

  // The manifest background fills the splash screen before any CSS loads, so a
  // mismatch is a visible flash of one colour then another on every cold start.
  assert(css.includes(bg), `background_color ${bg} does not appear in globals.css`);

  // The viewport themeColor paints the browser chrome. It has to agree with the
  // manifest too, or the status bar and the splash disagree with each other.
  assert(
    layout.includes(theme),
    `theme_color ${theme} does not appear in the viewport themeColor in layout.tsx`,
  );
});

test("manifest shortcuts point at real routes", () => {
  for (const shortcut of manifest().shortcuts ?? []) {
    const path = (shortcut.url ?? "").split("?")[0];
    assert(path.startsWith("/"), `shortcut url must be root-relative: ${shortcut.url}`);
    // The app keeps its screen in local state and reads no query parameter, so
    // a shortcut can only open the shell; anything else would be a dead end.
    assert(path === "/", `shortcut ${shortcut.name} must stay on the app shell: ${path}`);
  }
});

test("service worker exists at the registered url", () => {
  assert(SW_URL === "/sw.js", `unexpected service worker url: ${SW_URL}`);
  assert(
    existsSync(resolve(ROOT, "public", "sw.js")),
    "public/sw.js must exist; registration points at /sw.js",
  );
});

test("service worker never caches HTML forever or replays non-GET", () => {
  const sw = read("public/sw.js");

  // The single most damaging mistake in an offline-first app: caching a
  // navigation response with a long max-age, so a deploy never reaches anyone.
  assert(
    /request\.method\s*!==\s*["']GET["']/.test(sw),
    "fetch handler must ignore non-GET requests",
  );
  assert(
    /url\.origin\s*!==\s*self\.location\.origin/.test(sw),
    "fetch handler must decline other origins, especially the Supabase API",
  );
  assert(
    /event\.request\.mode\s*===\s*["']navigate["']|request\.mode\s*===\s*["']navigate["']/.test(sw),
    "navigations must be handled explicitly",
  );
  // cache-first for a page shell means users are stuck on an old version.
  assert(
    /handleNavigation/.test(sw),
    "navigations should be handled by a network-first helper",
  );
});

test("service worker precaches a usable offline shell", () => {
  const sw = read("public/sw.js");
  for (const url of ["/", "/index.html", "/offline.html"]) {
    assert(sw.includes(`"${url}"`), `offline shell does not precache ${url}`);
  }
  assert(
    existsSync(resolve(ROOT, "public", "offline.html")),
    "public/offline.html must exist; it is the last-resort fallback",
  );
});

test("offline page is self-contained", () => {
  const html = read("public/offline.html");
  assert(/<style>/.test(html), "offline page must inline its CSS; a linked sheet may fail to load");
  // A script tag here would be a liability: the page has to work when the app's
  // own bundle is exactly what failed to load.
  assert(!/<script/i.test(html), "offline page must not load or run JavaScript");
  assert(/viewport-fit=cover/.test(html), "offline page must use viewport-fit=cover for safe areas");
});

test("service worker bumps a version so updates can replace old caches", () => {
  const sw = read("public/sw.js");
  assert(/CACHE_VERSION\s*=/.test(sw), "no CACHE_VERSION; old caches could never be replaced");
  // Without an activate-time delete, every deploy leaks a cache and the user can
  // be served a mix of versions.
  assert(/caches\.delete/.test(sw), "activate must delete superseded caches");
  assert(/skipWaiting/.test(sw), "worker should call skipWaiting so updates do not wait on tab close");
  assert(
    sw.includes(SKIP_WAITING),
    `the page posts ${SKIP_WAITING}; the worker must handle that message`,
  );
});

test("_headers forbids caching the service worker and manifest", () => {
  const headers = read("public/_headers");

  const ruleFor = (path: string) => {
    const lines = headers.split("\n");
    const start = lines.findIndex((l) => l.trim() === path);
    if (start === -1) return null;
    const body: string[] = [];
    for (let i = start + 1; i < lines.length; i++) {
      if (lines[i].trim() === "" || !/^\s+\S/.test(lines[i])) break;
      body.push(lines[i].trim());
    }
    return body.join("\n");
  };

  for (const path of ["/sw.js", "/manifest.webmanifest"]) {
    const rule = ruleFor(path);
    assert(rule !== null, `_headers has no rule for ${path}`);
    assert(
      /Cache-Control:[^\n]*max-age=0/.test(rule),
      `${path} must be sent with max-age=0, or updates never reach the device`,
    );
    assert(
      !/immutable/.test(rule),
      `${path} must never be immutable; it is unhashed and changes between deploys`,
    );
  }

  // The worker rule must not be shadowed by the catch-all. Cloudflare applies
  // every match but the most specific pattern wins per header, so an exact path
  // is enough to override /*.
  assert(
    ruleFor("/sw.js")!.includes("Cache-Control"),
    "/sw.js rule must set its own Cache-Control",
  );
});

test("CSP permits the service worker without opening the policy", () => {
  const headers = read("public/_headers");
  const csp = headers.match(/Content-Security-Policy:\s*(.+)/)?.[1] ?? "";
  assert(csp.length > 0, "no Content-Security-Policy in _headers");

  // worker-src defaults to script-src when absent, so this app's 'self' already
  // allows the worker. Stating it explicitly means a later tightening of
  // script-src cannot silently break offline support.
  assert(
    /worker-src\s+'self'/.test(csp),
    "CSP should state worker-src 'self' explicitly",
  );
  // The check that matters: this must not have been 'unsafe-inline' or a
  // wildcard to make the worker load.
  assert(!/worker-src[^;]*\*/.test(csp), "worker-src must not be a wildcard");
  assert(
    /default-src\s+'self'/.test(csp),
    "default-src must stay 'self'; the policy should not have been loosened for the PWA",
  );
});

test("install prompt renders nothing for a plain server render", () => {
  // Server-rendered HTML must not contain the install bar: it depends on
  // beforeinstallprompt, which only exists after hydration, and shipping a
  // placeholder would flash an empty bar on every load.
  const html = renderToStaticMarkup(<InstallPrompt />);
  assert(!/installbar/.test(html), "install bar must not appear before hydration");
});

test("layout links the manifest and apple touch icon", () => {
  const layout = read("app/layout.tsx");
  assert(/manifest:\s*"\/manifest\.webmanifest"/.test(layout), "layout must link the manifest");
  assert(
    /apple-touch-icon\.png/.test(layout),
    "iOS ignores the manifest icons for the home screen and needs apple-touch-icon",
  );
  // viewport-fit=cover is what makes env(safe-area-inset-*) non-zero.
  assert(/viewportFit:\s*"cover"/.test(layout), "viewportFit cover is required for safe areas");
});
