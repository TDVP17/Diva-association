import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getContributionTotal, getNextDueDate } from "@/lib/tontine-engine";
import { initiatePayment, FapshiError } from "@/lib/fapshi";

const bodySchema = z.object({
  tontineSessionId: z.string().min(1),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { tontineSessionId } = parsed.data;

  const membership = await prisma.membership.findUnique({
    where: { userId_tontineSessionId: { userId: session.user.id, tontineSessionId } },
    include: { tontineSession: true },
  });
  if (!membership || membership.tontineSession.status !== "ACTIVE") {
    return NextResponse.json({ error: "You are not an active member of this session" }, { status: 404 });
  }
  if (membership.status !== "APPROVED") {
    return NextResponse.json(
      { error: "Your membership for this session hasn't been approved yet" },
      { status: 403 },
    );
  }

  const now = new Date();
  const dueDate = getNextDueDate(membership.tontineSession.type, now);
  const { amount, fee } = getContributionTotal(membership.tontineSession.type);

  const existing = await prisma.contribution.findUnique({
    where: { userId_tontineSessionId_dueDate: { userId: session.user.id, tontineSessionId, dueDate } },
  });
  if (existing?.status === "PAID") {
    return NextResponse.json({ error: "This contribution is already paid" }, { status: 409 });
  }

  const outstandingFine = await prisma.fine.findUnique({
    where: { userId_tontineSessionId_dueDate: { userId: session.user.id, tontineSessionId, dueDate } },
  });
  const fineAmount =
    outstandingFine && outstandingFine.status === "UNPAID" ? Number(outstandingFine.amount) : 0;

  const totalAmount = amount + fee + fineAmount;

  const contribution = await prisma.contribution.upsert({
    where: { userId_tontineSessionId_dueDate: { userId: session.user.id, tontineSessionId, dueDate } },
    create: {
      userId: session.user.id,
      tontineSessionId,
      dueDate,
      amountPaid: amount,
      feePaid: fee,
      finePaid: fineAmount,
      status: "PENDING",
    },
    update: {
      amountPaid: amount,
      feePaid: fee,
      finePaid: fineAmount,
    },
  });

  const origin = new URL(request.url).origin;

  try {
    const result = await initiatePayment({
      amount: totalAmount,
      userId: session.user.id,
      externalId: contribution.id,
      redirectUrl: `${origin}/dashboard?payment=${contribution.id}`,
      message: `DIVA tontine contribution (${membership.tontineSession.type})`,
    });

    await prisma.contribution.update({
      where: { id: contribution.id },
      data: { fapshiTxRef: result.transId },
    });

    return NextResponse.json({ paymentUrl: result.link, transId: result.transId });
  } catch (error) {
    if (error instanceof FapshiError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    return NextResponse.json({ error: "Payment initiation failed" }, { status: 500 });
  }
}
