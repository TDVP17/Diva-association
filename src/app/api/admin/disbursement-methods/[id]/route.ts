import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/require-admin";
import { prisma } from "@/lib/prisma";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";

const decideSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
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
        verifiedAt: new Date(),
        verifiedByAdminId: admin.user.id,
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

    return NextResponse.json({ ok: true, method: updated });
  } catch (err) {
    console.error("[api/admin/disbursement-methods/[id] PATCH] error:", err);
    return NextResponse.json({ error: "Failed to update disbursement status" }, { status: 500 });
  }
}
