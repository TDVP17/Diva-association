import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";

const bodySchema = z.object({ action: z.enum(["approve", "reject"]) });

export async function POST(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { userId } = await params;

  try {
    const existing = await prisma.user.findUnique({ where: { id: userId } });
    if (!existing) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: { accountStatus: parsed.data.action === "approve" ? "APPROVED" : "REJECTED" },
    });

    return NextResponse.json({ id: user.id, accountStatus: user.accountStatus });
  } catch (err) {
    console.error("[account/decide] unexpected error:", err);
    return NextResponse.json({ error: "Could not update this account" }, { status: 500 });
  }
}
