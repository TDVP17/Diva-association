"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getSupabaseAuthClient, getSupabaseAdminClient } from "@/lib/supabase-auth";
import { isAdminRole } from "@/lib/constants";
import { ensureMemberCode } from "@/lib/member-code";
import { createOtpChallenge, verifyOtp, generateOtp } from "@/lib/otp";
import { sendEmailSafe } from "@/lib/email/resend";
import { sendWelcomeAndAdminNotifications, renderBrandedEmailHtml } from "@/lib/email/template";
import { validateEmailAddress } from "@/lib/email-validator";
import { createSignupToken, verifySignupToken } from "@/lib/signup-token";
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

  const subject =
    lang === "fr"
      ? "DIVA Asso — Code de réinitialisation de mot de passe"
      : "DIVA Asso — Password reset verification code";
  const emailHtml = renderBrandedEmailHtml({
    title: subject,
    bodyHtml: `
      <p style="font-size: 15px; line-height: 1.6; color: #334155; margin-top: 0;">
        ${
          lang === "fr"
            ? `Bonjour <strong>${user.name}</strong>, voici votre code de vérification pour réinitialiser votre mot de passe :`
            : `Hello <strong>${user.name}</strong>, here is your verification code to reset your password:`
        }
      </p>
      <div style="text-align: center; margin: 26px 0;">
        <span style="display: inline-block; font-size: 32px; font-weight: bold; letter-spacing: 8px; padding: 14px 28px; background: #f0fdf4; color: #003528; border-radius: 10px; border: 1px solid #bbf7d0;">
          ${challenge.code}
        </span>
      </div>
      <p style="font-size: 13px; color: #64748b; margin-bottom: 0;">
        ${
          lang === "fr"
            ? "Ce code expire dans 10 minutes. Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet email en toute sécurité."
            : "This code expires in 10 minutes. If you did not request this, you can safely ignore this email."
        }
      </p>
    `,
    lang,
  });
  await sendEmailSafe(user.email, subject, emailHtml);
  const atIdx = user.email.indexOf("@");
  const masked =
    atIdx > 2
      ? user.email.slice(0, 2) + "***" + user.email.slice(atIdx - 1)
      : user.email;
  return { success: true, channel: "EMAIL", destination: masked };
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

