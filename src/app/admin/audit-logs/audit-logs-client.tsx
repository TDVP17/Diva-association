"use client";

import { useEffect, useState } from "react";
import { translate, type Lang } from "@/lib/i18n/translations";
import { LoadingSpinner } from "@/components/loading-spinner";

interface AuditLogRow {
  id: string;
  createdAt: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  tontineSessionId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  status: "SUCCESS" | "FAILED" | "BLOCKED";
  failureReason: string | null;
  metadata: unknown;
  payloadBefore: unknown;
  payloadAfter: unknown;
}

const ACTION_KEY: Record<string, Parameters<typeof translate>[1]> = {
  member_approved: "auditActionMemberApproved",
  member_rejected: "auditActionMemberRejected",
  contribution_created: "auditActionContributionCreated",
  contribution_updated: "auditActionContributionUpdated",
  contribution_paused: "auditActionContributionPaused",
  contribution_resumed: "auditActionContributionResumed",
  contribution_locked: "auditActionContributionLocked",
  contribution_deleted: "auditActionContributionDeleted",
  admin_recorded_payment: "auditActionAdminRecordedPayment",
  relative_payment_initiated: "auditActionRelativePaymentInitiated",
  member_code_generated: "auditActionMemberCodeGenerated",
  member_code_regenerated: "auditActionMemberCodeRegenerated",
  reminder_scheduled: "auditActionReminderScheduled",
  admin_broadcast_scheduled: "auditActionAdminBroadcastScheduled",
  payout_released: "auditActionPayoutReleased",
  payout_confirmed_by_admin_override: "auditActionPayoutConfirmedByAdminOverride",
  refund_triggered: "auditActionRefundTriggered",
  refund_failed_manual_review: "auditActionRefundFailedManualReview",
};

const RESOURCE_KEY: Record<string, Parameters<typeof translate>[1]> = {
  User: "auditResourceUser",
  Membership: "auditResourceMembership",
  MembershipSlot: "auditResourceMembershipSlot",
  TontineSession: "auditResourceTontineSession",
  Contribution: "auditResourceContribution",
  Payout: "auditResourcePayout",
  PaymentAttempt: "auditResourcePaymentAttempt",
  SecuritySettings: "auditResourceSecuritySettings",
};

const STATUS_KEY: Record<AuditLogRow["status"], Parameters<typeof translate>[1]> = {
  SUCCESS: "auditStatusSuccess",
  FAILED: "auditStatusFailed",
  BLOCKED: "auditStatusBlocked",
};

const STATUS_BADGE: Record<AuditLogRow["status"], string> = {
  SUCCESS: "bg-primary/10 text-primary",
  FAILED: "bg-error/10 text-error",
  BLOCKED: "bg-error/10 text-error",
};

interface Filters {
  startDate: string;
  endDate: string;
  actor: string;
  action: string;
  resourceType: string;
  status: string;
}

const EMPTY_FILTERS: Filters = { startDate: "", endDate: "", actor: "", action: "", resourceType: "", status: "" };

