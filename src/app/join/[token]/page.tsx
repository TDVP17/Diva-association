import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { TONTINE_TYPE_LABELS } from "@/lib/tontine-labels";
import { JoinPrivateClient } from "./join-private-client";

export default async function JoinPrivateTontinePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const tontine = await prisma.tontineSession.findUnique({
    where: { inviteToken: token },
    include: {
      creator: { select: { name: true } },
      memberships: { select: { userId: true, status: true } },
    },
  });

  if (!tontine || !tontine.isPrivate || tontine.privateApprovalStatus !== "APPROVED") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-3xl p-8 text-center shadow-lg border border-slate-200 flex flex-col items-center gap-3">
          <div className="w-14 h-14 rounded-full bg-red-50 text-red-600 flex items-center justify-center">
            <span className="material-symbols-outlined text-3xl">link_off</span>
          </div>
          <h1 className="text-xl font-bold text-slate-900">Lien d&apos;invitation introuvable</h1>
          <p className="text-sm text-slate-500">
            Ce lien d&apos;invitation est invalide, expiré ou a été réinitialisé par le gestionnaire de la tontine privée.
          </p>
          <Link
            href="/dashboard"
            className="mt-2 px-5 py-2.5 rounded-xl bg-emerald-800 text-white font-bold text-sm hover:opacity-90 transition-opacity"
          >
            Retour à l&apos;accueil DIVA Asso
          </Link>
        </div>
      </div>
    );
  }

  const session = await auth();
  const existing = session?.user?.id
    ? tontine.memberships.find((m) => m.userId === session.user.id)
    : null;

  const approvedMembersCount = tontine.memberships.filter((m) => m.status === "APPROVED").length;

  return (
    <JoinPrivateClient
      token={token}
      isSignedIn={Boolean(session?.user?.id)}
      tontine={{
        id: tontine.id,
        title: tontine.title || "Cotisation Privée",
        description: tontine.description,
        typeLabel: TONTINE_TYPE_LABELS[tontine.type] || tontine.type,
        amount: Number(tontine.amount),
        fee: Number(tontine.fee),
        startDate: tontine.startDate.toISOString(),
        limitTime: tontine.limitTime,
        maxSlots: tontine.maxSlots ? Number(tontine.maxSlots) : null,
        creatorName: tontine.creator?.name ?? "DIVA Asso",
        approvedMembersCount,
        isClosed: tontine.status === "CLOSED",
        isPaused: tontine.isPaused,
        isLocked: tontine.lockedAt !== null,
        myMembershipStatus: existing?.status ?? null,
      }}
    />
  );
}

