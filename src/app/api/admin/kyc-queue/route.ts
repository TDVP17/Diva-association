import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const users = await prisma.user.findMany({
    where: {
      kycStatus: "PENDING",
      cniFrontUrl: { not: null },
      cniBackUrl: { not: null },
      selfieUrl: { not: null },
    },
    select: {
      id: true,
      name: true,
      avatar: true,
      image: true,
      city: true,
      neighborhood: true,
      cniFrontUrl: true,
      cniBackUrl: true,
      selfieUrl: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ users });
}
