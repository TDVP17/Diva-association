import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { logAudit } from "@/lib/audit";

const schema = z.object({
  isBanned: z.boolean(),
  reason: z.string().trim().max(500).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Prevent banning another admin/president
  if (user.role === "ADMIN" || user.role === "PRESIDENT") {
    return NextResponse.json({ error: "Cannot ban an administrator" }, { status: 400 });
  }

  const { isBanned, reason } = parsed.data;

  const updated = await prisma.user.update({
    where: { id },
    data: {
      isBanned,
      bannedAt: isBanned ? new Date() : null,
      bannedReason: isBanned ? (reason ?? "Banni par l'administrateur") : null,
    },
  });

  // If banning, also set any active/pending memberships to BANNED
  if (isBanned) {
    await prisma.membership.updateMany({
      where: { userId: id, status: { in: ["PENDING", "REJECTED"] } },
      data: { status: "BANNED" },
    });
  }

  await logAudit({
    actorId: admin.user.id,
    actorRole: admin.user.role,
    action: isBanned ? "user_banned" : "user_unbanned",
    targetType: "User",
    targetId: id,
    request,
    payloadBefore: { isBanned: user.isBanned },
    payloadAfter: { isBanned: updated.isBanned, reason },
  });

  return NextResponse.json({ success: true, user: updated });
}
