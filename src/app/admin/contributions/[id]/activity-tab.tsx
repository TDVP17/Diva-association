"use client";

import { useEffect, useState } from "react";
import { translate, type Lang } from "@/lib/i18n/translations";
import { LoadingSpinner } from "@/components/loading-spinner";

interface ProfileSnapshot {
  name: string;
  email: string;
  phone: string | null;
  city: string | null;
  neighborhood: string | null;
  latitude: number | null;
  longitude: number | null;
  avatar: string | null;
  memberCode: string | null;
  accountCreatedAt: string;
}

interface KycSnapshot {
  documentType: string;
  documentImageUrl: string | null;
  documentBackImageUrl: string | null;
  selfieImageUrl: string | null;
  submittedAt: string;
}

interface AuditLogRow {
  id: string;
  action: string;
  actorName: string;
  targetType: string;
  targetId: string | null;
  createdAt: string;
  metadata: { profileSnapshot?: ProfileSnapshot; kycSnapshot?: KycSnapshot | null } | null;
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
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/admin/sessions/${tontineSessionId}/audit-log`)
      .then((r) => r.json())
      .then((b) => setLogs(b.logs ?? []));
  }, [tontineSessionId]);

  if (!logs) {
    return <LoadingSpinner className="py-6" />;
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
          {logs.map((l, i) => {
            const hasSnapshot = l.action === "member_approved" && l.metadata?.profileSnapshot;
            const expanded = expandedId === l.id;
            return (
              <div
                key={l.id}
                className={`bg-surface-container-lowest ${i < logs.length - 1 ? "border-b border-outline-variant/30" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => hasSnapshot && setExpandedId(expanded ? null : l.id)}
                  className={`w-full flex items-center justify-between p-3 text-left ${hasSnapshot ? "hover:bg-surface-container-low cursor-pointer" : "cursor-default"}`}
                >
                  <div className="min-w-0 flex items-center gap-1.5">
                    <div>
                      <p className="font-label-md text-label-md text-on-surface truncate">
                        {ACTION_LABELS[l.action] ?? l.action}
                      </p>
                      <p className="font-label-sm text-label-sm text-on-surface-variant">{l.actorName}</p>
                    </div>
                    {hasSnapshot && (
                      <span className="material-symbols-outlined text-outline text-[18px] flex-shrink-0">
                        {expanded ? "expand_less" : "expand_more"}
                      </span>
                    )}
                  </div>
                  <p className="font-label-sm text-label-sm text-on-surface-variant flex-shrink-0 ml-2">
                    {new Date(l.createdAt).toLocaleString("en-GB", { timeZone: "Africa/Douala" })}
                  </p>
                </button>
                {expanded && hasSnapshot && (
                  <div className="px-3 pb-3">
                    <MemberSnapshot
                      profile={l.metadata!.profileSnapshot!}
                      kyc={l.metadata!.kycSnapshot ?? null}
                      t={t}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function MemberSnapshot({
  profile,
  kyc,
  t,
}: {
  profile: ProfileSnapshot;
  kyc: KycSnapshot | null;
  t: (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => string;
}) {
  return (
    <div className="bg-white rounded-lg border border-outline-variant/30 p-3 flex flex-col gap-2">
      <p className="font-label-sm text-label-sm text-on-surface-variant">
        {t("snapshotAtApprovalLabel")}: {new Date(profile.accountCreatedAt).toLocaleDateString("en-GB")}
      </p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-label-sm text-label-sm">
        <span className="text-on-surface-variant">{t("emailLabel")}</span>
        <span className="text-on-surface truncate">{profile.email}</span>
        <span className="text-on-surface-variant">{t("phoneLabel")}</span>
        <span className="text-on-surface truncate">{profile.phone ?? "—"}</span>
        <span className="text-on-surface-variant">{t("gpsLocationLabel")}</span>
        <span className="text-on-surface truncate">
          {[profile.city, profile.neighborhood].filter(Boolean).join(", ") || "—"}
          {profile.latitude !== null && profile.longitude !== null && (
            <>
              {" "}
              <a
                href={`https://www.openstreetmap.org/?mlat=${profile.latitude}&mlon=${profile.longitude}#map=16/${profile.latitude}/${profile.longitude}`}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline"
              >
                {t("viewOnMap")}
              </a>
            </>
          )}
        </span>
        <span className="text-on-surface-variant">{t("submittedOnLabel")}</span>
        <span className="text-on-surface truncate">
          {kyc ? new Date(kyc.submittedAt).toLocaleDateString("en-GB") : "—"}
        </span>
      </div>
      {(profile.avatar || kyc) && (
        <div className="grid grid-cols-4 gap-2 mt-1">
          {profile.avatar && (
            <a href={profile.avatar} target="_blank" rel="noreferrer" className="flex flex-col gap-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={profile.avatar}
                alt={t("profilePhotoLabel")}
                className="w-full aspect-square object-cover rounded-lg border border-outline-variant"
              />
              <span className="font-label-sm text-[10px] text-primary text-center underline">
                {t("profilePhotoLabel")}
              </span>
            </a>
          )}
          {kyc?.documentImageUrl && (
            <a href={kyc.documentImageUrl} target="_blank" rel="noreferrer" className="flex flex-col gap-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={kyc.documentImageUrl}
                alt={t("viewDocumentFront")}
                className="w-full aspect-square object-cover rounded-lg border border-outline-variant"
              />
              <span className="font-label-sm text-[10px] text-primary text-center underline">
                {t("viewDocumentFront")}
              </span>
            </a>
          )}
          {kyc?.documentBackImageUrl && (
            <a href={kyc.documentBackImageUrl} target="_blank" rel="noreferrer" className="flex flex-col gap-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={kyc.documentBackImageUrl}
                alt={t("viewDocumentBack")}
                className="w-full aspect-square object-cover rounded-lg border border-outline-variant"
              />
              <span className="font-label-sm text-[10px] text-primary text-center underline">
                {t("viewDocumentBack")}
              </span>
            </a>
          )}
          {kyc?.selfieImageUrl && (
            <a href={kyc.selfieImageUrl} target="_blank" rel="noreferrer" className="flex flex-col gap-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={kyc.selfieImageUrl}
                alt={t("viewSelfie")}
                className="w-full aspect-square object-cover rounded-lg border border-outline-variant"
              />
              <span className="font-label-sm text-[10px] text-primary text-center underline">{t("viewSelfie")}</span>
            </a>
          )}
        </div>
      )}
    </div>
  );
}
