import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { saveFile } from "@/lib/storage";
import { getContributionTotal, getNextDueDate } from "@/lib/tontine-engine";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const membershipSlotId = formData.get("membershipSlotId") as string | null;
    const dueDateStr = formData.get("dueDate") as string | null;
    const phone = formData.get("phone") as string | null;
    const file = formData.get("file") as File | null;

    if (!membershipSlotId || !file) {
      return NextResponse.json(
        { error: "membershipSlotId and file are required" },
        { status: 400 },
      );
    }

    // Guard file type & size (max 8MB)
    const mime = file.type;
    if (!mime.startsWith("image/")) {
      return NextResponse.json(
        { error: "Please upload an image file (PNG, JPEG, WebP)" },
        { status: 400 },
      );
    }
    if (file.size > 8 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Image size must not exceed 8MB" },
        { status: 400 },
      );
    }

    const slot = await prisma.membershipSlot.findUnique({
      where: { id: membershipSlotId },
      include: {
        membership: {
          include: {
            tontineSession: true,
            user: true,
          },
        },
      },
    });

    if (!slot) {
      return NextResponse.json({ error: "Slot not found" }, { status: 404 });
    }

    const tontineSession = slot.membership.tontineSession;
    const dueDate = dueDateStr
      ? new Date(dueDateStr)
      : getNextDueDate(tontineSession.type, new Date());

    // Save image to Supabase storage
    const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
    const key = `payment-proofs/${session.user.id}/${slot.id}_${Date.now()}.${ext}`;
    const arrayBuffer = await file.arrayBuffer();
    await saveFile(key, Buffer.from(arrayBuffer));
    const proofImageUrl = `/api/files/${key}`;

    const { amount, fee } = getContributionTotal({
      amount: Number(tontineSession.amount),
      fee: Number(tontineSession.fee),
    });

    const outstandingFine = await prisma.fine.findUnique({
      where: { membershipSlotId_dueDate: { membershipSlotId, dueDate } },
    });
    const fineAmount =
      outstandingFine && outstandingFine.status === "UNPAID"
        ? Number(outstandingFine.amount)
        : 0;

    const contribution = await prisma.contribution.upsert({
      where: { membershipSlotId_dueDate: { membershipSlotId, dueDate } },
      create: {
        membershipSlotId,
        dueDate,
        amountPaid: amount,
        feePaid: fee,
        finePaid: fineAmount,
        status: "PENDING",
        proofImageUrl,
        proofUploadedAt: new Date(),
        payerPhone: phone || null,
        paidByUserId: session.user.id,
        failureReason: null,
      },
      update: {
        proofImageUrl,
        proofUploadedAt: new Date(),
        payerPhone: phone || undefined,
        paidByUserId: session.user.id,
        failureReason: null,
      },
    });

    // Notify admins & president about the submitted proof
    const admins = await prisma.user.findMany({
      where: { role: { in: ["ADMIN", "PRESIDENT"] } },
      select: { id: true },
    });

    if (admins.length > 0) {
      await prisma.notification.createMany({
        data: admins.map((admin) => ({
          userId: admin.id,
          tontineSessionId: tontineSession.id,
          channel: "IN_APP",
          type: "ADMIN_BROADCAST",
          message: `Nouvelle capture de paiement reçue pour ${slot.beneficiaryName} (${slot.membership.user.name}) — ${tontineSession.title || tontineSession.type}. À valider.`,
          actionUrl: `/admin/contributions/${tontineSession.id}`,
          status: "SENT",
        })),
      });
    }

    return NextResponse.json({
      ok: true,
      contributionId: contribution.id,
      proofImageUrl,
    });
  } catch (err) {
    console.error("[payments/proof] error uploading proof:", err);
    return NextResponse.json(
      { error: "Could not save payment proof. Please try again." },
      { status: 500 },
    );
  }
}
