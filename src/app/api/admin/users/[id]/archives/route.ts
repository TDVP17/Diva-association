import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const archives = await prisma.transactionArchive.findMany({
    where: { userId: id },
    orderBy: { periodStart: "desc" },
  });

  return NextResponse.json({
    archives: archives.map((a) => ({
      id: a.id,
      year: a.periodStart.getUTCFullYear(),
      pdfUrl: a.pdfUrl,
    })),
  });
}
