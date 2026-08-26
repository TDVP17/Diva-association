import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// Display-only eligibility signal — deliberately does NOT block joining a
// new contribution (confirmed business rule: unpaid fines are surfaced,
// not enforced as a hard gate).
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const fines = await prisma.fine.findMany({
    where: { membershipSlot: { membership: { userId: session.user.id } }, status: "UNPAID" },
  });

  const totalUnpaid = fines.reduce((sum, f) => sum + Number(f.amount), 0);
  return NextResponse.json({ hasUnpaidFines: fines.length > 0, totalUnpaid, count: fines.length });
}
