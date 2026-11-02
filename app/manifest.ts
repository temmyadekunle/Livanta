import type { MetadataRoute } from "next";

/**
 * The web app manifest, which is what makes Livanta installable from the
 * browser: Android offers an install prompt, iOS offers Add to Home Screen,
 * and a desktop browser offers an install icon in the address bar.
 *
 * It has to live in the app directory rather than in public/ for one specific
 * reason. Next.js mangles filenames it does not recognise, so a static
 * manifest.webmanifest in public/ can arrive at the CDN as
 * manifest.webmanifest.txt and be rejected as the wrong MIME type. Generating
 * it through the Metadata API guarantees the exact path and content type.
 *
 * Everything here is served from the same origin as the app. There is no
 * start_url pointing anywhere else, because this app keeps all of its data in
 * the browser (IndexedDB) and has no server to authenticate against.
 */
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Livanta — Home, Documents & Bills",
    short_name: "Livanta",
    description:
      "One place to manage the things that keep your life running: home, vehicles, bills, documents and assets.",
    lang: "en",
    dir: "ltr",
    /**
     * start_url must carry a trailing slash and must not be "/index.html".
     * The export uses trailingSlash: true, so "/?source=pwa" resolves to the
     * real / route rather than the CDN treating the query string as part of
     * the filename. The query is what tells the service worker to start from a
     * clean activation when launched from the home screen.
     */
    start_url: "/?source=pwa",
    /**
     * scope must include the leading slash and stay on this origin. It is what
     * the service worker is allowed to control; a narrower scope would leave
     * /privacy/ and /terms/ uncontrolled and therefore uncached offline.
     */
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    /**
     * Both colours are --bg from globals.css, not the older #f4f6fa. The
     * background fills the splash screen before any CSS has loaded, so if it
     * differs even slightly from the app's own background the user sees a
     * flash of one colour then another on every cold start. A test asserts
     * these stay in sync with the stylesheet.
     *
     * A manifest can only carry one theme_color, so this is the light value.
     * Dark mode is covered by the viewport themeColor in app/layout.tsx, which
     * does support a per-scheme pair.
     */
    background_color: "#f7f8fb",
    theme_color: "#f7f8fb",
    categories: ["productivity", "utilities", "lifestyle"],
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    /**
     * No shortcuts. The app holds its current screen in local state and never
     * reads a query parameter, so "/?view=things" and "/?view=calendar" only
     * ever landed on the home screen. A shortcut that opens the wrong screen is
     * worse than no shortcut.
     */
  };
}
