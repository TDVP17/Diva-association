// Minimal PWA service worker. Deliberately does NOT cache API routes or HTML
// — this is a payments app, so stale financial state (contribution status,
// draw results, payout state) is worse than no offline support. Only static,
// content-hashed-adjacent assets (icons, manifest) are cached.
const CACHE_NAME = "diva-static-v1";
const STATIC_ASSETS = ["/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
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
    caches.match(event.request).then((cached) => cached ?? fetch(event.request)),
  );
});
