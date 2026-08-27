"use client";

import { useEffect, useState } from "react";
import { translate, type Lang } from "@/lib/i18n/translations";

interface MembershipRequest {
  id: string;
  joinedAt: string;
  user: { id: string; name: string; avatar: string | null; image: string | null };
  tontineSession: { id: string; title: string | null; type: string; status: string };
  kycVerification: {
    documentType: string;
    matchConfidence: number | null;
    documentImageUrl: string | null;
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

  useEffect(() => {
    fetch("/api/admin/membership-queue")
      .then((r) => r.json())
      .then((b) => setMembershipQueue(b.memberships ?? []));
  }, []);

  async function decideMembership(request: MembershipRequest, action: "approve" | "reject") {
    let reason: string | null = null;
    if (action === "reject") {
      reason = window.prompt(t("rejectionReasonLabel"), "");
      if (reason === null) return; // admin cancelled the prompt
    }
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
    return <p className="font-label-sm text-label-sm text-on-surface-variant">…</p>;
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
              <button
                onClick={() => decideMembership(m, "reject")}
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
          {m.kycVerification && (
            <div className="flex items-center gap-3 pl-12 flex-wrap">
              <span className="font-label-sm text-label-sm text-on-surface-variant">
                {m.kycVerification.documentType === "CNI" ? t("cameroonianCni") : t("passport")}
              </span>
              {m.kycVerification.matchConfidence !== null && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#d1fae5] text-[#065f46] font-label-sm text-label-sm">
                  <span className="material-symbols-outlined text-[14px]">verified_user</span>
                  {t("faceMatch", { percent: m.kycVerification.matchConfidence.toFixed(0) })}
                </span>
              )}
              {m.kycVerification.documentImageUrl && (
                <a href={m.kycVerification.documentImageUrl} target="_blank" rel="noreferrer" className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={m.kycVerification.documentImageUrl}
                    alt={t("viewDocument")}
                    className="w-20 h-14 object-cover rounded-md border border-outline-variant"
                  />
                  <span className="font-label-sm text-label-sm text-primary underline">{t("viewDocument")}</span>
                </a>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
