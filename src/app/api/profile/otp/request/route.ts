import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createOtpChallenge } from "@/lib/otp";
import { sendWhatsAppMessage } from "@/lib/whatsapp/evolution";
import { getTranslator } from "@/lib/i18n/get-lang";

const bodySchema = z.object({
  purpose: z.enum(["EMAIL_CHANGE", "PHONE_CHANGE", "PASSWORD_CHANGE"]),
  pendingValue: z.string().trim().min(1).max(200).optional(),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { purpose, pendingValue } = parsed.data;

  if (purpose === "PHONE_CHANGE" && !pendingValue) {
    return NextResponse.json({ error: "A new phone number is required" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, phone: true, preferredLang: true },
  });
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Proving ownership of a NEW phone number means sending the code to that
  // new number; every other purpose proves identity against the existing
  // on-file WhatsApp number.
  const destinationPhone = purpose === "PHONE_CHANGE" ? pendingValue! : user.phone;
  if (!destinationPhone) {
    return NextResponse.json(
      { error: "No WhatsApp number on file to send a verification code to" },
      { status: 400 },
    );
  }

  const challenge = await createOtpChallenge(session.user.id, purpose, pendingValue ?? null);
  if (!challenge) {
    return NextResponse.json({ error: "Please wait a moment before requesting another code" }, { status: 429 });
  }

  const t = getTranslator(user.preferredLang === "fr" ? "fr" : "en");
  try {
    await sendWhatsAppMessage(destinationPhone, t("otpMessage", { code: challenge.code }));
  } catch (err) {
    console.error("[otp/request] failed to send WhatsApp OTP:", err);
    return NextResponse.json({ error: "Could not send the verification code. Please try again." }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
