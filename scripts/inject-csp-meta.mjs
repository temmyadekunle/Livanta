import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = "out";

const CSP =
  "default-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; " +
  "img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; " +
  "script-src 'self' 'unsafe-inline'; worker-src 'self'; " +
  "connect-src 'self' https://*.supabase.co https://*.supabase.in";

const META = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;

function htmlFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...htmlFiles(full));
    else if (entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}

let injected = 0;
let skipped = 0;

for (const file of htmlFiles(ROOT)) {
  const html = readFileSync(file, "utf8");
  if (/http-equiv=["']Content-Security-Policy/i.test(html)) {
    skipped++;
    continue;
  }
  const index = html.search(/<head[^>]*>/i);
  if (index === -1) {
    skipped++;
    continue;
  }
  const openEnd = index + html.slice(index).indexOf(">") + 1;
  const next = html.slice(0, openEnd) + META + html.slice(openEnd);
  writeFileSync(file, next);
  injected++;
}

console.log(
  `inject-csp-meta: ${injected} page(s) given a meta CSP, ${skipped} skipped (${relative(process.cwd(), ROOT)})`,
);
