import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";

const TONTINE_LABELS: Record<string, string> = {
  HEBDO_SUNDAY: "Weekly Tontine",
  MONTHLY_28: "Monthly Tontine (28th)",
  MONTHLY_25: "Monthly Tontine (25th)",
};

const PAGE_SIZE = 50;

// Cross-session admin transaction ledger — every Contribution row is
// already the trusted transaction record (see settle-contribution.ts);
// this just surfaces it with filters instead of introducing a parallel
// "Transaction" table.
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(request.url);
  const tontineSessionId = url.searchParams.get("tontineSessionId") ?? undefined;
  const status = url.searchParams.get("status") ?? undefined;
  const memberQuery = url.searchParams.get("member")?.trim() ?? undefined;
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);

  const where = {
    ...(tontineSessionId ? { membershipSlot: { membership: { tontineSessionId } } } : {}),
    ...(status ? { status: status as "PAID" | "LATE" | "PENDING" } : {}),
    ...(memberQuery
      ? {
          OR: [
            { membershipSlot: { beneficiaryName: { contains: memberQuery, mode: "insensitive" as const } } },
            { membershipSlot: { membership: { user: { name: { contains: memberQuery, mode: "insensitive" as const } } } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.contribution.findMany({
      where,
      include: {
        membershipSlot: {
          include: { membership: { include: { user: true, tontineSession: true } } },
        },
        paidByUser: { select: { name: true } },
        recordedByAdmin: { select: { name: true } },
      },
      orderBy: { dueDate: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.contribution.count({ where }),
  ]);

  return NextResponse.json({
    total,
    page,
    pageSize: PAGE_SIZE,
    transactions: rows.map((c) => ({
      id: c.id,
      beneficiaryName: c.membershipSlot.beneficiaryName,
      memberName: c.membershipSlot.membership.user.name,
      paidByName: c.paidByUser?.name ?? c.recordedByAdmin?.name ?? null,
      tontineSessionId: c.membershipSlot.membership.tontineSessionId,
      contributionLabel:
        c.membershipSlot.membership.tontineSession.title ||
        TONTINE_LABELS[c.membershipSlot.membership.tontineSession.type],
      amount: Number(c.amountPaid) + Number(c.feePaid) + Number(c.finePaid),
      status: c.status,
      dueDate: c.dueDate.toISOString(),
      paidAt: c.paidAt ? c.paidAt.toISOString() : null,
      transRef: c.fapshiTxRef ?? c.id,
    })),
  });
}
