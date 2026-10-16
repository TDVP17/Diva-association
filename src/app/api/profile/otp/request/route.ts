import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createOtpChallenge } from "@/lib/otp";
import { sendEmailSafe } from "@/lib/email/resend";
import { renderBrandedEmailHtml } from "@/lib/email/template";

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
    select: { name: true, phone: true, email: true, preferredLang: true },
  });
  if (!user || !user.email) {
    return NextResponse.json({ error: "User email not found" }, { status: 404 });
  }

  const challenge = await createOtpChallenge(session.user.id, purpose, pendingValue ?? null);
  if (!challenge) {
    return NextResponse.json({ error: "Please wait a moment before requesting another code" }, { status: 429 });
  }

  const lang = user.preferredLang === "en" ? "en" : "fr";
  let title = "";
  let bodyHtml = "";

  if (purpose === "PHONE_CHANGE") {
    title = lang === "fr" ? "Validation de votre numéro de téléphone" : "Phone Number Verification";
    bodyHtml = `
      <p style="margin-top: 0;">${lang === "fr" ? `Bonjour <strong>${user.name}</strong>,` : `Hello <strong>${user.name}</strong>,`}</p>
      <p>
        ${
          lang === "fr"
            ? `Vous avez demandé à enregistrer le numéro de téléphone <strong>${pendingValue}</strong> sur votre compte DIVA Asso.`
            : `You requested to register the phone number <strong>${pendingValue}</strong> on your DIVA Asso account.`
        }
      </p>
      <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 20px; margin: 24px 0; text-align: center;">
        <p style="margin: 0 0 8px 0; font-size: 13px; color: #166534; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
          ${lang === "fr" ? "Votre Code de Validation Unique" : "Your Unique Verification Code"}
        </p>
        <div style="font-size: 34px; font-weight: 800; color: #003528; letter-spacing: 6px;">
          ${challenge.code}
        </div>
        <p style="margin: 10px 0 0 0; font-size: 12px; color: #15803d;">
          ${lang === "fr" ? "Ce code expire dans 10 minutes et ne peut être utilisé qu'une seule fois." : "This code expires in 10 minutes and can only be used once."}
        </p>
      </div>
      <p style="font-size: 13px; color: #64748b; line-height: 1.6;">
        ${
          lang === "fr"
            ? "Entrez ce code dans l'application pour confirmer l'enregistrement de votre numéro."
            : "Enter this code in the app to confirm your phone number."
        }
      </p>
    `;
  } else {
    title = lang === "fr" ? "Code de sécurité DIVA Asso" : "DIVA Asso Security Code";
    bodyHtml = `
      <p style="margin-top: 0;">${lang === "fr" ? `Bonjour <strong>${user.name}</strong>,` : `Hello <strong>${user.name}</strong>,`}</p>
      <p>${lang === "fr" ? "Voici votre code de sécurité unique pour confirmer votre modification :" : "Here is your unique security code to confirm your change:"}</p>
      <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 20px; margin: 24px 0; text-align: center;">
        <div style="font-size: 34px; font-weight: 800; color: #003528; letter-spacing: 6px;">
          ${challenge.code}
        </div>
      </div>
    `;
  }

  try {
    const emailHtml = renderBrandedEmailHtml({
      title,
      bodyHtml,
      actionUrl: "/profile",
      actionLabel: lang === "fr" ? "Accéder à mon profil" : "Go to My Profile",
      lang,
    });
    await sendEmailSafe(user.email, `${title} — Code : ${challenge.code}`, emailHtml);
  } catch (err) {
    console.error("[otp/request] failed to send Email OTP:", err);
    return NextResponse.json(
      {
        error:
          lang === "fr"
            ? "Impossible d'envoyer l'e-mail de confirmation. Veuillez réessayer."
            : "Could not send verification email. Please try again.",
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, email: user.email });
}
