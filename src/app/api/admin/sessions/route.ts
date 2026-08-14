import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sessions = await prisma.tontineSession.findMany({
    include: {
      memberships: {
        include: { user: { select: { id: true, name: true, avatar: true, image: true, phone: true } } },
        orderBy: [{ officialPosition: "asc" }, { ballDrawn: "asc" }, { joinedAt: "asc" }],
      },
    },
    orderBy: { startDate: "desc" },
  });

  return NextResponse.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      type: s.type,
      status: s.status,
      startDate: s.startDate.toISOString(),
      memberships: s.memberships.map((m) => ({
        id: m.id,
        userId: m.userId,
        name: m.user.name,
        avatar: m.user.avatar ?? m.user.image,
        hasPhone: !!m.user.phone,
        officialPosition: m.officialPosition,
        ballDrawn: m.ballDrawn,
      })),
    })),
  });
}
