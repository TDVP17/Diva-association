import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { generatePayoutReceiptPdf } from "@/lib/payout-receipt";
import { isAdminRole } from "@/lib/constants";
import { TONTINE_TYPE_LABELS } from "@/lib/tontine-labels";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const payout = await prisma.payout.findUnique({
    where: { id },
    include: {
      tontineSession: true,
      membershipSlot: {
        include: {
          membership: {
            include: { user: true },
          },
        },
      },
    },
  });

  if (!payout) {
    return NextResponse.json({ error: "Payout not found" }, { status: 404 });
  }

  const isOwner = payout.membershipSlot.membership.userId === session.user.id;
  const isAdmin = isAdminRole(session.user.role);

  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (payout.status !== "RELEASED" && payout.status !== "CONFIRMED") {
    return NextResponse.json({ error: "Le virement n'a pas encore été validé" }, { status: 400 });
  }

  const totalSlots = await prisma.membershipSlot.count({
    where: { membership: { tontineSessionId: payout.tontineSessionId } },
  });

  const sessionTitle =
    payout.tontineSession.title ||
    TONTINE_TYPE_LABELS[payout.tontineSession.type] ||
    payout.tontineSession.type;

  const pdfBuffer = await generatePayoutReceiptPdf({
    payoutId: payout.id,
    memberName: payout.membershipSlot.membership.user.name,
    beneficiaryName: payout.membershipSlot.beneficiaryName,
    sessionTitle,
    officialPosition: payout.membershipSlot.officialPosition,
    totalPositions: totalSlots > 0 ? totalSlots : undefined,
    pot: Number(payout.pot ?? 0),
    deducted: Number(payout.deducted ?? 0),
    netPayout: Number(payout.netPayout ?? Number(payout.pot ?? 0) - Number(payout.deducted ?? 0)),
    payoutPhone: payout.payoutPhone,
    payoutAccountName: payout.payoutAccountName,
    fapshiTransId: payout.fapshiTransId,
    releasedAt: payout.releasedAt ?? payout.detailsSubmittedAt,
    status: payout.status === "CONFIRMED" ? "Confirmé & Reçu" : "Validé & Envoyé",
  });

  const cleanName = payout.membershipSlot.beneficiaryName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filename = `Recu_Gain_DIVA_${cleanName}_Tour${payout.membershipSlot.officialPosition ?? 1}.pdf`;

  return new Response(pdfBuffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
