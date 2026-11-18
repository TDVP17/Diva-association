import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/require-admin";
import { prisma } from "@/lib/prisma";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { logAudit } from "@/lib/audit";

const decideSchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]),
  rejectionReason: z.string().trim().max(300).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = decideSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body data" }, { status: 400 });
  }

  const { status, rejectionReason } = parsed.data;

  try {
    const existing = await prisma.savedPaymentMethod.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Disbursement method not found" }, { status: 404 });
    }

    const updated = await prisma.savedPaymentMethod.update({
      where: { id },
      data: {
        status,
        rejectionReason: status === "REJECTED" ? rejectionReason || "Informations non conformes" : null,
        verifiedAt: status === "PENDING" ? null : new Date(),
        verifiedByAdminId: status === "PENDING" ? null : admin.user.id,
      },
    });

    // Notify the member
    const lang = existing.user.preferredLang === "en" ? "en" : "fr";
    const providerName = existing.provider === "ORANGE" ? "Orange Money" : "MTN Mobile Money";

    const notifMessage =
      status === "APPROVED"
        ? lang === "fr"
          ? `Votre numéro de retrait ${providerName} (${existing.phone} - ${existing.accountName || ""}) a été validé par DIVA Asso. Vous pouvez désormais recevoir vos décaissements automatiques.`
          : `Your ${providerName} payout number (${existing.phone}) has been approved by DIVA Asso.`
        : status === "PENDING"
          ? lang === "fr"
            ? `La validation de votre numéro de retrait ${providerName} (${existing.phone}) a été annulée et remise en attente de vérification par DIVA Asso.`
            : `The approval of your ${providerName} payout number (${existing.phone}) was reverted to pending verification.`
          : lang === "fr"
            ? `Votre numéro de retrait ${providerName} (${existing.phone}) a été refusé par DIVA Asso. Motif : ${rejectionReason || "Nom non conforme"}.`
            : `Your ${providerName} payout number (${existing.phone}) was rejected by DIVA Asso. Reason: ${rejectionReason || "Name mismatch"}.`;

    await scheduleInAppNotifications({
      type: "ADMIN_BROADCAST",
      recipients: [
        {
          userId: existing.userId,
          message: notifMessage,
          actionUrl: "/profile",
        },
      ],
    });

    await logAudit({
      actorId: admin.user.id,
      actorRole: admin.user.role,
      action: `disbursement_method_${status.toLowerCase()}`,
      targetType: "SavedPaymentMethod",
      targetId: id,
      metadata: { phone: existing.phone, provider: existing.provider, status, rejectionReason },
      request,
    });

    return NextResponse.json({ ok: true, method: updated });
  } catch (err) {
    console.error("[api/admin/disbursement-methods/[id] PATCH] error:", err);
    return NextResponse.json({ error: "Failed to update disbursement status" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const existing = await prisma.savedPaymentMethod.findUnique({
      where: { id },
      include: { user: { select: { id: true, preferredLang: true } } },
    });
    if (!existing) {
      return NextResponse.json({ error: "Numéro de retrait introuvable." }, { status: 404 });
    }

    await prisma.savedPaymentMethod.delete({ where: { id } });

    const lang = existing.user.preferredLang === "en" ? "en" : "fr";
    const providerName = existing.provider === "ORANGE" ? "Orange Money" : "MTN Mobile Money";

    await scheduleInAppNotifications({
      type: "ADMIN_BROADCAST",
      recipients: [
        {
          userId: existing.userId,
          message:
            lang === "fr"
              ? `Votre numéro de retrait ${providerName} (${existing.phone}) a été supprimé par l'administration DIVA Asso. Vous pouvez enregistrer un nouveau numéro dans votre profil.`
              : `Your ${providerName} payout number (${existing.phone}) was deleted by DIVA Asso administration.`,
          actionUrl: "/profile",
        },
      ],
    }).catch(() => {});

    await logAudit({
      actorId: admin.user.id,
      actorRole: admin.user.role,
      action: "disbursement_method_deleted",
      targetType: "SavedPaymentMethod",
      targetId: id,
      metadata: { phone: existing.phone, provider: existing.provider, userId: existing.userId },
      request,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/admin/disbursement-methods/[id] DELETE] error:", err);
    return NextResponse.json({ error: "Impossible de supprimer ce numéro de retrait." }, { status: 500 });
  }
}