export function AuditLogsClient({ lang }: { lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [logs, setLogs] = useState<AuditLogRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(30);
  const [detail, setDetail] = useState<AuditLogRow | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.startDate) params.set("startDate", filters.startDate);
    if (filters.endDate) params.set("endDate", filters.endDate);
    if (filters.actor) params.set("actor", filters.actor);
    if (filters.action) params.set("action", filters.action);
    if (filters.resourceType) params.set("resourceType", filters.resourceType);
    if (filters.status) params.set("status", filters.status);
    params.set("page", String(page));

    // Light debounce so the free-text actor search doesn't fire a request per keystroke.
    const handle = setTimeout(() => {
      fetch(`/api/admin/audit-logs?${params.toString()}`)
        .then((r) => r.json())
        .then((b) => {
          setLogs(b.logs ?? []);
          setTotal(b.total ?? 0);
          setPageSize(b.pageSize ?? 30);
        });
    }, 300);
    return () => clearTimeout(handle);
  }, [filters, page]);

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setPage(1);
    setFilters((f) => ({ ...f, [key]: value }));
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-2">
        <label className="flex flex-col gap-1 font-label-sm text-label-sm text-on-surface-variant">
          {t("auditFilterStartDate")}
          <input
            type="date"
            value={filters.startDate}
            onChange={(e) => updateFilter("startDate", e.target.value)}
            className="border border-outline-variant rounded-lg px-2 py-1.5 font-label-sm text-label-sm"
          />
        </label>
        <label className="flex flex-col gap-1 font-label-sm text-label-sm text-on-surface-variant">
          {t("auditFilterEndDate")}
          <input
            type="date"
            value={filters.endDate}
            onChange={(e) => updateFilter("endDate", e.target.value)}
            className="border border-outline-variant rounded-lg px-2 py-1.5 font-label-sm text-label-sm"
          />
        </label>
        <label className="flex flex-col gap-1 font-label-sm text-label-sm text-on-surface-variant col-span-2">
          {t("auditFilterActor")}
          <input
            type="text"
            value={filters.actor}
            onChange={(e) => updateFilter("actor", e.target.value)}
            placeholder={t("auditFilterActorPlaceholder")}
            className="border border-outline-variant rounded-lg px-2 py-1.5 font-label-sm text-label-sm"
          />
        </label>
        <label className="flex flex-col gap-1 font-label-sm text-label-sm text-on-surface-variant">
          {t("auditFilterAction")}
          <select
            value={filters.action}
            onChange={(e) => updateFilter("action", e.target.value)}
            className="border border-outline-variant rounded-lg px-2 py-1.5 font-label-sm text-label-sm"
          >
            <option value="">{t("auditFilterActionAll")}</option>
            {Object.entries(ACTION_KEY).map(([value, key]) => (
              <option key={value} value={value}>
                {t(key)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 font-label-sm text-label-sm text-on-surface-variant">
          {t("auditFilterResourceType")}
          <select
            value={filters.resourceType}
            onChange={(e) => updateFilter("resourceType", e.target.value)}
            className="border border-outline-variant rounded-lg px-2 py-1.5 font-label-sm text-label-sm"
          >
            <option value="">{t("auditFilterResourceTypeAll")}</option>
            {Object.entries(RESOURCE_KEY).map(([value, key]) => (
              <option key={value} value={value}>
                {t(key)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 font-label-sm text-label-sm text-on-surface-variant">
          {t("auditFilterStatus")}
          <select
            value={filters.status}
            onChange={(e) => updateFilter("status", e.target.value)}
            className="border border-outline-variant rounded-lg px-2 py-1.5 font-label-sm text-label-sm"
          >
            <option value="">{t("auditFilterStatusAll")}</option>
            {(["SUCCESS", "FAILED", "BLOCKED"] as const).map((s) => (
              <option key={s} value={s}>
                {t(STATUS_KEY[s])}
              </option>
            ))}
          </select>
        </label>
      </div>
      {(filters.startDate || filters.endDate || filters.actor || filters.action || filters.resourceType || filters.status) && (
        <button
          onClick={() => {
            setPage(1);
            setFilters(EMPTY_FILTERS);
          }}
          className="self-start font-label-sm text-label-sm text-primary underline"
        >
          {t("auditFilterClear")}
        </button>
      )}

      {!logs ? (
        <LoadingSpinner />
      ) : logs.length === 0 ? (
        <p className="font-label-sm text-label-sm text-on-surface-variant">{t("auditLogsEmptyState")}</p>
      ) : (
        <div className="border border-outline-variant/30 rounded-lg overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-surface-container-low">
              <tr>
                <th className="p-2 font-label-sm text-label-sm text-on-surface-variant">{t("auditColumnDate")}</th>
                <th className="p-2 font-label-sm text-label-sm text-on-surface-variant">{t("auditColumnActor")}</th>
                <th className="p-2 font-label-sm text-label-sm text-on-surface-variant">{t("auditColumnAction")}</th>
                <th className="p-2 font-label-sm text-label-sm text-on-surface-variant">{t("auditColumnResource")}</th>
                <th className="p-2 font-label-sm text-label-sm text-on-surface-variant">{t("auditColumnStatus")}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr
                  key={log.id}
                  onClick={() => setDetail(log)}
                  className="border-t border-outline-variant/30 hover:bg-surface-container-lowest cursor-pointer"
                >
                  <td className="p-2 font-label-sm text-label-sm text-on-surface-variant whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString("en-GB", { timeZone: "Africa/Douala" })}
                  </td>
                  <td className="p-2 font-label-sm text-label-sm text-on-surface truncate max-w-[160px]">
                    {log.actorName ?? t("auditSystemActor")}
                  </td>
                  <td className="p-2 font-label-sm text-label-sm text-on-surface">
                    {t(ACTION_KEY[log.action] ?? "auditColumnAction")}
                    {!ACTION_KEY[log.action] && <span className="text-on-surface-variant"> ({log.action})</span>}
                  </td>
                  <td className="p-2 font-label-sm text-label-sm text-on-surface-variant">
                    {t(RESOURCE_KEY[log.targetType] ?? "auditColumnResource")}
                    {!RESOURCE_KEY[log.targetType] && <span> ({log.targetType})</span>}
                  </td>
                  <td className="p-2">
                    <span className={`px-2 py-0.5 rounded-full font-label-sm text-[11px] ${STATUS_BADGE[log.status]}`}>
                      {t(STATUS_KEY[log.status])}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {logs && logs.length > 0 && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-3 py-1.5 rounded border border-outline-variant font-label-sm text-label-sm disabled:opacity-50"
          >
            {t("auditPrevPage")}
          </button>
          <span className="font-label-sm text-label-sm text-on-surface-variant">
            {t("auditPageOf", { page: String(page), total: String(totalPages) })}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1.5 rounded border border-outline-variant font-label-sm text-label-sm disabled:opacity-50"
          >
            {t("auditNextPage")}
          </button>
        </div>
      )}

      {detail && <AuditLogDetailModal log={detail} lang={lang} onClose={() => setDetail(null)} />}
    </div>
  );
}

function AuditLogDetailModal({ log, lang, onClose }: { log: AuditLogRow; lang: Lang; onClose: () => void }) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-container-padding bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-white rounded-2xl p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-stack-gap-md">
          <h2 className="font-title-md text-title-md text-on-surface">{t("auditDetailTitle")}</h2>
          <button onClick={onClose} className="material-symbols-outlined text-on-surface-variant">
            close
          </button>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 font-label-sm text-label-sm mb-stack-gap-md">
          <span className="text-on-surface-variant">{t("auditColumnDate")}</span>
          <span className="text-on-surface">{new Date(log.createdAt).toLocaleString("en-GB", { timeZone: "Africa/Douala" })}</span>
          <span className="text-on-surface-variant">{t("auditColumnActor")}</span>
          <span className="text-on-surface">{log.actorName ?? t("auditSystemActor")}{log.actorEmail ? ` (${log.actorEmail})` : ""}</span>
          <span className="text-on-surface-variant">{t("auditColumnAction")}</span>
          <span className="text-on-surface">{t(ACTION_KEY[log.action] ?? "auditColumnAction")}</span>
          <span className="text-on-surface-variant">{t("auditColumnResource")}</span>
          <span className="text-on-surface">
            {t(RESOURCE_KEY[log.targetType] ?? "auditColumnResource")} {log.targetId ? `— ${log.targetId}` : ""}
          </span>
          <span className="text-on-surface-variant">{t("auditColumnStatus")}</span>
          <span className="text-on-surface">{t(STATUS_KEY[log.status])}</span>
          {log.failureReason && (
            <>
              <span className="text-on-surface-variant">{t("auditDetailFailureReason")}</span>
              <span className="text-error">{log.failureReason}</span>
            </>
          )}
          <span className="text-on-surface-variant">{t("auditDetailIpAddress")}</span>
          <span className="text-on-surface">{log.ipAddress ?? "—"}</span>
          <span className="text-on-surface-variant">{t("auditDetailUserAgent")}</span>
          <span className="text-on-surface truncate">{log.userAgent ?? "—"}</span>
        </div>

        {(log.payloadBefore != null || log.payloadAfter != null) && (
          <div className="grid grid-cols-2 gap-2 mb-stack-gap-md">
            <div>
              <p className="font-label-sm text-label-sm text-on-surface-variant mb-1">{t("auditDetailBefore")}</p>
              <pre className="bg-surface-container-lowest border border-outline-variant/30 rounded-lg p-2 text-[11px] overflow-x-auto whitespace-pre-wrap break-words">
                {log.payloadBefore != null ? JSON.stringify(log.payloadBefore, null, 2) : t("auditDetailNoPayload")}
              </pre>
            </div>
            <div>
              <p className="font-label-sm text-label-sm text-on-surface-variant mb-1">{t("auditDetailAfter")}</p>
              <pre className="bg-surface-container-lowest border border-outline-variant/30 rounded-lg p-2 text-[11px] overflow-x-auto whitespace-pre-wrap break-words">
                {log.payloadAfter != null ? JSON.stringify(log.payloadAfter, null, 2) : t("auditDetailNoPayload")}
              </pre>
            </div>
          </div>
        )}

        {log.metadata != null && (
          <div>
            <p className="font-label-sm text-label-sm text-on-surface-variant mb-1">{t("auditDetailMetadata")}</p>
            <pre className="bg-surface-container-lowest border border-outline-variant/30 rounded-lg p-2 text-[11px] overflow-x-auto whitespace-pre-wrap break-words">
              {JSON.stringify(log.metadata, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
