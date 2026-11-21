import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { sendEmailSafe } from "@/lib/email/resend";
import { renderBrandedEmailHtml } from "@/lib/email/template";
import { logAudit } from "@/lib/audit";

const responseSchema = z.object({
  decision: z.enum(["ACCEPT", "REJECT"]),
  rejectionReason: z.string().trim().max(300).optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const guarantorUserId = session.user.id;
  const { id } = await context.params;

  const body = await request.json().catch(() => null);
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Décision invalide" }, { status: 400 });
  }
  const { decision, rejectionReason } = parsed.data;

  const tontine = await prisma.tontineSession.findUnique({
    where: { id },
    include: {
      creator: { select: { id: true, name: true, email: true, preferredLang: true } },
    },
  });

  if (!tontine || !tontine.isPrivate) {
    return NextResponse.json({ error: "Cotisation privée introuvable." }, { status: 404 });
  }

  const config = (tontine.privateConfig as Record<string, unknown> | null) ?? {};
  if (config.guarantorId !== guarantorUserId) {
    return NextResponse.json(
      { error: "Vous n'êtes pas le garant désigné pour cette cotisation privée." },
      { status: 403 },
    );
  }

  const guarantorUser = await prisma.user.findUnique({
    where: { id: guarantorUserId },
    select: { name: true, email: true, phone: true },
  });

  const updatedConfig = {
    ...config,
    guarantorStatus: decision === "ACCEPT" ? "ACCEPTED" : "REJECTED",
    guarantorRespondedAt: new Date().toISOString(),
    ...(decision === "REJECT" && rejectionReason ? { guarantorRejectionReason: rejectionReason } : {}),
  };

  await prisma.tontineSession.update({
    where: { id },
    data: {
      privateConfig: updatedConfig,
    },
  });

  // Notify creator
  if (tontine.creator) {
    const creatorLang = tontine.creator.preferredLang === "en" ? "en" : "fr";
    const creatorMessage =
      decision === "ACCEPT"
        ? (creatorLang === "fr"
            ? `${guarantorUser?.name || "Votre garant"} a accepté votre demande de cautionnement pour « ${tontine.title} ». Votre dossier est désormais transmis à l'administrateur DIVA Asso pour validation finale.`
            : `${guarantorUser?.name || "Your guarantor"} accepted your guarantee request for "${tontine.title}". Your application is now with the DIVA Asso admin for final validation.`)
        : (creatorLang === "fr"
            ? `${guarantorUser?.name || "Votre garant"} a décliné votre demande de cautionnement pour « ${tontine.title} ».`
            : `${guarantorUser?.name || "Your guarantor"} declined your guarantee request for "${tontine.title}".`);

    await scheduleInAppNotifications({
      tontineSessionId: tontine.id,
      type: "ADMIN_BROADCAST",
      recipients: [
        {
          userId: tontine.creator.id,
          message: creatorMessage,
          actionUrl: "/private-tontines",
        },
      ],
    }).catch(() => {});

    if (tontine.creator.email) {
      const emailTitle =
        decision === "ACCEPT"
          ? (creatorLang === "fr" ? "Garant validé pour votre cotisation privée ! 🌿" : "Guarantor confirmed for your private tontine! 🌿")
          : (creatorLang === "fr" ? "Réponse à votre demande de garant" : "Update on your guarantor request");

      const emailHtml = renderBrandedEmailHtml({
        title: emailTitle,
        bodyText: creatorMessage,
        actionUrl: "/private-tontines",
        actionLabel: creatorLang === "fr" ? "Voir ma cotisation privée" : "View my private tontine",
        recipientName: tontine.creator.name,
        lang: creatorLang,
      });
      await sendEmailSafe(tontine.creator.email, emailTitle, emailHtml).catch(() => {});
    }
  }

  // If accepted, notify admins
  if (decision === "ACCEPT") {
    const admins = await prisma.user.findMany({
      where: { role: { in: ["ADMIN", "PRESIDENT"] }, isBanned: false },
      select: { id: true },
    });
    if (admins.length > 0) {
      await scheduleInAppNotifications({
        tontineSessionId: tontine.id,
        type: "ADMIN_BROADCAST",
        recipients: admins.map((a) => ({
          userId: a.id,
          message: `Le garant ${guarantorUser?.name} a accepté de cautionner la cotisation privée « ${tontine.title} » de ${tontine.creator?.name}. Le dossier est prêt pour votre validation finale.`,
          actionUrl: "/admin/private-tontines",
        })),
      }).catch(() => {});
    }
  }

  await logAudit({
    actorId: guarantorUserId,
    actorRole: session.user.role,
    action: decision === "ACCEPT" ? "private_guarantor_accepted" : "private_guarantor_rejected",
    targetType: "TontineSession",
    targetId: tontine.id,
    metadata: { decision, rejectionReason, tontineTitle: tontine.title },
    request,
  });

  return NextResponse.json({
    ok: true,
    decision,
    message:
      decision === "ACCEPT"
        ? "Merci ! Vous avez accepté d'être le garant de cette cotisation privée."
        : "Vous avez décliné la demande de cautionnement.",
  });
}

