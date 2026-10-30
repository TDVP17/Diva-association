import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasVerifiedOtp } from "@/lib/otp";
import { normalizeCameroonPhone } from "@/lib/fapshi";
import { logAudit } from "@/lib/audit";

const bodySchema = z.object({
  phone: z.string().trim().min(1, "Phone number is required"),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const rawPhone = parsed.data.phone;
  const normalized = normalizeCameroonPhone(rawPhone) || rawPhone.replace(/\D/g, "");
  if (!normalized || normalized.length < 9) {
    return NextResponse.json(
      { error: "Veuillez entrer un numéro de téléphone valide à 9 chiffres." },
      { status: 400 },
    );
  }

  // Confirm that a fresh PHONE_CHANGE OTP was verified for this user and number
  const verified =
    (await hasVerifiedOtp(session.user.id, "PHONE_CHANGE", normalized)) ||
    (await hasVerifiedOtp(session.user.id, "PHONE_CHANGE", rawPhone));

  if (!verified) {
    return NextResponse.json(
      {
        error:
          "Veuillez d'abord valider ce numéro avec le code de confirmation envoyé à votre adresse e-mail.",
      },
      { status: 403 },
    );
  }

  try {
    const updatedUser = await prisma.user.update({
      where: { id: session.user.id },
      data: { phone: normalized },
      select: { id: true, name: true, phone: true },
    });

    await logAudit({
      actorId: session.user.id,
      actorRole: session.user.role,
      action: "user_phone_updated",
      targetType: "User",
      targetId: session.user.id,
      metadata: { phone: normalized },
      request,
    });

    return NextResponse.json({ ok: true, phone: updatedUser.phone });
  } catch (err) {
    console.error("[api/profile/phone] failed to update phone:", err);
    return NextResponse.json(
      { error: "Impossible d'enregistrer le numéro de téléphone pour le moment." },
      { status: 500 },
    );
  }
}
