"use client";

// Mirrors the object store names/shapes the service worker's own IndexedDB
// helper (public/sw.js) reads from when a Background Sync event fires —
// both sides must agree on the schema since they open the same database.
const DB_NAME = "diva-offline";
const DB_VERSION = 1;
const DRAFT_CONTRIBUTIONS_STORE = "draft-contributions";
const CHAT_QUEUE_STORE = "queued-chat-messages";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DRAFT_CONTRIBUTIONS_STORE)) {
        db.createObjectStore(DRAFT_CONTRIBUTIONS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(CHAT_QUEUE_STORE)) {
        db.createObjectStore(CHAT_QUEUE_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * A contribution composed while offline — never auto-submitted. Mobile
 * Money payments need a live USSD round-trip and the member's explicit
 * confirmation at the moment they're actually sent, so this only records
 * *intent* (which slot, which phone number) for the member to review and
 * confirm once they're back online — see OfflineDraftSync.
 */
export interface DraftContribution {
  id: string;
  membershipSlotId: string;
  beneficiaryName: string;
  sessionLabel: string;
  description: string;
  amountLabel: string;
  phone: string;
  createdAt: string;
}

export async function saveDraftContribution(draft: DraftContribution): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DRAFT_CONTRIBUTIONS_STORE, "readwrite");
    tx.objectStore(DRAFT_CONTRIBUTIONS_STORE).put(draft);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listDraftContributions(): Promise<DraftContribution[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFT_CONTRIBUTIONS_STORE, "readonly");
    const req = tx.objectStore(DRAFT_CONTRIBUTIONS_STORE).getAll();
    req.onsuccess = () => resolve(req.result as DraftContribution[]);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteDraftContribution(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(DRAFT_CONTRIBUTIONS_STORE, "readwrite");
    tx.objectStore(DRAFT_CONTRIBUTIONS_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** A chat message typed while offline — safe to auto-send via Background Sync (no money involved), unlike draft contributions. */
export interface QueuedChatMessage {
  id: string;
  receiverId: string;
  content: string;
  createdAt: string;
}

export async function queueChatMessage(msg: QueuedChatMessage): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(CHAT_QUEUE_STORE, "readwrite");
    tx.objectStore(CHAT_QUEUE_STORE).put(msg);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listQueuedChatMessages(): Promise<QueuedChatMessage[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHAT_QUEUE_STORE, "readonly");
    const req = tx.objectStore(CHAT_QUEUE_STORE).getAll();
    req.onsuccess = () => resolve(req.result as QueuedChatMessage[]);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteQueuedChatMessage(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(CHAT_QUEUE_STORE, "readwrite");
    tx.objectStore(CHAT_QUEUE_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Registers a Background Sync tag so the service worker's own `sync`
 * handler drains the IndexedDB queue the moment the browser regains
 * connectivity — even if this tab isn't open anymore. Falls back to
 * silently doing nothing on browsers without SyncManager support (Safari);
 * OfflineDraftSync's own `online` event listener is the fallback path for
 * those, retrying while the tab IS open.
 */
export async function requestBackgroundSync(tag: string): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    if ("sync" in registration) {
      await (registration as ServiceWorkerRegistration & { sync: { register: (tag: string) => Promise<void> } }).sync.register(
        tag,
      );
    }
  } catch (err) {
    console.error("[offline] background sync registration failed:", err);
  }
}
