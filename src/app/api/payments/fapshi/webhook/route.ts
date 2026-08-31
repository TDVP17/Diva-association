import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPaymentStatus } from "@/lib/fapshi";
import { settleContribution } from "@/lib/settle-contribution";
import { settleFine } from "@/lib/settle-fine";

export async function POST(request: Request) {
  const secret = request.headers.get("x-wh-secret");
  if (!secret || secret !== process.env.FAPSHI_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json().catch(() => null);
  const transId = payload?.transId;
  if (typeof transId !== "string" || !transId) {
    return NextResponse.json({ error: "Missing transId" }, { status: 400 });
  }

  // Don't trust the webhook body's status directly — re-verify against
  // Fapshi's own API before crediting any payment.
  const verified = await getPaymentStatus(transId);
  if (verified.status !== "SUCCESSFUL") {
    return NextResponse.json({ ok: true, ignored: verified.status });
  }

  const contribution = await prisma.contribution.findUnique({
    where: { fapshiTxRef: transId },
    include: {
      membershipSlot: { include: { membership: { include: { user: true, tontineSession: true } } } },
      paidByUser: true,
    },
  });
  if (contribution) {
    if (contribution.status === "PAID") {
      return NextResponse.json({ ok: true, alreadyProcessed: true });
    }
    const paidAt = verified.dateConfirmed ? new Date(verified.dateConfirmed) : new Date();
    const baseUrl = process.env.NEXTAUTH_URL ?? new URL(request.url).origin;
    await settleContribution(contribution, { paidAt, origin: baseUrl });
    return NextResponse.json({ ok: true });
  }

  // Fines can be paid standalone (see /fines and initiateFinePayment), not
  // just bundled into a slot's current-cycle contribution — so a
  // successful transaction may match a Fine's own fapshiTxRef instead.
  const fine = await prisma.fine.findUnique({
    where: { fapshiTxRef: transId },
    include: {
      membershipSlot: { include: { membership: { include: { user: true, tontineSession: true } } } },
    },
  });
  if (fine) {
    if (fine.status === "PAID") {
      return NextResponse.json({ ok: true, alreadyProcessed: true });
    }
    await settleFine(fine);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown transaction" }, { status: 404 });
}
