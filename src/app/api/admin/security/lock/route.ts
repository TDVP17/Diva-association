import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/require-admin";
import { setAppLocked } from "@/lib/security";

const lockSchema = z.object({
  isLocked: z.boolean(),
  reason: z.string().trim().max(500).optional(),
});

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = lockSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const result = await setAppLocked({
    isLocked: parsed.data.isLocked,
    adminEmail: admin.user.email || "administrateur@divaasso.com",
    reason: parsed.data.reason,
  });

  return NextResponse.json(result);
}
