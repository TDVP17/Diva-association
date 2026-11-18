import crypto from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { sendEmailSafe } from "@/lib/email/resend";
import { renderBrandedEmailHtml } from "@/lib/email/template";
import { logAudit } from "@/lib/audit";

const decideSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  reason: z.string().trim().max(400).optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = decideSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Décision invalide" }, { status: 400 });
  }

  const tontine = await prisma.tontineSession.findUnique({
    where: { id },
    include: {
      creator: { select: { id: true, name: true, email: true } },
    },
  });

  if (!tontine || !tontine.isPrivate) {
    return NextResponse.json({ error: "Cotisation privée introuvable" }, { status: 404 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://divaasso.com";

  if (parsed.data.decision === "APPROVE") {
    const inviteToken = tontine.inviteToken || crypto.randomBytes(12).toString("base64url");
    const updated = await prisma.tontineSession.update({
      where: { id },
      data: {
        privateApprovalStatus: "APPROVED",
        privateRejectionReason: null,
        inviteToken,
      },
    });

    const inviteUrl = `${baseUrl}/join/${inviteToken}`;

    if (tontine.creator) {
      await scheduleInAppNotifications({
        tontineSessionId: tontine.id,
        type: "ADMIN_BROADCAST",
        recipients: [
          {
            userId: tontine.creator.id,
            message: `Votre cotisation privée « ${tontine.title || "Cotisation privée"} » a été validée par DIVA Asso ! Votre lien d'invitation est désormais actif.`,
            actionUrl: "/private-tontines",
          },
        ],
      }).catch((err) => console.error("[admin/private-tontines] notify creator error:", err));

      if (tontine.creator.email) {
        const subject = `Cotisation privée validée : ${tontine.title || "DIVA Asso"}`;
        const text = [
          `Bonjour ${tontine.creator.name},`,
          "",
          `Votre cotisation privée « ${tontine.title || "Cotisation privée"} » a été approuvée par l'administration DIVA Asso.`,
          "",
          `Votre lien d'invitation sécurisé est désormais disponible :`,
          inviteUrl,
          "",
          `Rappel : chaque personne invitée devra posséder un compte DIVA Asso avant de pouvoir intégrer votre cotisation privée.`,
          "",
          `Cordialement,`,
          `L'équipe DIVA Asso.`,
        ].join("\n");
        const html = renderBrandedEmailHtml({
          title: subject,
          bodyText: text,
          actionUrl: "/private-tontines",
          actionLabel: "Gérer ma cotisation privée",
          lang: "fr",
        });
        await sendEmailSafe(tontine.creator.email, subject, html).catch(() => { });
      }
    }

    await logAudit({
      actorId: admin.user.id,
      actorRole: admin.user.role,
      action: "private_tontine_admin_approved",
      targetType: "TontineSession",
      targetId: tontine.id,
      tontineSessionId: tontine.id,
      request,
    });

    return NextResponse.json({
      ok: true,
      privateApprovalStatus: updated.privateApprovalStatus,
      inviteUrl,
    });
  }

  // REJECT
  const reason = parsed.data.reason || "Votre demande de cotisation privée n'a pas été approuvée par DIVA Asso.";
  const updated = await prisma.tontineSession.update({
    where: { id },
    data: {
      privateApprovalStatus: "REJECTED",
      privateRejectionReason: reason,
      inviteToken: null,
    },
  });

  if (tontine.creator) {
    await scheduleInAppNotifications({
      tontineSessionId: tontine.id,
      type: "ADMIN_BROADCAST",
      recipients: [
        {
          userId: tontine.creator.id,
          message: `Votre cotisation privée « ${tontine.title || "Cotisation privée"} » n'a pas été approuvée par DIVA Asso. Motif : ${reason}`,
          actionUrl: "/private-tontines",
        },
      ],
    }).catch((err) => console.error("[admin/private-tontines] notify reject error:", err));

    if (tontine.creator.email) {
      const subject = `Demande de cotisation privée refusée : ${tontine.title || "DIVA Asso"}`;
      const text = [
        `Bonjour ${tontine.creator.name},`,
        "",
        `Votre demande de création de cotisation privée « ${tontine.title || "Cotisation privée"} » a été refusée par DIVA Asso.`,
        `Motif : ${reason}`,
        "",
        `Cordialement,`,
        `L'équipe DIVA Asso.`,
      ].join("\n");
      const html = renderBrandedEmailHtml({
        title: subject,
        bodyText: text,
        actionUrl: "/private-tontines",
        actionLabel: "Voir mes cotisations privées",
        lang: "fr",
      });
      await sendEmailSafe(tontine.creator.email, subject, html).catch(() => { });
    }
  }

  await logAudit({
    actorId: admin.user.id,
    actorRole: admin.user.role,
    action: "private_tontine_admin_rejected",
    targetType: "TontineSession",
    targetId: tontine.id,
    tontineSessionId: tontine.id,
    metadata: { reason },
    request,
  });

  return NextResponse.json({
    ok: true,
    privateApprovalStatus: updated.privateApprovalStatus,
  });
}
