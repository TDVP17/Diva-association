"use client";

import { useEffect, useState } from "react";
import { translate, type Lang } from "@/lib/i18n/translations";

interface SwapRequestRow {
  id: string;
  requesterName: string;
  targetName: string;
  tontineSessionId: string;
  tontineType: string;
  requesterPosition: number | null;
  targetPosition: number | null;
}

interface NotificationRow {
  id: string;
  userName: string;
  channel: "EMAIL" | "WHATSAPP" | "IN_APP";
  type: string;
  status: "PENDING" | "SCHEDULED" | "PROCESSING" | "SENT" | "FAILED";
  scheduledAt: string;
  sentAt: string | null;
  errorMessage: string | null;
}

const STATUS_CLASS: Record<string, string> = {
  SENT: "bg-[#d1fae5] text-[#065f46]",
  FAILED: "bg-error-container text-on-error-container",
  PENDING: "bg-secondary-fixed text-on-secondary-fixed-variant",
  SCHEDULED: "bg-secondary-fixed text-on-secondary-fixed-variant",
  PROCESSING: "bg-secondary-container/40 text-on-secondary-container",
};

export function NotificationsTab({
  tontineSessionId,
  swapRequests,
  onDecideSwap,
  lang,
}: {
  tontineSessionId: string;
  swapRequests: SwapRequestRow[];
  onDecideSwap: (id: string, action: "approve" | "reject") => void;
  lang: Lang;
}) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);

  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [sendingReminder, setSendingReminder] = useState<"contribution" | "fine" | null>(null);
  const [reminderResult, setReminderResult] = useState<string | null>(null);
  const [reminderChannel, setReminderChannel] = useState<"WHATSAPP" | "EMAIL">("WHATSAPP");

  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailResult, setEmailResult] = useState<string | null>(null);

  function refreshNotifications() {
    fetch(`/api/admin/sessions/${tontineSessionId}/notifications`)
      .then((r) => r.json())
      .then((b) => setNotifications(b.notifications ?? []));
  }

  useEffect(() => {
    refreshNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tontineSessionId]);

  async function sendReminder(type: "contribution" | "fine") {
    setSendingReminder(type);
    setReminderResult(null);
    try {
      const res = await fetch(`/api/admin/contributions/${tontineSessionId}/reminders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: type === "contribution" ? "CONTRIBUTION_REMINDER" : "FINE_REMINDER",
          channel: reminderChannel,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setReminderResult(body.error ?? t("couldNotScheduleReminders"));
        return;
      }
      setReminderResult(t("remindersScheduled", { count: String(body.scheduled) }));
      refreshNotifications();
    } finally {
      setSendingReminder(null);
    }
  }

  async function sendMassEmail() {
    if (!emailSubject.trim() || !emailBody.trim()) return;
    setSendingEmail(true);
    setEmailResult(null);
    try {
      const res = await fetch(`/api/admin/sessions/${tontineSessionId}/broadcast-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: emailSubject.trim(), body: emailBody.trim() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setEmailResult(body.error ?? t("couldNotAddMember"));
        return;
      }
      setEmailResult(t("emailSentSummary", { count: String(body.scheduled ?? body.sent ?? 0) }));
      setEmailSubject("");
      setEmailBody("");
      refreshNotifications();
    } finally {
      setSendingEmail(false);
    }
  }

  return (
    <div className="flex flex-col gap-stack-gap-lg">
      <section className="bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] p-4">
        <h3 className="font-title-md text-title-md text-primary flex items-center gap-2 mb-4">
          <span className="material-symbols-outlined">campaign</span>
          {t("sendReminders")}
        </h3>
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <label className="font-label-sm text-label-sm text-on-surface-variant">{t("channelLabel")}</label>
          <select
            value={reminderChannel}
            onChange={(e) => setReminderChannel(e.target.value as "WHATSAPP" | "EMAIL")}
            className="border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md bg-white"
          >
            <option value="WHATSAPP">WhatsApp</option>
            <option value="EMAIL">Email</option>
          </select>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => sendReminder("contribution")}
            disabled={sendingReminder !== null}
            className="px-3 py-2 rounded-lg bg-primary text-on-primary font-label-sm text-label-sm hover:opacity-90 disabled:opacity-60 flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[16px]">payments</span>
            {sendingReminder === "contribution" ? t("schedulingEllipsis") : t("remindUnpaidMembers")}
          </button>
          <button
            onClick={() => sendReminder("fine")}
            disabled={sendingReminder !== null}
            className="px-3 py-2 rounded-lg border border-outline-variant text-on-surface font-label-sm text-label-sm hover:bg-surface disabled:opacity-60 flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[16px]">warning</span>
            {sendingReminder === "fine" ? t("schedulingEllipsis") : t("remindUnpaidFines")}
          </button>
        </div>
        {reminderResult && <p className="font-label-sm text-label-sm text-on-surface-variant mt-3">{reminderResult}</p>}
        <p className="font-label-sm text-label-sm text-on-surface-variant mt-2">{t("fiveMinuteStaggerNote")}</p>
      </section>

      <section className="bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] p-4">
        <h3 className="font-title-md text-title-md text-primary flex items-center gap-2 mb-4">
          <span className="material-symbols-outlined">mail</span>
          {t("massEmailTitle")}
        </h3>
        <div className="flex flex-col gap-2 mb-3">
          <input
            value={emailSubject}
            onChange={(e) => setEmailSubject(e.target.value)}
            placeholder={t("emailSubjectLabel")}
            className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md bg-white"
          />
          <textarea
            value={emailBody}
            onChange={(e) => setEmailBody(e.target.value)}
            placeholder={t("emailBodyLabel")}
            rows={4}
            className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md bg-white"
          />
          <button
            onClick={sendMassEmail}
            disabled={sendingEmail || !emailSubject.trim() || !emailBody.trim()}
            className="bg-primary text-on-primary font-label-md text-label-md px-4 py-2.5 rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {sendingEmail ? t("recordingEllipsis") : t("sendToAllMembers")}
          </button>
        </div>
        {emailResult && <p className="font-label-sm text-label-sm text-on-surface-variant">{emailResult}</p>}
      </section>

      <section className="bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] p-4">
        <h3 className="font-title-md text-title-md text-primary flex items-center gap-2 mb-4">
          <span className="material-symbols-outlined">notifications</span>
          {t("notificationHistory")}
        </h3>
        {notifications.length === 0 ? (
          <p className="font-label-sm text-label-sm text-on-surface-variant">{t("noneYet")}</p>
        ) : (
          <div className="flex flex-col gap-0 border border-outline-variant/30 rounded-lg overflow-hidden">
            {notifications.map((n, i) => (
              <div
                key={n.id}
                className={`flex items-center justify-between p-3 bg-surface-container-lowest ${i < notifications.length - 1 ? "border-b border-outline-variant/30" : ""}`}
              >
                <div className="min-w-0">
                  <p className="font-label-md text-label-md text-on-surface truncate">
                    {n.userName} · {n.channel}
                  </p>
                  <p className="font-label-sm text-label-sm text-on-surface-variant truncate">
                    {n.type} — {new Date(n.sentAt ?? n.scheduledAt).toLocaleString("en-GB", { timeZone: "Africa/Douala" })}
                    {n.errorMessage && ` — ${n.errorMessage}`}
                  </p>
                </div>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-md font-label-sm text-label-sm flex-shrink-0 ml-2 ${STATUS_CLASS[n.status]}`}>
                  {n.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] p-4 flex-grow flex flex-col">
        <h3 className="font-title-md text-title-md text-primary flex items-center gap-2 mb-4">
          <span className="material-symbols-outlined">swap_horiz</span>
          {t("swapRequests")}
        </h3>
        {swapRequests.length === 0 ? (
          <p className="font-label-sm text-label-sm text-on-surface-variant">{t("noPendingSwaps")}</p>
        ) : (
          <div className="flex flex-col gap-0 border border-outline-variant/30 rounded-lg overflow-hidden">
            {swapRequests.map((r) => (
              <div key={r.id} className="flex justify-between items-center p-3 bg-surface-container-lowest border-b last:border-b-0 border-outline-variant/30">
                <div>
                  <p className="font-label-md text-label-md text-on-surface">
                    {t("positionAbbrev")} {r.requesterPosition ?? "?"}{" "}
                    <span className="material-symbols-outlined text-[14px] align-middle px-1">arrow_forward</span>{" "}
                    {t("positionAbbrev")} {r.targetPosition ?? "?"}
                  </p>
                  <p className="font-label-sm text-label-sm text-on-surface-variant">
                    {t("userAsksUser", { requester: r.requesterName, target: r.targetName })}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => onDecideSwap(r.id, "reject")} className="px-2 py-1 rounded border border-outline-variant text-on-surface-variant font-label-sm text-label-sm hover:bg-surface">
                    {t("reject")}
                  </button>
                  <button onClick={() => onDecideSwap(r.id, "approve")} className="px-2 py-1 rounded bg-primary text-on-primary font-label-sm text-label-sm hover:opacity-90">
                    {t("approve")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
