import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { sendEmailSafe } from "@/lib/email/resend";

const bodySchema = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { id: tontineSessionId } = await params;

  const memberships = await prisma.membership.findMany({
    where: { tontineSessionId, status: "APPROVED" },
    select: { user: { select: { email: true } } },
  });

  const html = parsed.data.body
    .split("\n")
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");

  let sent = 0;
  for (const m of memberships) {
    await sendEmailSafe(m.user.email, parsed.data.subject, html);
    sent += 1;
  }

  return NextResponse.json({ sent, skipped: 0 });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
