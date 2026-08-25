import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";

const bodySchema = z.object({ action: z.enum(["approve", "reject"]) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ membershipId: string }> },
) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { membershipId } = await params;

  try {
    const existing = await prisma.membership.findUnique({ where: { id: membershipId } });
    if (!existing) {
      return NextResponse.json({ error: "Membership request not found" }, { status: 404 });
    }

    const membership = await prisma.membership.update({
      where: { id: membershipId },
      data: { status: parsed.data.action === "approve" ? "APPROVED" : "REJECTED" },
    });

    return NextResponse.json({ id: membership.id, status: membership.status });
  } catch (err) {
    console.error("[membership/decide] unexpected error:", err);
    return NextResponse.json({ error: "Could not update this membership request" }, { status: 500 });
  }
}
