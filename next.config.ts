import type { NextConfig } from "next";

import { assertProductionAuthConfig } from "./lib/supabase/config.ts";

// Next loads .env files before evaluating this file, so a production build
// either has usable credentials or fails here rather than silently shipping
// with the compulsory authentication gate disabled.
assertProductionAuthConfig(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  process.env.NODE_ENV,
);

const nextConfig: NextConfig = {
  // Livanta keeps everything in the browser (IndexedDB), so there is no
  // server to run. A static export gives the fastest possible load on a
  // weak connection: pure CDN delivery with no Node function in the path.
  output: "export",
  images: {
    // No image optimiser exists in a static export.
    unoptimized: true,
  },
  trailingSlash: true,
};

export default nextConfig;