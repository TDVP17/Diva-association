import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { verifyOtp } from "@/lib/otp";

const bodySchema = z.object({
  purpose: z.enum(["EMAIL_CHANGE", "PHONE_CHANGE", "PASSWORD_CHANGE"]),
  code: z.string().trim().length(6),
});

const ERROR_MESSAGES: Record<string, string> = {
  not_found: "No verification code was requested. Please request a new code.",
  expired: "This code has expired. Please request a new one.",
  too_many_attempts: "Too many incorrect attempts. Please request a new code.",
  invalid_code: "Incorrect code. Please try again.",
};

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const result = await verifyOtp(session.user.id, parsed.data.purpose, parsed.data.code);
  if (!result.ok) {
    return NextResponse.json({ error: ERROR_MESSAGES[result.error] }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
