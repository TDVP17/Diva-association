"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { translate, type Lang } from "@/lib/i18n/translations";
import { LoadingSpinner } from "@/components/loading-spinner";

interface MembershipRequest {
  id: string;
  joinedAt: string;
  user: {
    id: string;
    name: string;
    avatar: string | null;
    image: string | null;
    latitude: number | null;
    longitude: number | null;
    city: string | null;
    neighborhood: string | null;
  };
  tontineSession: { id: string; title: string | null; type: string; status: string };
  kycVerification: {
    documentType: string;
    matchConfidence: number | null;
    documentImageUrl: string | null;
    documentBackImageUrl: string | null;
    selfieImageUrl: string | null;
    referrerName: string | null;
    referrerPhone: string | null;
    verifiedAt: string | null;
  } | null;
}

const TONTINE_LABELS: Record<string, string> = {
  HEBDO_SUNDAY: "Weekly Tontine",
  MONTHLY_28: "Monthly Tontine (28th)",
  MONTHLY_25: "Monthly Tontine (25th)",
  BIWEEKLY_SUNDAY: "Every 2 Weeks",
  QUARTERLY_25: "Every 3 Months",
};

export function AdminMembershipRequestsClient({ lang }: { lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const [membershipQueue, setMembershipQueue] = useState<MembershipRequest[] | null>(null);
  const [rejectTarget, setRejectTarget] = useState<MembershipRequest | null>(null);

  useEffect(() => {
    fetch("/api/admin/membership-queue")
      .then((r) => r.json())
      .then((b) => setMembershipQueue(b.memberships ?? []));
  }, []);

  async function decideMembership(request: MembershipRequest, action: "approve" | "reject", reason?: string) {
    setMembershipQueue((q) => (q ? q.filter((m) => m.id !== request.id) : q));
    const res = await fetch(`/api/admin/membership/${request.id}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, reason: reason || undefined }),
    });
    if (!res.ok) {
      setMembershipQueue((q) => (q ? [...q, request] : q));
      window.alert(t("couldNotUpdateMembership"));
    }
  }

  if (!membershipQueue) {
    return <LoadingSpinner fullPage />;
  }

  if (membershipQueue.length === 0) {
    return <p className="font-label-sm text-label-sm text-on-surface-variant">{t("noPendingRequests")}</p>;
  }

  return (
    <div className="flex flex-col gap-0 border border-outline-variant/30 rounded-lg overflow-hidden">
      {membershipQueue.map((m) => (
        <div
          key={m.id}
          className="flex flex-col gap-2 p-3 bg-surface-container-lowest border-b last:border-b-0 border-outline-variant/30"
        >
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-full bg-tertiary-container text-on-tertiary flex items-center justify-center font-label-md text-label-md overflow-hidden flex-shrink-0">
                {m.user.avatar ?? m.user.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.user.avatar ?? m.user.image!} alt={m.user.name} className="w-full h-full object-cover" />
                ) : (
                  m.user.name.slice(0, 2).toUpperCase()
                )}
              </div>
              <p className="font-label-md text-label-md text-on-surface truncate">
                {t("wantsToJoin", {
                  name: m.user.name,
                  session: m.tontineSession.title || TONTINE_LABELS[m.tontineSession.type] || m.tontineSession.type,
                })}
              </p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <Link
                href={`/admin/support?with=${encodeURIComponent(m.user.id)}&name=${encodeURIComponent(m.user.name)}`}
                className="px-2 py-1 rounded border border-outline-variant text-on-surface-variant font-label-sm text-label-sm hover:bg-surface flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[16px]">chat_bubble</span>
                {t("messageApplicant")}
              </Link>
              <button
                onClick={() => setRejectTarget(m)}
                className="px-2 py-1 rounded border border-outline-variant text-on-surface-variant font-label-sm text-label-sm hover:bg-surface"
              >
                {t("reject")}
              </button>
              <button
                onClick={() => decideMembership(m, "approve")}
                className="px-2 py-1 rounded bg-primary text-on-primary font-label-sm text-label-sm hover:opacity-90"
              >
                {t("approve")}
              </button>
            </div>
          </div>
          <p className="font-label-sm text-label-sm text-on-surface-variant pl-12">
            {t("submittedOnLabel")}: {new Date(m.joinedAt).toLocaleString("en-GB", { timeZone: "Africa/Douala" })}
          </p>
          {(m.user.latitude !== null && m.user.longitude !== null) || m.user.city ? (
            <p className="font-label-sm text-label-sm text-on-surface-variant pl-12 flex items-center gap-1 flex-wrap">
              <span className="material-symbols-outlined text-[16px] flex-shrink-0">location_on</span>
              {[m.user.city, m.user.neighborhood].filter(Boolean).join(", ") || t("gpsLocationLabel")}
              {m.user.latitude !== null && m.user.longitude !== null && (
                <a
                  href={`https://www.openstreetmap.org/?mlat=${m.user.latitude}&mlon=${m.user.longitude}#map=16/${m.user.latitude}/${m.user.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline"
                >
                  {t("viewOnMap")}
                </a>
              )}
            </p>
          ) : null}
          {m.kycVerification && (
            <div className="pl-12">
              <p className="font-label-sm text-label-sm text-on-surface-variant mb-1.5">
                {t("cameroonianCni")} · {t("compareFacesInstruction")}
              </p>
              <div className="grid grid-cols-3 gap-2 max-w-sm">
                {m.kycVerification.documentImageUrl && (
                  <a
                    href={m.kycVerification.documentImageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex flex-col gap-1"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={m.kycVerification.documentImageUrl}
                      alt={t("viewDocumentFront")}
                      className="w-full aspect-[4/3] object-cover rounded-lg border border-outline-variant"
                    />
                    <span className="font-label-sm text-[11px] text-primary text-center underline">
                      {t("viewDocumentFront")}
                    </span>
                  </a>
                )}
                {m.kycVerification.documentBackImageUrl && (
                  <a
                    href={m.kycVerification.documentBackImageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex flex-col gap-1"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={m.kycVerification.documentBackImageUrl}
                      alt={t("viewDocumentBack")}
                      className="w-full aspect-[4/3] object-cover rounded-lg border border-outline-variant"
                    />
                    <span className="font-label-sm text-[11px] text-primary text-center underline">
                      {t("viewDocumentBack")}
                    </span>
                  </a>
                )}
                {m.kycVerification.selfieImageUrl && (
                  <a
                    href={m.kycVerification.selfieImageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex flex-col gap-1"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={m.kycVerification.selfieImageUrl}
                      alt={t("viewSelfie")}
                      className="w-full aspect-[4/3] object-cover rounded-lg border border-outline-variant"
                    />
                    <span className="font-label-sm text-[11px] text-primary text-center underline">
                      {t("viewSelfie")}
                    </span>
                  </a>
                )}
              </div>
              {(m.kycVerification.referrerName || m.kycVerification.referrerPhone) && (
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 bg-surface-container-low rounded-lg px-3 py-2 max-w-sm">
                  <span className="font-label-sm text-label-sm text-on-surface-variant flex items-center gap-1">
                    <span className="material-symbols-outlined text-[16px]">person_search</span>
                    {t("referredByLabel")}
                  </span>
                  {m.kycVerification.referrerName && (
                    <span className="font-label-sm text-label-sm text-on-surface font-semibold">
                      {m.kycVerification.referrerName}
                    </span>
                  )}
                  {m.kycVerification.referrerPhone && (
                    <span className="font-label-sm text-label-sm text-on-surface-variant">
                      {m.kycVerification.referrerPhone}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
      {rejectTarget && (
        <RejectReasonDialog
          lang={lang}
          onCancel={() => setRejectTarget(null)}
          onConfirm={(reason) => {
            decideMembership(rejectTarget, "reject", reason);
            setRejectTarget(null);
          }}
        />
      )}
    </div>
  );
}

type RejectPreset = "nonCameroonianCni" | "faceMismatch" | "other";

function RejectReasonDialog({
  lang,
  onCancel,
  onConfirm,
}: {
  lang: Lang;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const [preset, setPreset] = useState<RejectPreset>("nonCameroonianCni");
  const [customReason, setCustomReason] = useState("");

  const presetText: Record<Exclude<RejectPreset, "other">, string> = {
    nonCameroonianCni: t("rejectReasonNonCameroonianCni"),
    faceMismatch: t("rejectReasonFaceMismatch"),
  };

  function handleConfirm() {
    const reason = preset === "other" ? customReason.trim() : presetText[preset];
    if (!reason) return;
    onConfirm(reason);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-container-padding bg-black/50" onClick={onCancel}>
      <div className="w-full max-w-sm bg-white rounded-2xl p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-title-md text-title-md text-on-surface mb-stack-gap-md">{t("rejectionReasonLabel")}</h2>
        <div className="flex flex-col gap-2 mb-stack-gap-md">
          <label className="flex items-start gap-2 font-label-md text-label-md text-on-surface">
            <input
              type="radio"
              name="rejectPreset"
              checked={preset === "nonCameroonianCni"}
              onChange={() => setPreset("nonCameroonianCni")}
              className="mt-1"
            />
            {presetText.nonCameroonianCni}
          </label>
          <label className="flex items-start gap-2 font-label-md text-label-md text-on-surface">
            <input
              type="radio"
              name="rejectPreset"
              checked={preset === "faceMismatch"}
              onChange={() => setPreset("faceMismatch")}
              className="mt-1"
            />
            {presetText.faceMismatch}
          </label>
          <label className="flex items-start gap-2 font-label-md text-label-md text-on-surface">
            <input
              type="radio"
              name="rejectPreset"
              checked={preset === "other"}
              onChange={() => setPreset("other")}
              className="mt-1"
            />
            {t("rejectReasonOther")}
          </label>
          {preset === "other" && (
            <textarea
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
              rows={3}
              placeholder={t("rejectionReasonLabel")}
              className="w-full border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
            />
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-lg border border-outline-variant text-on-surface-variant font-label-md text-label-md hover:bg-surface-container-low transition-all"
          >
            {t("cancel")}
          </button>
          <button
            onClick={handleConfirm}
            disabled={preset === "other" && !customReason.trim()}
            className="flex-1 py-2.5 rounded-lg bg-error text-on-error font-label-md text-label-md hover:opacity-90 active:scale-95 transition-all disabled:opacity-60"
          >
            {t("reject")}
          </button>
        </div>
      </div>
    </div>
  );
}
