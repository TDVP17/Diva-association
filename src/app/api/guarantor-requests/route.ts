import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const requests = await prisma.kycVerification.findMany({
    where: { referrerUserId: session.user.id },
    include: {
      user: { select: { id: true, name: true, avatar: true, image: true, city: true, neighborhood: true } },
      tontineSession: { select: { id: true, title: true, type: true, amount: true, fee: true } },
      membership: { select: { id: true, status: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({
    pendingCount: requests.filter((r) => r.guarantorStatus === "PENDING").length,
    requests: requests.map((r) => ({
      id: r.id,
      guarantorStatus: r.guarantorStatus,
      guarantorAcceptedAt: r.guarantorAcceptedAt?.toISOString() ?? null,
      guarantorDeclinedAt: r.guarantorDeclinedAt?.toISOString() ?? null,
      guarantorDeclineReason: r.guarantorDeclineReason,
      createdAt: r.createdAt.toISOString(),
      applicant: {
        id: r.user.id,
        name: r.user.name,
        avatar: r.user.avatar || r.user.image || null,
        city: r.user.city,
        neighborhood: r.user.neighborhood,
      },
      tontineSession: {
        id: r.tontineSession.id,
        title: r.tontineSession.title || r.tontineSession.type,
        amount: Number(r.tontineSession.amount),
        fee: Number(r.tontineSession.fee),
      },
      membershipStatus: r.membership?.status ?? "PENDING",
    })),
  });
}
