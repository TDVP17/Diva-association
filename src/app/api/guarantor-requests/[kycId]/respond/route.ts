import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { logAudit } from "@/lib/audit";

const respondSchema = z.object({
  decision: z.enum(["ACCEPTED", "DECLINED"]),
  acceptedTerms: z.boolean().optional(),
  reason: z.string().trim().max(300).optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ kycId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const guarantorId = session.user.id;
  const { kycId } = await context.params;

  const body = await request.json().catch(() => null);
  const parsed = respondSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Données invalides." }, { status: 400 });
  }

  const { decision, acceptedTerms, reason } = parsed.data;
  if (decision === "ACCEPTED" && !acceptedTerms) {
    return NextResponse.json(
      { error: "Vous devez lire et cocher l'acceptation des engagements de garant avant de valider." },
      { status: 400 },
    );
  }

  const kyc = await prisma.kycVerification.findFirst({
    where: { id: kycId, referrerUserId: guarantorId },
    include: {
      user: { select: { id: true, name: true, preferredLang: true } },
      tontineSession: { select: { id: true, title: true, type: true } },
    },
  });

  if (!kyc) {
    return NextResponse.json({ error: "Demande de garant introuvable." }, { status: 404 });
  }
  if (kyc.guarantorStatus !== "PENDING") {
    return NextResponse.json({ error: "Vous avez déjà répondu à cette demande." }, { status: 409 });
  }

  const now = new Date();
  await prisma.kycVerification.update({
    where: { id: kyc.id },
    data: {
      guarantorStatus: decision,
      ...(decision === "ACCEPTED"
        ? { guarantorAcceptedAt: now, guarantorDeclineReason: null }
        : { guarantorDeclinedAt: now, guarantorDeclineReason: reason || "Refusé par le garant" }),
    },
  });

  const sessionTitle = kyc.tontineSession.title || kyc.tontineSession.type;
  const guarantorName = session.user.name || "Le garant";

  // Notify applicant
  await scheduleInAppNotifications({
    tontineSessionId: kyc.tontineSessionId,
    type: "ADMIN_BROADCAST",
    recipients: [
      {
        userId: kyc.userId,
        message:
          decision === "ACCEPTED"
            ? `✅ ${guarantorName} a accepté d'être votre garant pour « ${sessionTitle} » ! Votre dossier est maintenant prêt pour validation finale par l'administrateur.`
            : `❌ ${guarantorName} a décliné votre demande de garant pour « ${sessionTitle} ».${reason ? ` Motif : ${reason}` : ""}`,
        actionUrl: `/sessions/${kyc.tontineSessionId}`,
      },
    ],
  }).catch(() => {});

  // Notify Admins so they see the guarantor has accepted and can now approve the applicant!
  const admins = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "PRESIDENT"] }, isBanned: false },
    select: { id: true },
  });
  if (admins.length > 0) {
    await scheduleInAppNotifications({
      tontineSessionId: kyc.tontineSessionId,
      type: "NEW_MEMBERSHIP_REQUEST",
      recipients: admins.map((a) => ({
        userId: a.id,
        message:
          decision === "ACCEPTED"
            ? `✅ Accord du garant validé : ${guarantorName} a lu et accepté d'être garant de ${kyc.user.name} pour « ${sessionTitle} ». Vous pouvez maintenant valider son entrée !`
            : `⚠️ Refus du garant : ${guarantorName} a refusé d'être garant de ${kyc.user.name} pour « ${sessionTitle} ».`,
        actionUrl: "/admin/membership-requests",
      })),
    }).catch(() => {});
  }

  await logAudit({
    actorId: guarantorId,
    actorRole: session.user.role,
    action: decision === "ACCEPTED" ? "guarantor_accepted" : "guarantor_declined",
    targetType: "KycVerification",
    targetId: kyc.id,
    tontineSessionId: kyc.tontineSessionId,
    metadata: { applicantId: kyc.userId, decision, reason },
    request,
  });

  return NextResponse.json({
    ok: true,
    guarantorStatus: decision,
    message:
      decision === "ACCEPTED"
        ? `Vous êtes désormais le garant officiel de ${kyc.user.name}. L'administrateur a été notifié pour valider son adhésion !`
        : "Votre refus a bien été enregistré et transmis.",
  });
}

