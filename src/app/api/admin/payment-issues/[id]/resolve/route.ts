import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";

/** Admin confirms they refunded the payer manually outside the platform (e.g. via the Fapshi dashboard or cash). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const attempt = await prisma.paymentAttempt.findUnique({ where: { id } });
  if (!attempt) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (attempt.status === "REFUNDED") {
    return NextResponse.json({ error: "Already marked refunded" }, { status: 409 });
  }

  await prisma.paymentAttempt.update({
    where: { id },
    data: {
      status: "REFUNDED",
      refundedAt: new Date(),
      lastRefundError: `Manually resolved by ${admin.user.name ?? "Admin"}`,
    },
  });

  return NextResponse.json({ ok: true });
}
