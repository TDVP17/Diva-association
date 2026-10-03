"use client";

import { useEffect, useState } from "react";
import { translate, type Lang } from "@/lib/i18n/translations";
import { NOTIFICATION_TYPE_KEY, NOTIFICATION_STATUS_KEY } from "@/lib/notifications/type-labels";
import { LoadingSpinner } from "@/components/loading-spinner";

interface NotificationRow {
  id: string;
  userName: string;
  contributionLabel: string | null;
  channel: string;
  type: string;
  status: string;
  scheduledAt: string;
  sentAt: string | null;
  errorMessage: string | null;
}

interface ContributionOption {
  id: string;
  label: string;
}

const STATUS_CLASS: Record<string, string> = {
  SENT: "bg-[#d1fae5] text-[#065f46]",
  FAILED: "bg-error-container text-on-error-container",
  PENDING: "bg-secondary-fixed text-on-secondary-fixed-variant",
  SCHEDULED: "bg-secondary-fixed text-on-secondary-fixed-variant",
  PROCESSING: "bg-secondary-container/40 text-on-secondary-container",
};

export function AdminNotificationsClient({ lang }: { lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [contributions, setContributions] = useState<ContributionOption[]>([]);
  const [tontineSessionId, setTontineSessionId] = useState("");
  const [channel, setChannel] = useState("");
  const [status, setStatus] = useState("");
  const [member, setMember] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  // Broadcast Alert modal state
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [alertTarget, setAlertTarget] = useState<"ALL" | "GROUP">("ALL");
  const [alertGroupId, setAlertGroupId] = useState("");
  const [alertTitle, setAlertTitle] = useState("");
  const [alertMessage, setAlertMessage] = useState("");
  const [sendingAlert, setSendingAlert] = useState(false);
  const [alertFeedback, setAlertFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (tontineSessionId) params.set("tontineSessionId", tontineSessionId);
    if (channel) params.set("channel", channel);
    if (status) params.set("status", status);
    if (member.trim()) params.set("member", member.trim());

    let cancelled = false;
    const handle = setTimeout(() => {
      setLoading(true);
      setLoadError(false);
      fetch(`/api/admin/notifications?${params.toString()}`)
        .then((r) => {
          if (!r.ok) throw new Error(`Request failed with status ${r.status}`);
          return r.json();
        })
        .then((b) => {
          if (cancelled) return;
          setNotifications(b.notifications ?? []);
          setContributions(b.contributions ?? []);
          if (b.contributions?.length > 0 && !alertGroupId) {
            setAlertGroupId(b.contributions[0].id);
          }
        })
        .catch((err) => {
          console.error("[admin-notifications] failed to load:", err);
          if (!cancelled) setLoadError(true);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [tontineSessionId, channel, status, member, reloadToken]);

  async function handleSendAlert(e: React.FormEvent) {
    e.preventDefault();
    if (!alertTitle.trim() || !alertMessage.trim()) return;
    if (alertTarget === "GROUP" && !alertGroupId) return;

    setSendingAlert(true);
    setAlertFeedback(null);

    try {
      const res = await fetch("/api/admin/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: alertTarget,
          tontineSessionId: alertTarget === "GROUP" ? alertGroupId : undefined,
          title: alertTitle.trim(),
          message: alertMessage.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || t("adminAlertErrorMessage"));
      }

      setAlertFeedback({
        type: "success",
        text: t("adminAlertSuccessMessage", { count: String(data.count ?? 0) }),
      });
      setAlertTitle("");
      setAlertMessage("");
      setShowAlertModal(false);
      setReloadToken((n) => n + 1);
    } catch (err) {
      console.error("[handleSendAlert] failed:", err);
      setAlertFeedback({
        type: "error",
        text: (err as Error).message || t("adminAlertErrorMessage"),
      });
    } finally {
      setSendingAlert(false);
    }
  }

  return (
    <main className="px-container-padding pt-stack-gap-lg pb-32 max-w-4xl mx-auto w-full flex flex-col gap-stack-gap-lg">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="font-headline-lg-mobile text-headline-lg-mobile md:font-headline-lg md:text-headline-lg text-primary">
            {t("notificationCenter")}
          </h2>
          <p className="text-on-surface-variant font-body-lg mt-1">{t("notificationCenterSubtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            setAlertFeedback(null);
            setShowAlertModal(true);
          }}
          className="self-start sm:self-auto inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-on-primary font-label-md text-label-md hover:bg-primary/90 transition-all shadow-sm"
        >
          <span className="material-symbols-outlined text-[20px]">campaign</span>
          {t("adminAlertModalTitle")}
        </button>
      </div>

      {alertFeedback && (
        <div
          className={`p-4 rounded-xl flex items-center justify-between gap-3 text-sm font-label-md ${
            alertFeedback.type === "success"
              ? "bg-[#ecfdf5] text-[#065f46] border border-[#a7f3d0]"
              : "bg-error-container text-on-error-container border border-error/20"
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">
              {alertFeedback.type === "success" ? "check_circle" : "error"}
            </span>
            <span>{alertFeedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setAlertFeedback(null)}
            className="p-1 rounded hover:bg-black/5 transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      )}

      {/* Broadcast Alert Modal */}
      {showAlertModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-surface-variant max-w-lg w-full p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-[22px]">campaign</span>
                </div>
                <div>
                  <h3 className="font-title-md text-title-md text-primary font-bold">
                    {t("adminAlertModalTitle")}
                  </h3>
                  <p className="font-label-sm text-label-sm text-on-surface-variant">
                    {t("adminAlertModalSubtitle")}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAlertModal(false)}
                className="w-8 h-8 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface transition-colors"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <form onSubmit={handleSendAlert} className="flex flex-col gap-4">
              {/* Audience selection */}
              <div>
                <label className="block font-label-md text-label-md text-on-surface mb-2 font-semibold">
                  {t("adminAlertTargetLabel")}
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAlertTarget("ALL")}
                    className={`p-3 rounded-xl border text-left flex items-center gap-2.5 transition-all ${
                      alertTarget === "ALL"
                        ? "border-primary bg-primary/5 text-primary font-semibold shadow-sm"
                        : "border-outline-variant text-on-surface hover:bg-surface"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[20px]">
                      {alertTarget === "ALL" ? "radio_button_checked" : "radio_button_unchecked"}
                    </span>
                    <span className="text-sm">{t("adminAlertTargetAll")}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAlertTarget("GROUP")}
                    className={`p-3 rounded-xl border text-left flex items-center gap-2.5 transition-all ${
                      alertTarget === "GROUP"
                        ? "border-primary bg-primary/5 text-primary font-semibold shadow-sm"
                        : "border-outline-variant text-on-surface hover:bg-surface"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[20px]">
                      {alertTarget === "GROUP" ? "radio_button_checked" : "radio_button_unchecked"}
                    </span>
                    <span className="text-sm">{t("adminAlertTargetGroup")}</span>
                  </button>
                </div>
              </div>

              {/* Group selection if GROUP */}
              {alertTarget === "GROUP" && (
                <div className="animate-fade-in">
                  <label className="block font-label-md text-label-md text-on-surface mb-1.5 font-semibold">
                    {t("adminAlertSelectGroupPrompt")}
                  </label>
                  <select
                    value={alertGroupId}
                    onChange={(e) => setAlertGroupId(e.target.value)}
                    required
                    className="w-full border border-outline-variant rounded-xl px-3.5 py-2.5 font-label-md text-label-md bg-white text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  >
                    {contributions.length === 0 ? (
                      <option value="">{t("noneYet")}</option>
                    ) : (
                      contributions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              )}

              {/* Title input */}
              <div>
                <label className="block font-label-md text-label-md text-on-surface mb-1.5 font-semibold">
                  {t("adminAlertTitleLabel")}
                </label>
                <input
                  type="text"
                  value={alertTitle}
                  onChange={(e) => setAlertTitle(e.target.value)}
                  placeholder={t("adminAlertTitlePlaceholder")}
                  required
                  maxLength={200}
                  className="w-full border border-outline-variant rounded-xl px-3.5 py-2.5 font-label-md text-label-md bg-white text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>

              {/* Message body */}
              <div>
                <label className="block font-label-md text-label-md text-on-surface mb-1.5 font-semibold">
                  {t("adminAlertBodyLabel")}
                </label>
                <textarea
                  value={alertMessage}
                  onChange={(e) => setAlertMessage(e.target.value)}
                  placeholder={t("adminAlertBodyPlaceholder")}
                  required
                  rows={4}
                  maxLength={5000}
                  className="w-full border border-outline-variant rounded-xl px-3.5 py-2.5 font-label-md text-label-md bg-white text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-y"
                />
              </div>

              {/* Notice */}
              <div className="p-3 bg-surface rounded-xl border border-outline-variant/40 flex items-start gap-2.5 text-xs text-on-surface-variant">
                <span className="material-symbols-outlined text-[18px] text-primary flex-shrink-0 mt-0.5">
                  info
                </span>
                <p className="leading-relaxed">{t("adminAlertChannelsNotice")}</p>
              </div>

              {/* Action buttons */}
              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAlertModal(false)}
                  disabled={sendingAlert}
                  className="px-4 py-2.5 rounded-xl border border-outline-variant text-on-surface font-label-md text-label-md hover:bg-surface transition-colors"
                >
                  {t("cancelAction")}
                </button>
                <button
                  type="submit"
                  disabled={
                    sendingAlert ||
                    !alertTitle.trim() ||
                    !alertMessage.trim() ||
                    (alertTarget === "GROUP" && !alertGroupId)
                  }
                  className="px-5 py-2.5 rounded-xl bg-primary text-on-primary font-label-md text-label-md hover:bg-primary/90 transition-all disabled:opacity-50 inline-flex items-center gap-2 shadow-sm"
                >
                  <span className="material-symbols-outlined text-[18px]">send</span>
                  {sendingAlert ? t("adminAlertSendingAction") : t("adminAlertSendAction")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={tontineSessionId}
          onChange={(e) => setTontineSessionId(e.target.value)}
          className="border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md bg-white"
        >
          <option value="">{t("allContributions")}</option>
          {contributions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <select
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          className="border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md bg-white"
        >
          <option value="">{t("allChannels")}</option>
          <option value="EMAIL">Email</option>
          <option value="WHATSAPP">WhatsApp</option>
          <option value="IN_APP">{t("notifChannelInApp")}</option>
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md bg-white"
        >
          <option value="">{t("allStatuses")}</option>
          <option value="SENT">{t("notifStatusSent")}</option>
          <option value="SCHEDULED">{t("notifStatusScheduled")}</option>
          <option value="PROCESSING">{t("notifStatusProcessing")}</option>
          <option value="FAILED">{t("notifStatusFailed")}</option>
        </select>
        <input
          value={member}
          onChange={(e) => setMember(e.target.value)}
          placeholder={t("filterByMember")}
          className="border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md bg-white flex-1 min-w-[160px]"
        />
      </div>

      {loadError ? (
        <div className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-5 text-center flex flex-col items-center gap-stack-gap-sm">
          <p className="font-body-md text-body-md text-error">{t("couldNotLoadNotifications")}</p>
          <button
            onClick={() => setReloadToken((n) => n + 1)}
            className="px-4 py-2 rounded-lg border border-outline-variant text-primary font-label-md text-label-md hover:bg-surface-container-low transition-colors"
          >
            {t("tryAgain")}
          </button>
        </div>
      ) : loading ? (
        <LoadingSpinner />
      ) : notifications.length === 0 ? (
        <p className="font-label-sm text-label-sm text-on-surface-variant">{t("noneYet")}</p>
      ) : (
        <div className="bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-outline-variant/30 overflow-hidden">
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
                  {n.contributionLabel ? `${n.contributionLabel} — ` : ""}
                  {NOTIFICATION_TYPE_KEY[n.type] ? t(NOTIFICATION_TYPE_KEY[n.type]) : n.type} —{" "}
                  {new Date(n.sentAt ?? n.scheduledAt).toLocaleString("en-GB", { timeZone: "Africa/Douala" })}
                  {n.errorMessage && ` — ${n.errorMessage}`}
                </p>
              </div>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-md font-label-sm text-label-sm flex-shrink-0 ml-2 ${STATUS_CLASS[n.status]}`}>
                {NOTIFICATION_STATUS_KEY[n.status] ? t(NOTIFICATION_STATUS_KEY[n.status]) : n.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
