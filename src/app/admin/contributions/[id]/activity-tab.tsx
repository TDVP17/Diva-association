"use client";

import { useEffect, useState } from "react";
import { translate, type Lang } from "@/lib/i18n/translations";

interface AuditLogRow {
  id: string;
  action: string;
  actorName: string;
  targetType: string;
  targetId: string | null;
  createdAt: string;
}

const ACTION_LABELS: Record<string, string> = {
  member_approved: "Member approved",
  member_rejected: "Member rejected",
  contribution_created: "Cotisation created",
  contribution_updated: "Cotisation edited",
  contribution_paused: "Cotisation paused",
  contribution_resumed: "Cotisation resumed",
  contribution_locked: "Cotisation locked",
  contribution_deleted: "Cotisation deleted",
  admin_recorded_payment: "Admin recorded a payment",
  relative_payment_initiated: "Relative payment initiated",
  member_code_generated: "Member code generated",
  member_code_regenerated: "Member code regenerated",
  reminder_scheduled: "Reminder scheduled",
  admin_broadcast_scheduled: "Broadcast scheduled",
  payout_released: "Payout released",
  payout_confirmed_by_admin_override: "Payout confirmed (admin override)",
};

export function ActivityTab({ tontineSessionId, lang }: { tontineSessionId: string; lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const [logs, setLogs] = useState<AuditLogRow[] | null>(null);

  useEffect(() => {
    fetch(`/api/admin/sessions/${tontineSessionId}/audit-log`)
      .then((r) => r.json())
      .then((b) => setLogs(b.logs ?? []));
  }, [tontineSessionId]);

  if (!logs) {
    return <p className="font-label-sm text-label-sm text-on-surface-variant">…</p>;
  }

  return (
    <section className="bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] p-4">
      <h3 className="font-title-md text-title-md text-primary flex items-center gap-2 mb-4">
        <span className="material-symbols-outlined">history</span>
        {t("activityTab")}
      </h3>
      {logs.length === 0 ? (
        <p className="font-label-sm text-label-sm text-on-surface-variant">{t("noneYet")}</p>
      ) : (
        <div className="flex flex-col gap-0 border border-outline-variant/30 rounded-lg overflow-hidden">
          {logs.map((l, i) => (
            <div
              key={l.id}
              className={`flex items-center justify-between p-3 bg-surface-container-lowest ${i < logs.length - 1 ? "border-b border-outline-variant/30" : ""}`}
            >
              <div className="min-w-0">
                <p className="font-label-md text-label-md text-on-surface truncate">
                  {ACTION_LABELS[l.action] ?? l.action}
                </p>
                <p className="font-label-sm text-label-sm text-on-surface-variant">{l.actorName}</p>
              </div>
              <p className="font-label-sm text-label-sm text-on-surface-variant flex-shrink-0 ml-2">
                {new Date(l.createdAt).toLocaleString("en-GB", { timeZone: "Africa/Douala" })}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
