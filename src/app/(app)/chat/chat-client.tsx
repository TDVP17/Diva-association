"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { translate, type Lang } from "@/lib/i18n/translations";

interface Contact {
  id: string;
  name: string;
  avatar: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
}

type FeedItem =
  | { kind: "message"; id: string; senderId: string; content: string; createdAt: string }
  | {
      kind: "swap_request";
      id: string;
      requesterId: string;
      targetId: string;
      status: "PENDING_MEMBERSHIP" | "PENDING_ADMIN" | "APPROVED" | "REJECTED";
      tontineType: string;
      createdAt: string;
    };

interface CommonSession {
  tontineSessionId: string;
  tontineType: string;
  myPosition: number | null;
  theirPosition: number | null;
}

const TONTINE_LABELS: Record<string, string> = {
  HEBDO_SUNDAY: "Weekly Tontine",
  MONTHLY_28: "Monthly Tontine (28th)",
  MONTHLY_25: "Monthly Tontine (25th)",
  BIWEEKLY_SUNDAY: "Every 2 Weeks",
  QUARTERLY_25: "Every 3 Months",
};

function initials(name: string) {
  return name.slice(0, 2).toUpperCase();
}

export function ChatClient({
  currentUserId,
  isAdmin,
  lang,
}: {
  currentUserId: string;
  isAdmin: boolean;
  lang: Lang;
}) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<"members" | "admin">(searchParams.get("tab") === "admin" ? "admin" : "members");
  const [contacts, setContacts] = useState<{ members: Contact[]; admin: Contact | null } | null>(null);
  const [active, setActive] = useState<Contact | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [commonSessions, setCommonSessions] = useState<CommonSession[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const feedEndRef = useRef<HTMLDivElement>(null);

  const refreshContacts = useCallback(() => {
    fetch("/api/chat/contacts")
      .then((r) => r.json())
      .then(setContacts)
      .catch(() => setContacts({ members: [], admin: null }));
  }, []);

  useEffect(() => {
    refreshContacts();
  }, [refreshContacts]);

  const loadFeed = useCallback(async (otherId: string) => {
    const res = await fetch(`/api/chat/messages?with=${otherId}`);
    if (res.ok) setFeed((await res.json()).feed);
  }, []);

  useEffect(() => {
    if (!active) return;
    fetch(`/api/chat/messages?with=${active.id}`)
      .then((r) => r.json())
      .then((body) => setFeed(body.feed))
      .then(() => refreshContacts()); // opening a thread marks it read server-side — sync the badge
    fetch(`/api/chat/common-sessions?with=${active.id}`)
      .then((r) => r.json())
      .then((body) => setCommonSessions(body.sessions ?? []))
      .catch(() => setCommonSessions([]));

    const interval = setInterval(() => loadFeed(active.id), 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, loadFeed]);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [feed]);

  async function sendMessage() {
    if (!active || !input.trim() || sending) return;
    setSending(true);
    const content = input.trim();
    setInput("");
    try {
      const res = await fetch("/api/chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiverId: active.id, content }),
      });
      if (res.ok) await loadFeed(active.id);
    } finally {
      setSending(false);
    }
  }

  async function requestExchange() {
    if (!active || commonSessions.length === 0) return;
    const target = commonSessions[0];
    const res = await fetch("/api/chat/swap-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetId: active.id, tontineSessionId: target.tontineSessionId }),
    });
    if (res.ok) await loadFeed(active.id);
  }

  async function respondToSwap(id: string, action: "accept" | "decline") {
    const res = await fetch(`/api/chat/swap-requests/${id}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (res.ok && active) await loadFeed(active.id);
  }

  const list = tab === "members" ? (contacts?.members ?? []) : contacts?.admin ? [contacts.admin] : [];
  const primarySwap = commonSessions[0];

  const swapStatusLabel: Record<"PENDING_MEMBERSHIP" | "PENDING_ADMIN" | "APPROVED" | "REJECTED", string> = {
    PENDING_MEMBERSHIP: t("swapAwaitingYourResponse"),
    PENDING_ADMIN: t("swapPendingAdminApproval"),
    APPROVED: t("swapApproved"),
    REJECTED: t("swapDeclined"),
  };

  if (active) {
    return (
      // Bottom offset accounts for the mobile BottomNav (h-20, fixed) that
      // still renders behind this view — without it the sticky input bar
      // would be hidden underneath the nav on phones. Desktop has no
      // BottomNav (md:hidden), so no offset is needed there.
      <div className="flex flex-col h-[calc(100vh-64px-80px)] md:h-[calc(100vh-64px)] bg-background">
        <div className="flex items-center gap-3 px-4 py-3 bg-white shadow-sm border-b border-surface-container z-10 sticky top-0 flex-shrink-0">
          <button
            className="p-2 -ml-2 text-primary hover:bg-surface-container-low rounded-full transition-colors"
            onClick={() => setActive(null)}
            aria-label={t("backToMessages")}
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <div className="w-10 h-10 rounded-full bg-surface-container-high text-primary flex items-center justify-center font-title-md text-title-md overflow-hidden flex-shrink-0">
            {active.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={active.avatar} alt={active.name} className="w-full h-full object-cover" />
            ) : (
              initials(active.name)
            )}
          </div>
          <h2 className="font-label-md text-label-md font-bold text-on-surface truncate">{active.name}</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 min-h-0">
          {feed.map((item) => {
            if (item.kind === "message") {
              const mine = item.senderId === currentUserId;
              return (
                <div key={item.id} className={`flex flex-col max-w-[85%] ${mine ? "items-end self-end" : "items-start"}`}>
                  <div
                    className={
                      mine
                        ? "bg-primary text-white shadow-sm rounded-2xl rounded-tr-sm px-4 py-3 font-body-md text-body-md"
                        : "bg-white border border-surface-container shadow-sm rounded-2xl rounded-tl-sm px-4 py-3 text-on-surface font-body-md text-body-md"
                    }
                  >
                    {item.content}
                  </div>
                  <span className="font-label-sm text-label-sm text-outline mt-1 mx-1">
                    {new Date(item.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              );
            }

            const isTarget = item.targetId === currentUserId;
            return (
              <div
                key={item.id}
                className="self-center flex flex-col items-center gap-2 bg-surface-container-low border border-outline-variant px-4 py-3 rounded-xl text-center my-2 shadow-[0px_4px_20px_rgba(30,41,59,0.05)] max-w-[90%]"
              >
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-secondary text-sm">swap_horiz</span>
                  <p className="font-label-sm text-label-sm text-on-surface-variant">
                    {t("positionExchangeRequested")} &middot; {TONTINE_LABELS[item.tontineType] ?? item.tontineType}
                  </p>
                </div>
                <span className="font-label-sm text-label-sm px-2 py-0.5 rounded-full bg-secondary-fixed-dim/20 text-on-secondary-fixed-variant">
                  {swapStatusLabel[item.status]}
                </span>
                {isTarget && item.status === "PENDING_MEMBERSHIP" && (
                  <div className="flex gap-2 mt-1">
                    <button
                      onClick={() => respondToSwap(item.id, "decline")}
                      className="px-3 py-1.5 rounded-lg border border-outline-variant text-on-surface-variant font-label-sm text-label-sm hover:bg-surface transition-colors"
                    >
                      {t("declineAction")}
                    </button>
                    <button
                      onClick={() => respondToSwap(item.id, "accept")}
                      className="px-3 py-1.5 rounded-lg bg-primary text-on-primary font-label-sm text-label-sm hover:opacity-90 transition-opacity"
                    >
                      {t("acceptAction")}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          <div ref={feedEndRef} />
        </div>

        <div className="bg-white p-3 border-t border-surface-container shadow-[0px_-4px_20px_rgba(30,41,59,0.05)] sticky bottom-0 z-10 w-full flex-shrink-0">
          {primarySwap && (
            <div className="mb-3 flex justify-center">
              <button
                onClick={requestExchange}
                className="bg-secondary-fixed-dim bg-opacity-20 text-on-secondary-container border border-secondary-fixed-dim hover:bg-opacity-30 transition-colors font-label-md text-label-md font-semibold py-2 px-4 rounded-full flex items-center gap-2 shadow-sm"
              >
                <span className="material-symbols-outlined text-[18px]">swap_horiz</span>
                {t("requestExchangeLabel", {
                  mine: String(primarySwap.myPosition ?? "?"),
                  theirs: String(primarySwap.theirPosition ?? "?"),
                })}
              </button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <div className="flex-1 bg-surface-container-low rounded-2xl border border-surface-container overflow-hidden focus-within:border-primary focus-within:ring-1 focus-within:ring-primary transition-all">
              <textarea
                className="w-full bg-transparent border-none py-3 px-4 font-body-md text-body-md text-on-surface focus:ring-0 resize-none max-h-24"
                placeholder={t("typeMessagePlaceholder")}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
              />
            </div>
            <button
              onClick={sendMessage}
              disabled={sending || !input.trim()}
              className="w-12 h-12 rounded-full bg-primary text-white flex items-center justify-center shadow-[0px_8px_30px_rgba(30,41,59,0.12)] hover:bg-primary-container active:scale-95 transition-all flex-shrink-0 disabled:opacity-50"
            >
              <span className="material-symbols-outlined">send</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <main className="px-container-padding pt-4 pb-8 max-w-2xl lg:max-w-4xl mx-auto w-full">
      <h1 className="sticky top-16 z-30 bg-background py-2 -mx-container-padding px-container-padding font-title-md text-title-md text-primary mb-4 shadow-[0px_4px_20px_rgba(30,41,59,0.05)]">
        {t("myConversations")}
      </h1>
      {!isAdmin && (
        <div className="flex bg-surface-container-low rounded-lg p-1 mb-4 max-w-xs">
          <button
            onClick={() => setTab("members")}
            className={`flex-1 py-1.5 px-3 rounded-md text-sm font-label-md transition-all ${tab === "members" ? "font-semibold bg-white shadow-sm text-primary" : "font-medium text-on-surface-variant"}`}
          >
            {t("membersTab")}
          </button>
          <button
            onClick={() => setTab("admin")}
            className={`flex-1 py-1.5 px-3 rounded-md text-sm font-label-md transition-all ${tab === "admin" ? "font-semibold bg-white shadow-sm text-primary" : "font-medium text-on-surface-variant"}`}
          >
            {t("adminSupportTab")}
          </button>
        </div>
      )}

      <div className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:gap-3">
        {list.length === 0 && (
          <div className="bg-white rounded-xl p-6 text-center shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant lg:col-span-2">
            <p className="font-body-md text-body-md text-on-surface-variant">{t("noConversationsYet")}</p>
          </div>
        )}
        {list.map((contact) => {
          const unread = contact.unreadCount > 0;
          return (
            <button
              key={contact.id}
              onClick={() => setActive(contact)}
              className="w-full flex items-center gap-4 bg-white p-4 rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border-b border-surface-container active:scale-[0.98] transition-transform text-left"
            >
              <div className="w-12 h-12 rounded-full bg-surface-container-high text-primary flex items-center justify-center font-title-md font-bold overflow-hidden flex-shrink-0">
                {contact.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={contact.avatar} alt={contact.name} className="w-full h-full object-cover" />
                ) : (
                  initials(contact.name)
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-baseline mb-1">
                  <h3
                    className={`font-title-md text-title-md text-on-surface truncate ${unread ? "font-bold" : "font-semibold"}`}
                  >
                    {contact.name}
                  </h3>
                  {contact.lastMessageAt && (
                    <span className="font-label-sm text-label-sm text-outline flex-shrink-0 ml-2">
                      {new Date(contact.lastMessageAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  )}
                </div>
                <div className="flex justify-between items-center gap-2">
                  <p
                    className={`font-body-md text-body-md truncate ${unread ? "text-on-surface font-semibold" : "text-on-surface-variant"}`}
                  >
                    {contact.lastMessagePreview ?? t("sayHello")}
                  </p>
                  {unread && (
                    <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full bg-error text-on-error font-label-sm text-label-sm flex-shrink-0">
                      {contact.unreadCount}
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </main>
  );
}
