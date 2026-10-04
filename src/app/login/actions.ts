"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getSupabaseAuthClient, getSupabaseAdminClient } from "@/lib/supabase-auth";
import { isAdminRole } from "@/lib/constants";
import { ensureMemberCode } from "@/lib/member-code";
import { createOtpChallenge, verifyOtp } from "@/lib/otp";
import { sendEmailSafe } from "@/lib/email/resend";
import { sendWhatsAppMessageSafe } from "@/lib/whatsapp/evolution";
import { translate, type Lang } from "@/lib/i18n/translations";
import { getLang } from "@/lib/i18n/get-lang";

export interface AuthFormState {
  error?: string;
  success?: string;
}

/** Next.js's redirect control-flow signal — must always propagate, never be swallowed as an error. */
function isRedirectSignal(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof (err as { digest?: unknown }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}

export async function findUserByContact(identifier: string) {
  const clean = identifier.trim();
  if (!clean) return null;
  if (clean.includes("@")) {
    return prisma.user.findUnique({
      where: { email: clean.toLowerCase() },
      select: { id: true, name: true, email: true, phone: true, role: true, preferredLang: true, isBanned: true },
    });
  }
  const digits = clean.replace(/\D/g, "");
  return prisma.user.findFirst({
    where: {
      OR: [
        { phone: clean },
        ...(digits ? [{ phone: digits }] : []),
        ...(digits.startsWith("237") ? [{ phone: digits.slice(3) }] : []),
        ...(!digits.startsWith("237") && digits.length === 9 ? [{ phone: `237${digits}` }] : []),
      ],
    },
    select: { id: true, name: true, email: true, phone: true, role: true, preferredLang: true, isBanned: true },
  });
}

export async function signInAction(
  callbackUrl: string,
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const lang = await getLang();
  const rawIdentifier = String(formData.get("email") ?? formData.get("identifier") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!rawIdentifier || !password) {
    return {
      error:
        lang === "fr"
          ? "L'e-mail ou le numéro de téléphone et le mot de passe sont requis."
          : "Email or phone number and password are required.",
    };
  }

  try {
    let emailToUse = rawIdentifier;
    let userRole = null;

    const user = await findUserByContact(rawIdentifier);
    if (user?.isBanned) {
      return {
        error:
          lang === "fr"
            ? "Ce compte a été banni. Vous ne pouvez plus vous connecter à l'application avec cet email ou ce numéro de téléphone."
            : "This account has been banned. You can no longer log in with this email or phone number.",
      };
    }

    if (!rawIdentifier.includes("@")) {
      if (!user) {
        return {
          error:
            lang === "fr"
              ? "Email, numéro de téléphone ou mot de passe incorrect."
              : "Incorrect email, phone number, or password.",
        };
      }
      emailToUse = user.email;
      userRole = user.role;
    } else {
      userRole = user?.role ?? null;
      emailToUse = rawIdentifier.toLowerCase();
    }

    let redirectTo = callbackUrl;
    if (callbackUrl === "/dashboard") {
      if (isAdminRole(userRole)) redirectTo = "/admin";
    }
    await signIn("email-password", { email: emailToUse, password, redirectTo });
    return {};
  } catch (err) {
    if (isRedirectSignal(err)) throw err; // successful sign-in — let the redirect happen
    if (err instanceof AuthError) {
      return {
        error:
          lang === "fr"
            ? "Email, numéro de téléphone ou mot de passe incorrect."
            : "Incorrect email, phone number, or password.",
      };
    }
    console.error("[signInAction] unexpected error:", err);
    return {
      error:
        lang === "fr"
          ? "Une erreur est survenue lors de la connexion. Veuillez réessayer."
          : "Something went wrong while signing you in. Please try again.",
    };
  }
}

export async function requestPasswordResetAction(
  identifier: string,
  lang: Lang,
): Promise<{ error?: string; success?: boolean; channel?: "EMAIL" | "WHATSAPP"; destination?: string }> {
  const trimmed = identifier.trim();
  if (!trimmed) {
    return { error: translate(lang, "userNotFoundByContact") };
  }

  const user = await findUserByContact(trimmed);
  if (!user) {
    return { error: translate(lang, "userNotFoundByContact") };
  }
  if (user.isBanned) {
    return {
      error:
        lang === "fr"
          ? "Ce compte a été banni. Vous ne pouvez plus réinitialiser le mot de passe."
          : "This account has been banned. Password reset is not permitted.",
    };
  }

  const isEmail = trimmed.includes("@");
  if (!isEmail && !user.phone) {
    return { error: translate(lang, "userNotFoundByContact") };
  }

  const challenge = await createOtpChallenge(user.id, "PASSWORD_CHANGE", null);
  if (!challenge) {
    return {
      error:
        lang === "fr"
          ? "Veuillez patienter un instant avant de demander un nouveau code."
          : "Please wait a moment before requesting another code.",
    };
  }

  if (isEmail) {
    const subject =
      lang === "fr"
        ? "DIVA Asso — Code de réinitialisation de mot de passe"
        : "DIVA Asso — Password reset verification code";
    const emailHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #1e293b; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h2 style="color: #003528; margin: 0;">DIVA Asso</h2>
        </div>
        <h3 style="color: #0f172a; margin-top: 0;">${subject}</h3>
        <p style="font-size: 15px; line-height: 1.6; color: #334155;">
          ${lang === "fr"
            ? `Bonjour <strong>${user.name}</strong>, voici votre code de vérification pour réinitialiser votre mot de passe :`
            : `Hello <strong>${user.name}</strong>, here is your verification code to reset your password:`}
        </p>
        <div style="text-align: center; margin: 28px 0;">
          <span style="display: inline-block; font-size: 32px; font-weight: bold; letter-spacing: 8px; padding: 14px 28px; background: #f0fdf4; color: #003528; border-radius: 10px; border: 1px solid #bbf7d0;">
            ${challenge.code}
          </span>
        </div>
        <p style="font-size: 13px; color: #64748b;">
          ${lang === "fr"
            ? "Ce code expire dans 10 minutes. Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet email en toute sécurité."
            : "This code expires in 10 minutes. If you did not request this, you can safely ignore this email."}
        </p>
      </div>
    `;
    await sendEmailSafe(user.email, subject, emailHtml);
    const atIdx = user.email.indexOf("@");
    const masked =
      atIdx > 2
        ? user.email.slice(0, 2) + "***" + user.email.slice(atIdx - 1)
        : user.email;
    return { success: true, channel: "EMAIL", destination: masked };
  } else {
    const waText =
      lang === "fr"
        ? `*DIVA Asso — Réinitialisation du mot de passe*\n\nBonjour *${user.name}*,\nVotre code de vérification est : *${challenge.code}*\n\nCe code expire dans 10 minutes. Pour votre sécurité, ne le transmettez à personne.`
        : `*DIVA Asso — Password reset*\n\nHello *${user.name}*,\nYour verification code is: *${challenge.code}*\n\nThis code expires in 10 minutes. Do not share it with anyone.`;
    await sendWhatsAppMessageSafe(user.phone, waText);
    const maskedPhone = user.phone && user.phone.length > 4 ? `+***${user.phone.slice(-4)}` : "WhatsApp";
    return { success: true, channel: "WHATSAPP", destination: maskedPhone };
  }
}

export async function confirmPasswordResetAction(
  identifier: string,
  code: string,
  newPassword: string,
  confirmPassword: string,
  lang: Lang,
): Promise<{ error?: string; success?: boolean }> {
  if (!code.trim() || !newPassword || !confirmPassword) {
    return { error: lang === "fr" ? "Tous les champs sont obligatoires." : "All fields are required." };
  }
  if (newPassword.length < 6) {
    return {
      error:
        lang === "fr"
          ? "Le mot de passe doit comporter au moins 6 caractères."
          : "Password must be at least 6 characters.",
    };
  }
  if (newPassword !== confirmPassword) {
    return {
      error:
        lang === "fr"
          ? "Les mots de passe ne correspondent pas."
          : "Passwords do not match.",
    };
  }

  const user = await findUserByContact(identifier);
  if (!user) {
    return { error: translate(lang, "userNotFoundByContact") };
  }

  const verification = await verifyOtp(user.id, "PASSWORD_CHANGE", code.trim());
  if (!verification.ok) {
    return { error: translate(lang, "codeExpiredOrInvalid") };
  }

  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const { data: list, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    if (listError) {
      console.error("[confirmPasswordResetAction] listUsers failed:", listError.message);
      return {
        error:
          lang === "fr"
            ? "Impossible de réinitialiser le mot de passe actuellement."
            : "Could not reset password. Please try again.",
      };
    }

    const authUser = list.users.find((u) => u.email === user.email);
    if (authUser) {
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
        password: newPassword,
      });
      if (updateError) {
        console.error("[confirmPasswordResetAction] updateUserById failed:", updateError.message);
        return { error: updateError.message };
      }
    } else {
      const { error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: user.email,
        password: newPassword,
        email_confirm: true,
        user_metadata: { full_name: user.name },
      });
      if (createError) {
        console.error("[confirmPasswordResetAction] createUser failed:", createError.message);
        return { error: createError.message };
      }
    }

    return { success: true };
  } catch (err) {
    console.error("[confirmPasswordResetAction] unexpected error:", err);
    return {
      error:
        lang === "fr"
          ? "Une erreur inattendue est survenue."
          : "Something went wrong. Please try again.",
    };
  }
}

export async function signUpAction(
  callbackUrl: string,
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const lang = await getLang();
  const fullName = String(formData.get("fullName") ?? "").trim();
  const rawEmail = String(formData.get("email") ?? "").trim();
  const email = rawEmail.toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!fullName || !email || !password) {
    return {
      error:
        lang === "fr"
          ? "Tous les champs sont obligatoires."
          : "All fields are required.",
    };
  }
  if (password.length < 6) {
    return {
      error:
        lang === "fr"
          ? "Le mot de passe doit comporter au moins 6 caractères."
          : "Password must be at least 6 characters.",
    };
  }

  const existingBanned = await prisma.user.findUnique({
    where: { email },
    select: { isBanned: true },
  });
  if (existingBanned?.isBanned) {
    return {
      error:
        lang === "fr"
          ? "Cet email est banni. Vous ne pouvez plus créer de compte avec cette adresse."
          : "This email has been banned. You cannot create an account with this address.",
    };
  }

  try {
    const { data, error } = await getSupabaseAuthClient().auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });

    const isAlreadyRegistered =
      Boolean(
        error &&
          (error.message?.toLowerCase().includes("already registered") ||
            error.message?.toLowerCase().includes("already exists") ||
            error.message?.toLowerCase().includes("user already") ||
            (error as { code?: string })?.code === "user_already_exists" ||
            error.message?.toLowerCase().includes("already been registered"))
      ) ||
      Boolean(data?.user?.identities && data.user.identities.length === 0);

    if (isAlreadyRegistered) {
      return {
        error:
          lang === "fr"
            ? "Un compte existe déjà avec cette adresse email. Veuillez vous connecter ou utiliser une autre adresse email."
            : "An account with this email address already exists. Please sign in or use another email address.",
      };
    }

    if (error) {
      if (error.message?.toLowerCase().includes("rate limit")) {
        return {
          error:
            lang === "fr"
              ? "Trop de tentatives. Veuillez patienter un instant avant de réessayer."
              : "Too many attempts. Please wait a moment before trying again.",
        };
      }
      return {
        error:
          lang === "fr"
            ? `Erreur lors de la création du compte : ${error.message}`
            : error.message,
      };
    }

    if (!data.user) {
      return {
        error:
          lang === "fr"
            ? "Impossible de créer votre compte. Veuillez réessayer."
            : "Could not create your account. Please try again.",
      };
    }

    // Supabase Auth now owns the credential; mirror the account into our own
    // users table so the rest of the app (role, memberships, etc.) has
    // something to attach to. Note that Prisma schema allows duplicate names,
    // only email is unique across accounts.
    const user = await prisma.user.upsert({
      where: { email },
      update: { name: fullName },
      create: { email, name: fullName },
    });
    // Every member gets their unique code right away, not just once their
    // first membership is approved — ensureMemberCode() is idempotent, so
    // this is a no-op for an existing user who already has one.
    await ensureMemberCode(user.id);

    if (!data.session) {
      // Email confirmation is required before the account can sign in.
      return {
        success:
          lang === "fr"
            ? "Compte créé avec succès ! Vérifiez vos e-mails pour le confirmer, puis connectez-vous."
            : "Account created! Check your email to confirm it, then sign in.",
      };
    }

    await signIn("email-password", { email, password, redirectTo: callbackUrl });
    return {};
  } catch (err) {
    if (isRedirectSignal(err)) throw err; // successful sign-in — let the redirect happen
    if (err instanceof AuthError) {
      return {
        success:
          lang === "fr"
            ? "Compte créé — veuillez vous connecter."
            : "Account created — please sign in.",
      };
    }
    console.error("[signUpAction] unexpected error:", err);
    return {
      error:
        lang === "fr"
          ? "Une erreur est survenue lors de la création de votre compte. Veuillez réessayer."
          : "Something went wrong while creating your account. Please try again.",
    };
  }
}

export async function getGoogleSignInUrl(
  callbackUrl: string = "/dashboard",
): Promise<{ url?: string; error?: string }> {
  try {
    await signIn("google", { redirectTo: callbackUrl });
    return { error: "No redirect occurred" };
  } catch (err) {
    if (isRedirectSignal(err)) {
      const digest = (err as { digest?: string }).digest ?? "";
      const parts = digest.split(";");
      if (parts.length >= 3 && parts[2]?.startsWith("http")) {
        return { url: parts[2] };
      }
    }
    console.error("[getGoogleSignInUrl] unexpected error:", err);
    return { error: "Failed to generate Google sign-in URL" };
  }
}

