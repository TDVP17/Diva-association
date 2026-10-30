import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createOtpChallenge } from "@/lib/otp";
import { sendEmailSafe } from "@/lib/email/resend";
import { renderBrandedEmailHtml } from "@/lib/email/template";
import { validateEmailAddress } from "@/lib/email-validator";

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

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, phone: true, email: true, preferredLang: true },
  });
  if (!user || !user.email) {
    return NextResponse.json({ error: "User email not found" }, { status: 404 });
  }

  const lang = user.preferredLang === "en" ? "en" : "fr";

  if (purpose === "PHONE_CHANGE" && !pendingValue) {
    return NextResponse.json({ error: "A new phone number is required" }, { status: 400 });
  }

  let destinationEmail = user.email;

  if (purpose === "EMAIL_CHANGE") {
    if (!pendingValue) {
      return NextResponse.json(
        { error: lang === "fr" ? "Veuillez entrer une adresse e-mail." : "An email address is required." },
        { status: 400 },
      );
    }
    const check = await validateEmailAddress(pendingValue, lang);
    if (!check.valid) {
      return NextResponse.json({ error: check.error }, { status: 400 });
    }
    const normalizedNewEmail = check.normalizedEmail || pendingValue.toLowerCase();

    // Check if new email already belongs to another user
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedNewEmail },
      select: { id: true },
    });
    if (existingUser && existingUser.id !== session.user.id) {
      return NextResponse.json(
        {
          error:
            lang === "fr"
              ? "Cette adresse e-mail est déjà utilisée par un autre compte."
              : "This email address is already in use by another account.",
        },
        { status: 409 },
      );
    }
    destinationEmail = normalizedNewEmail;
  }

  const challenge = await createOtpChallenge(session.user.id, purpose, pendingValue ?? null);
  if (!challenge) {
    return NextResponse.json({ error: "Please wait a moment before requesting another code" }, { status: 429 });
  }

  let title = "";
  let bodyHtml = "";

  if (purpose === "PHONE_CHANGE") {
    title = lang === "fr" ? "Validation de votre numéro WhatsApp" : "WhatsApp Number Verification";
    bodyHtml = `
      <p style="margin-top: 0;">${lang === "fr" ? `Bonjour <strong>${user.name}</strong>,` : `Hello <strong>${user.name}</strong>,`}</p>
      <p>
        ${
          lang === "fr"
            ? `Vous avez demandé à enregistrer le numéro WhatsApp <strong>${pendingValue}</strong> sur votre compte DIVA Asso.`
            : `You requested to register the WhatsApp number <strong>${pendingValue}</strong> on your DIVA Asso account.`
        }
      </p>
      <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 20px; margin: 24px 0; text-align: center;">
        <p style="margin: 0 0 8px 0; font-size: 13px; color: #166534; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
          ${lang === "fr" ? "Votre Code de Validation WhatsApp" : "Your WhatsApp Verification Code"}
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
            ? "Entrez ce code dans l'application pour confirmer l'enregistrement de votre numéro WhatsApp."
            : "Enter this code in the app to confirm your WhatsApp number."
        }
      </p>
    `;
  } else if (purpose === "EMAIL_CHANGE") {
    title = lang === "fr" ? "Validation de votre nouvelle adresse e-mail" : "New Email Address Verification";
    bodyHtml = `
      <p style="margin-top: 0;">${lang === "fr" ? `Bonjour <strong>${user.name}</strong>,` : `Hello <strong>${user.name}</strong>,`}</p>
      <p>
        ${
          lang === "fr"
            ? `Vous avez demandé à enregistrer cette adresse e-mail (<strong>${destinationEmail}</strong>) sur votre compte DIVA Asso.`
            : `You requested to register this email address (<strong>${destinationEmail}</strong>) on your DIVA Asso account.`
        }
      </p>
      <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 20px; margin: 24px 0; text-align: center;">
        <p style="margin: 0 0 8px 0; font-size: 13px; color: #166534; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
          ${lang === "fr" ? "Votre Code de Confirmation" : "Your Confirmation Code"}
        </p>
        <div style="font-size: 34px; font-weight: 800; color: #003528; letter-spacing: 6px;">
          ${challenge.code}
        </div>
        <p style="margin: 10px 0 0 0; font-size: 12px; color: #15803d;">
          ${lang === "fr" ? "Ce code expire dans 10 minutes." : "This code expires in 10 minutes."}
        </p>
      </div>
      <p style="font-size: 13px; color: #64748b; line-height: 1.6;">
        ${
          lang === "fr"
            ? "Entrez ce code dans l'application pour valider que vous avez bien accès à cette boîte de messagerie."
            : "Enter this code in the app to verify you have access to this inbox."
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
    await sendEmailSafe(destinationEmail, `${title} — Code : ${challenge.code}`, emailHtml);
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

  const atIdx = destinationEmail.indexOf("@");
  const maskedEmail =
    atIdx > 2 ? destinationEmail.slice(0, 2) + "***" + destinationEmail.slice(atIdx - 1) : destinationEmail;

  return NextResponse.json({ ok: true, email: maskedEmail });
}
