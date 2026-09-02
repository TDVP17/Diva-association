// PWA service worker — static-asset caching, an offline-friendly app shell,
// and Web Push delivery/App Badging.
//
// Caching strategy is deliberately split by request type, not blanket:
//   - Static, content-hashed assets (_next/static, icons, manifest) are
//     cache-first — safe indefinitely, they never change under the same URL.
//   - Page navigations (actual document loads/route changes) are
//     network-first with a cache fallback: an online user ALWAYS gets live
//     HTML (server components re-render fresh contribution/session/fine
//     state on every request), and the cache is only ever read when the
//     network genuinely fails — e.g. mobile data with no bundle/balance —
//     so an offline member can still see their last-seen dashboard,
//     balances, and history instead of a browser error page.
//   - Every /api/* request (and anything else) is untouched, pure network
//     passthrough — payment initiation/status, auth, and any other live
//     financial call must never be answered from a stale cache. This is the
//     same "stale financial state is worse than no offline support"
//     principle the original version of this file was built around, now
//     scoped precisely to the calls where staleness would actually mislead
//     someone, instead of blocking page-shell caching entirely.
const CACHE_NAME = "diva-shell-v3";
const STATIC_ASSETS = ["/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png", "/offline.html"];

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

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.json"
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return; // never intercept mutations
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never intercept cross-origin (Supabase, etc.)

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request)
            .then((res) => {
              // Must clone synchronously, in this same tick — event.respondWith
              // hands `res` to the browser to start consuming as soon as this
              // callback returns, and caches.open() is async, so cloning
              // inside its .then() risked losing the race and throwing
              // "Response body is already used" (seen in production).
              if (res.ok) {
                const copy = res.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
              }
              return res;
            })
            .catch((err) => {
              console.error("[sw] static asset fetch failed for", url.pathname, err);
              return new Response(null, { status: 504, statusText: "Offline" });
            }),
      ),
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached ?? (await caches.match("/offline.html")) ?? new Response(null, { status: 504 });
        }),
    );
    return;
  }

  // Everything else (all /api/* calls, any other same-origin fetch) —
  // untouched network passthrough.
});

// ---- Web Push -------------------------------------------------------------

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch (err) {
    console.error("[sw] push payload was not valid JSON:", err);
    return;
  }

  const title = payload.title || "DIVA Association";
  const options = {
    body: payload.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { url: payload.url || "/dashboard" },
  };

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options);
      // Sets the home-screen icon badge directly from the count the server
      // computed at send time — works even with the app fully closed, which
      // the foreground-only polling in notification-badge-sync.tsx cannot
      // do on its own. Unsupported browsers (iOS Safari) no-op safely.
      if (typeof payload.badgeCount === "number" && "setAppBadge" in self.navigator) {
        try {
          if (payload.badgeCount > 0) await self.navigator.setAppBadge(payload.badgeCount);
          else await self.navigator.clearAppBadge();
        } catch (err) {
          console.error("[sw] setAppBadge failed:", err);
        }
      }
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/dashboard";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const existing = allClients.find((c) => new URL(c.url).pathname === url);
      if (existing) {
        await existing.focus();
        return;
      }
      const anyClient = allClients[0];
      if (anyClient) {
        await anyClient.focus();
        anyClient.navigate(url);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});

// ---- Background Sync (queued admin chat messages sent while offline) -----
//
// Payments are deliberately NOT synced this way — see kyc-modal.tsx/global-
// payment-form.tsx and offline-draft-store.js. Mobile Money charges need a
// live USSD round-trip and the member's explicit confirmation at the moment
// they're sent, so they're queued as reviewable drafts instead, never
// auto-fired. A queued chat message to admin has no such requirement — it's
// safe to send automatically the instant connectivity returns.
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-chat-messages") {
    event.waitUntil(syncQueuedChatMessages());
  }
});

const OFFLINE_DB_NAME = "diva-offline";
const CHAT_QUEUE_STORE = "queued-chat-messages";

function openOfflineDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(OFFLINE_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CHAT_QUEUE_STORE)) {
        db.createObjectStore(CHAT_QUEUE_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("draft-contributions")) {
        db.createObjectStore("draft-contributions", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function syncQueuedChatMessages() {
  const db = await openOfflineDb();
  const tx = db.transaction(CHAT_QUEUE_STORE, "readonly");
  const all = await new Promise((resolve, reject) => {
    const req = tx.objectStore(CHAT_QUEUE_STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  for (const queued of all) {
    try {
      const res = await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiverId: queued.receiverId, content: queued.content }),
      });
      if (res.ok) {
        const delTx = db.transaction(CHAT_QUEUE_STORE, "readwrite");
        delTx.objectStore(CHAT_QUEUE_STORE).delete(queued.id);
      }
      // A non-OK response (e.g. still offline, or a real validation error)
      // just leaves it queued — the next sync event or app-open retry
      // (see offline-draft-store.js) will try again.
    } catch (err) {
      console.error("[sw] failed to sync queued chat message:", err);
    }
  }
}
