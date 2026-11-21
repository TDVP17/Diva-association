import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const currentUserId = session.user.id;

  // Guarantor rule: Must be a member of at least one public cotisation
  const publicMemberships = await prisma.membership.findMany({
    where: {
      userId: { not: currentUserId },
      status: "APPROVED",
      user: { isBanned: false },
      tontineSession: {
        isPrivate: false,
        status: { in: ["ACTIVE", "DRAWING"] },
      },
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          stars: true,
        },
      },
      tontineSession: {
        select: {
          id: true,
          title: true,
          type: true,
        },
      },
    },
    orderBy: { user: { name: "asc" } },
    take: 100,
  });

  // Deduplicate by user
  const map = new Map<string, { id: string; name: string; phone: string | null; publicSessionTitle: string; stars: number }>();
  for (const m of publicMemberships) {
    if (!map.has(m.user.id)) {
      map.set(m.user.id, {
        id: m.user.id,
        name: m.user.name,
        phone: m.user.phone,
        publicSessionTitle: m.tontineSession.title || m.tontineSession.type,
        stars: m.user.stars ?? 0,
      });
    }
  }

  return NextResponse.json({ guarantors: Array.from(map.values()) });
}

