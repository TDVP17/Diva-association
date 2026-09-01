import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { generateUniqueMemberCode } from "@/lib/member-code";
import { logAudit } from "@/lib/audit";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const code = await generateUniqueMemberCode();
  await prisma.user.update({ where: { id }, data: { memberCode: code } });

  await logAudit({
    actorId: admin.user.id,
    actorRole: admin.user.role,
    action: "member_code_regenerated",
    targetType: "User",
    targetId: id,
    request,
  });

  return NextResponse.json({ code });
}
