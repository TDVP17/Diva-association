// Minimal PWA service worker. Deliberately does NOT cache API routes or HTML
// — this is a payments app, so stale financial state (contribution status,
// draw results, payout state) is worse than no offline support. Only static,
// content-hashed-adjacent assets (icons, manifest) are cached.
const CACHE_NAME = "diva-static-v1";
const STATIC_ASSETS = ["/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  // cache.addAll() is all-or-nothing — one failed request (offline install,
  // a transient network blip, a stale asset URL) rejects the whole promise.
  // Caught here so that failure never surfaces as an unhandled promise
  // rejection; precaching is a nice-to-have, not something that should
  // block the service worker from installing.
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch((err) => console.error("[sw] precache failed:", err)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isStaticAsset = url.pathname.startsWith("/icons/") || url.pathname === "/manifest.json";
  if (!isStaticAsset) return; // network passthrough for everything else

  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ??
        fetch(event.request).catch((err) => {
          console.error("[sw] fetch failed for", url.pathname, err);
          return new Response(null, { status: 504, statusText: "Offline" });
        }),
    ),
  );
});
