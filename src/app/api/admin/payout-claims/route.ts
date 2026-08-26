import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";

const TONTINE_LABELS: Record<string, string> = {
  HEBDO_SUNDAY: "Weekly Tontine",
  MONTHLY_28: "Monthly Tontine (28th)",
  MONTHLY_25: "Monthly Tontine (25th)",
};

// Cross-contribution "Food Requests" list for the admin top-right menu —
// same claims shown per-contribution in the Food Turn tab, just not
// scoped to one tontineSessionId. Reuses the existing review/release/
// confirm-override endpoints for actions; this route is read-only.
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const claims = await prisma.payout.findMany({
    where: { status: { not: "CONFIRMED" } },
    include: {
      membershipSlot: { include: { membership: { include: { user: true } } } },
      tontineSession: { select: { id: true, title: true, type: true } },
    },
    orderBy: { detailsSubmittedAt: "desc" },
  });

  return NextResponse.json({
    claims: claims.map((c) => ({
      id: c.id,
      status: c.status,
      beneficiaryName: c.membershipSlot.beneficiaryName,
      memberName: c.membershipSlot.membership.user.name,
      payoutPhone: c.payoutPhone,
      payoutAccountName: c.payoutAccountName,
      tontineSessionId: c.tontineSession.id,
      contributionLabel: c.tontineSession.title || TONTINE_LABELS[c.tontineSession.type],
      detailsSubmittedAt: c.detailsSubmittedAt.toISOString(),
      releasedAt: c.releasedAt?.toISOString() ?? null,
    })),
  });
}
