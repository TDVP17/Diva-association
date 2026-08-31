import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getContributionTotal, getNextDueDate } from "@/lib/tontine-engine";

const TONTINE_LABELS: Record<string, string> = {
  HEBDO_SUNDAY: "Weekly Tontine",
  MONTHLY_28: "Monthly Tontine (28th)",
  MONTHLY_25: "Monthly Tontine (25th)",
};

// Lists a member's active contribution memberships for the public "pay via
// personal code" flow (see /pay), once their code has been resolved.
// Deliberately no auth() call — same reasoning as lookup-code. One entry
// per MembershipSlot (not per Membership) — satisfies the "different names
// in different contributions" requirement naturally, since each slot
// already carries its own beneficiaryName and independent Contribution
// history.
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = await params;
  const code = rawCode.trim().toUpperCase();

  const user = await prisma.user.findUnique({ where: { memberCode: code }, select: { id: true } });
  if (!user) {
    return NextResponse.json({ error: "No member found with this code" }, { status: 404 });
  }

  const memberships = await prisma.membership.findMany({
    where: { userId: user.id, status: "APPROVED", tontineSession: { status: { in: ["DRAWING", "ACTIVE"] } } },
    include: { tontineSession: true, slots: true },
  });

  const now = new Date();
  const rows = [];
  for (const m of memberships) {
    if (m.tontineSession.isPaused) continue;
    const dueDate = getNextDueDate(m.tontineSession.type, now);
    const { amount, fee } = getContributionTotal({
      amount: Number(m.tontineSession.amount),
      fee: Number(m.tontineSession.fee),
    });

    for (const slot of m.slots) {
      const contribution = await prisma.contribution.findUnique({
        where: { membershipSlotId_dueDate: { membershipSlotId: slot.id, dueDate } },
        select: { status: true },
      });
      rows.push({
        slotId: slot.id,
        beneficiaryName: slot.beneficiaryName,
        tontineSessionId: m.tontineSession.id,
        tontineSessionTitle:
          m.tontineSession.title || TONTINE_LABELS[m.tontineSession.type] || m.tontineSession.type,
        amount: amount + fee,
        alreadyPaid: contribution?.status === "PAID",
      });
    }
  }

  return NextResponse.json({ memberCode: code, slots: rows });
}
