import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const methods = await prisma.savedPaymentMethod.findMany({
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            memberCode: true,
          },
        },
      },
      orderBy: [
        { status: "asc" }, // PENDING first
        { createdAt: "desc" },
      ],
    });

    return NextResponse.json({ methods });
  } catch (err) {
    console.error("[api/admin/disbursement-methods GET] error:", err);
    return NextResponse.json({ error: "Failed to fetch disbursement methods" }, { status: 500 });
  }
}

