import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Service workers are otherwise served with default static-asset
        // caching, which can leave a browser (or an intermediate CDN)
        // running a stale sw.js for a long time after a fix ships — the
        // update check itself never happens if the request for the file is
        // answered from a stale cache. no-cache forces revalidation on
        // every load while still allowing a 304 when nothing changed.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
