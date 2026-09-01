import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { ensureMemberCode } from "@/lib/member-code";
import { logAudit } from "@/lib/audit";
import { scheduleNotifications } from "@/lib/notifications/dispatch";
import { translate } from "@/lib/i18n/translations";

const bodySchema = z.object({
  action: z.enum(["approve", "reject"]),
  reason: z.string().trim().max(500).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ membershipId: string }> },
) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { membershipId } = await params;

  try {
    const existing = await prisma.membership.findUnique({
      where: { id: membershipId },
      include: { user: true, kycVerification: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Membership request not found" }, { status: 404 });
    }

    const approved = parsed.data.action === "approve";
    const membership = await prisma.membership.update({
      where: { id: membershipId },
      data: {
        status: approved ? "APPROVED" : "REJECTED",
        rejectionReason: approved ? null : (parsed.data.reason ?? null),
      },
    });

    if (approved) {
      await ensureMemberCode(membership.userId);
    }

    await prisma.kycVerification.updateMany({
      where: { membershipId: membership.id },
      data: { status: approved ? "VERIFIED" : "FAILED", verifiedAt: new Date() },
    });

    const lang = existing.user.preferredLang === "fr" ? "fr" : "en";
    const message = approved
      ? translate(lang, "memberApprovedMessage")
      : translate(lang, "memberRejectedMessage") +
        (parsed.data.reason ? translate(lang, "memberRejectedReasonSuffix", { reason: parsed.data.reason }) : "");
    await scheduleNotifications({
      tontineSessionId: membership.tontineSessionId,
      channel: "IN_APP",
      type: approved ? "MEMBER_APPROVED" : "MEMBER_REJECTED",
      recipients: [
        {
          userId: membership.userId,
          message,
          messageKey: approved ? "memberApprovedMessage" : "memberRejectedMessage",
          messageVars: approved || !parsed.data.reason ? undefined : { reason: parsed.data.reason },
          // Approved members land back on the session to pick up onboarding
          // (select slots, etc); rejected members have nowhere useful to go.
          actionUrl: approved ? `/sessions/${membership.tontineSessionId}` : undefined,
        },
      ],
    });
    // IN_APP has nothing for the cron to "send" — flip straight to SENT so
    // it appears in the member's notification feed right away.
    await prisma.notification.updateMany({
      where: { userId: membership.userId, tontineSessionId: membership.tontineSessionId, status: "SCHEDULED", type: approved ? "MEMBER_APPROVED" : "MEMBER_REJECTED" },
      data: { status: "SENT", sentAt: new Date() },
    });

    // On approval, snapshot everything about this member as it stood at
    // the moment of approval — profile, identity documents, and the full
    // verification record — so admin record-keeping/auditing has a
    // permanent copy independent of whatever the member edits on their
    // profile afterward (city, phone, avatar, etc. can all change later).
    await logAudit({
      actorId: admin.user.id,
      actorRole: admin.user.role,
      action: approved ? "member_approved" : "member_rejected",
      targetType: "Membership",
      targetId: membership.id,
      tontineSessionId: membership.tontineSessionId,
      request,
      payloadBefore: { status: existing.status },
      payloadAfter: { status: membership.status },
      metadata: {
        userId: membership.userId,
        reason: parsed.data.reason ?? null,
        ...(approved
          ? {
              profileSnapshot: {
                name: existing.user.name,
                email: existing.user.email,
                phone: existing.user.phone,
                city: existing.user.city,
                neighborhood: existing.user.neighborhood,
                latitude: existing.user.latitude ? Number(existing.user.latitude) : null,
                longitude: existing.user.longitude ? Number(existing.user.longitude) : null,
                avatar: existing.user.avatar,
                memberCode: existing.user.memberCode,
                accountCreatedAt: existing.user.createdAt.toISOString(),
              },
              kycSnapshot: existing.kycVerification
                ? {
                    documentType: existing.kycVerification.documentType,
                    documentImageUrl: existing.kycVerification.documentImageUrl,
                    documentBackImageUrl: existing.kycVerification.documentBackImageUrl,
                    selfieImageUrl: existing.kycVerification.selfieImageUrl,
                    submittedAt: existing.kycVerification.createdAt.toISOString(),
                  }
                : null,
            }
          : {}),
      },
    });

    return NextResponse.json({ id: membership.id, status: membership.status });
  } catch (err) {
    console.error("[membership/decide] unexpected error:", err);
    return NextResponse.json({ error: "Could not update this membership request" }, { status: 500 });
  }
}
