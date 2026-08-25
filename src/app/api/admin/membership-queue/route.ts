import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const memberships = await prisma.membership.findMany({
      where: { status: "PENDING" },
      select: {
        id: true,
        joinedAt: true,
        user: { select: { id: true, name: true, avatar: true, image: true } },
        tontineSession: { select: { id: true, type: true, status: true } },
      },
      orderBy: { joinedAt: "asc" },
    });

    return NextResponse.json({ memberships });
  } catch (err) {
    console.error("[membership-queue] unexpected error:", err);
    return NextResponse.json({ error: "Could not load pending membership requests" }, { status: 500 });
  }
}