export async function requestSignUpCodeAction(
  data: { fullName: string; email: string; password: string },
  lang: Lang = "fr",
): Promise<{ error?: string; success?: boolean; signupToken?: string; maskedEmail?: string }> {
  const fullName = (data.fullName ?? "").trim();
  const rawEmail = (data.email ?? "").trim();
  const password = String(data.password ?? "");

  if (!fullName || !rawEmail || !password) {
    return {
      error: lang === "fr" ? "Tous les champs sont obligatoires." : "All fields are required.",
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

  const emailCheck = await validateEmailAddress(rawEmail, lang);
  if (!emailCheck.valid) {
    return { error: emailCheck.error };
  }
  const email = emailCheck.normalizedEmail || rawEmail.toLowerCase();

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

  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existingUser) {
    return {
      error:
        lang === "fr"
          ? "Un compte existe déjà avec cette adresse email. Veuillez vous connecter ou réinitialiser votre mot de passe."
          : "An account already exists with this email address. Please sign in or reset your password.",
    };
  }

  const code = generateOtp();
  const expiresAt = Date.now() + 15 * 60 * 1000;

  const signupToken = createSignupToken({
    fullName,
    email,
    password,
    code,
    expiresAt,
  });

  const subject =
    lang === "fr"
      ? "DIVA Asso — Code de validation de votre adresse e-mail"
      : "DIVA Asso — Email verification code";

  const emailHtml = renderBrandedEmailHtml({
    title: subject,
    bodyHtml: `
      <p style="margin-top: 0;">${lang === "fr" ? `Bonjour <strong>${fullName}</strong>,` : `Hello <strong>${fullName}</strong>,`}</p>
      <p>
        ${
          lang === "fr"
            ? "Merci de rejoindre la communauté <strong>DIVA Asso</strong> ! Pour vérifier que cette adresse e-mail vous appartient vraiment et activer votre compte, voici votre code de validation personnel :"
            : "Thank you for joining <strong>DIVA Asso</strong>! To verify that this email address belongs to you and activate your account, here is your personal verification code:"
        }
      </p>
      <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 22px; margin: 26px 0; text-align: center;">
        <p style="margin: 0 0 8px 0; font-size: 13px; color: #166534; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
          ${lang === "fr" ? "Code de Confirmation Unique" : "Unique Confirmation Code"}
        </p>
        <div style="font-size: 36px; font-weight: 800; color: #003528; letter-spacing: 8px;">
          ${code}
        </div>
        <p style="margin: 10px 0 0 0; font-size: 12px; color: #15803d;">
          ${lang === "fr" ? "Ce code expire dans 15 minutes." : "This code expires in 15 minutes."}
        </p>
      </div>
      <p style="font-size: 13px; color: #64748b; line-height: 1.6;">
        ${
          lang === "fr"
            ? "Saisissez ce code dans l'application pour finaliser votre inscription en toute sécurité."
            : "Enter this code in the app to securely complete your registration."
        }
      </p>
    `,
    lang,
  });

  try {
    await sendEmailSafe(email, subject, emailHtml);
  } catch (err) {
    console.error("[requestSignUpCodeAction] sendEmail failed:", err);
    return {
      error:
        lang === "fr"
          ? "Impossible d'envoyer l'e-mail de validation. Veuillez vérifier votre adresse e-mail."
          : "Could not send verification email. Please check your email address.",
    };
  }

  const atIdx = email.indexOf("@");
  const maskedEmail =
    atIdx > 2 ? email.slice(0, 2) + "***" + email.slice(atIdx - 1) : email;

  return { success: true, signupToken, maskedEmail };
}

export async function resendSignUpCodeAction(
  signupToken: string,
  lang: Lang = "fr",
): Promise<{ error?: string; success?: boolean; signupToken?: string; maskedEmail?: string }> {
  const data = verifySignupToken(signupToken);
  if (!data) {
    return {
      error:
        lang === "fr"
          ? "Session d'inscription expirée. Veuillez recommencer."
          : "Registration session expired. Please start over.",
    };
  }
  return requestSignUpCodeAction(
    { fullName: data.fullName, email: data.email, password: data.password },
    lang,
  );
}

export async function confirmSignUpAction(
  signupToken: string,
  enteredCode: string,
  callbackUrl: string = "/dashboard",
  lang: Lang = "fr",
): Promise<{ error?: string; success?: boolean }> {
  const data = verifySignupToken(signupToken);
  if (!data) {
    return {
      error:
        lang === "fr"
          ? "Session d'inscription invalide ou expirée. Veuillez recommencer."
          : "Invalid or expired registration session. Please start over.",
    };
  }

  if (Date.now() > data.expiresAt) {
    return {
      error:
        lang === "fr"
          ? "Le code de confirmation a expiré. Veuillez demander un nouveau code."
          : "Verification code expired. Please request a new code.",
    };
  }

  if (enteredCode.trim() !== data.code) {
    return {
      error:
        lang === "fr"
          ? "Code de confirmation incorrect. Veuillez vérifier vos e-mails."
          : "Incorrect verification code. Please check your email.",
    };
  }

  const { email, password, fullName } = data;

  try {
    const { data: supaData, error: supaError } = await getSupabaseAuthClient().auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });

    const isAlreadyRegistered =
      Boolean(
        supaError &&
          (supaError.message?.toLowerCase().includes("already registered") ||
            supaError.message?.toLowerCase().includes("already exists") ||
            supaError.message?.toLowerCase().includes("user already") ||
            (supaError as { code?: string })?.code === "user_already_exists" ||
            supaError.message?.toLowerCase().includes("already been registered")),
      ) ||
      Boolean(supaData?.user?.identities && supaData.user.identities.length === 0);

    if (isAlreadyRegistered) {
      return {
        error:
          lang === "fr"
            ? "Un compte existe déjà avec cette adresse email. Veuillez vous connecter."
            : "An account with this email address already exists. Please sign in.",
      };
    }

    if (supaError && !supaData?.user) {
      console.error("[confirmSignUpAction] supabase error:", supaError);
      return {
        error:
          lang === "fr"
            ? `Erreur lors de la création du compte : ${supaError.message}`
            : supaError.message,
      };
    }

    // Auto-confirm in Supabase Admin because we proved email ownership
    try {
      const supabaseAdmin = getSupabaseAdminClient();
      const { data: list } = await supabaseAdmin.auth.admin.listUsers();
      const authUser = list?.users?.find((u) => u.email === email);
      if (authUser) {
        await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
          email_confirm: true,
        });
      }
    } catch (err) {
      console.error("[confirmSignUpAction] email_confirm update error:", err);
    }

    const user = await prisma.user.upsert({
      where: { email },
      update: { name: fullName, emailVerified: new Date() },
      create: { email, name: fullName, emailVerified: new Date() },
    });
    const memberCode = await ensureMemberCode(user.id);

    // Welcome email & admin alert
    void sendWelcomeAndAdminNotifications({
      userId: user.id,
      name: user.name,
      email: user.email,
      memberCode,
      lang,
    });

    let redirectTo = callbackUrl;
    if (callbackUrl === "/dashboard" && isAdminRole(user.role)) {
      redirectTo = "/admin";
    }

    await signIn("email-password", { email, password, redirectTo });
    return { success: true };
  } catch (err) {
    if (isRedirectSignal(err)) throw err;
    if (err instanceof AuthError) {
      return { success: true };
    }
    console.error("[confirmSignUpAction] unexpected error:", err);
    return {
      error:
        lang === "fr"
          ? "Une erreur est survenue lors de l'activation de votre compte. Veuillez vous connecter."
          : "Something went wrong. Please try signing in.",
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
  const password = String(formData.get("password") ?? "");

  const res = await requestSignUpCodeAction({ fullName, email: rawEmail, password }, lang);
  if (res.error) {
    return { error: res.error };
  }
  return {
    success:
      lang === "fr"
        ? "Un code de validation a été envoyé à votre adresse e-mail."
        : "A verification code has been sent to your email address.",
  };
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

