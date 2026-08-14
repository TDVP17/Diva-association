import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPaymentStatus } from "@/lib/fapshi";
import { generateReceiptPdf } from "@/lib/receipt";
import { saveFile } from "@/lib/storage";
import { sendWhatsAppMessageSafe } from "@/lib/whatsapp/evolution";
import { paymentSuccessMessage } from "@/lib/whatsapp/templates";

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
    include: { user: true, tontineSession: true },
  });
  if (!contribution) {
    return NextResponse.json({ error: "Unknown transaction" }, { status: 404 });
  }

  if (contribution.status === "PAID") {
    return NextResponse.json({ ok: true, alreadyProcessed: true });
  }

  const paidAt = verified.dateConfirmed ? new Date(verified.dateConfirmed) : new Date();

  const receiptBytes = await generateReceiptPdf({
    memberName: contribution.user.name,
    tontineType: contribution.tontineSession.type,
    amount: Number(contribution.amountPaid),
    fee: Number(contribution.feePaid),
    fine: Number(contribution.finePaid),
    total: Number(contribution.amountPaid) + Number(contribution.feePaid) + Number(contribution.finePaid),
    transRef: transId,
    paidAt,
  });
  const receiptKey = `receipts/${contribution.userId}/${contribution.id}.pdf`;
  await saveFile(receiptKey, receiptBytes);

  await prisma.$transaction([
    prisma.contribution.update({
      where: { id: contribution.id },
      data: { status: "PAID", paidAt, receiptPdfUrl: receiptKey },
    }),
    ...(Number(contribution.finePaid) > 0
      ? [
          prisma.fine.updateMany({
            where: {
              userId: contribution.userId,
              tontineSessionId: contribution.tontineSessionId,
              dueDate: contribution.dueDate,
              status: "UNPAID",
            },
            data: { status: "PAID" },
          }),
        ]
      : []),
  ]);

  const baseUrl = process.env.NEXTAUTH_URL ?? new URL(request.url).origin;
  const totalPaid =
    Number(contribution.amountPaid) + Number(contribution.feePaid) + Number(contribution.finePaid);
  await sendWhatsAppMessageSafe(
    contribution.user.phone,
    paymentSuccessMessage(contribution.user.name, totalPaid, `${baseUrl}/api/files/${receiptKey}`),
  );

  return NextResponse.json({ ok: true });
}
