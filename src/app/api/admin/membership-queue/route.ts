import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const tontineSessionId = new URL(request.url).searchParams.get("tontineSessionId") ?? undefined;

  try {
    const memberships = await prisma.membership.findMany({
      where: { status: "PENDING", ...(tontineSessionId ? { tontineSessionId } : {}) },
      select: {
        id: true,
        joinedAt: true,
        user: { select: { id: true, name: true, avatar: true, image: true } },
        tontineSession: { select: { id: true, title: true, type: true, status: true } },
        kycVerification: {
          select: {
            documentType: true,
            matchConfidence: true,
            documentImageUrl: true,
            selfieImageUrl: true,
            verifiedAt: true,
          },
        },
      },
      orderBy: { joinedAt: "asc" },
    });

    return NextResponse.json({
      memberships: memberships.map((m) => ({
        ...m,
        kycVerification: m.kycVerification
          ? {
              ...m.kycVerification,
              matchConfidence:
                m.kycVerification.matchConfidence !== null
                  ? Number(m.kycVerification.matchConfidence)
                  : null,
            }
          : null,
      })),
    });
  } catch (err) {
    console.error("[membership-queue] unexpected error:", err);
    return NextResponse.json({ error: "Could not load pending membership requests" }, { status: 500 });
  }
}
