import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const users = await prisma.user.findMany({
      where: { accountStatus: "PENDING" },
      select: {
        id: true,
        name: true,
        avatar: true,
        image: true,
        city: true,
        neighborhood: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ users });
  } catch (err) {
    console.error("[account-queue] unexpected error:", err);
    return NextResponse.json({ error: "Could not load pending accounts" }, { status: 500 });
  }
}
