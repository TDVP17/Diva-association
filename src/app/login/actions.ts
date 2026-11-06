"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSupabaseAuthClient, getSupabaseAdminClient } from "@/lib/supabase-auth";
import { clearServerAuthCookies, setServerSupabaseCookies } from "@/lib/supabase/auth-cookies";
import { isAdminRole } from "@/lib/constants";
import { ensureMemberCode } from "@/lib/member-code";
import { createOtpChallenge, verifyOtp, generateOtp } from "@/lib/otp";
import { sendEmailSafe } from "@/lib/email/resend";
import { sendWelcomeAndAdminNotifications, renderBrandedEmailHtml } from "@/lib/email/template";
import { validateEmailAddress } from "@/lib/email-validator";
import { createSignupToken, verifySignupToken } from "@/lib/signup-token";
import { translate, type Lang } from "@/lib/i18n/translations";
import { getLang } from "@/lib/i18n/get-lang";
import {
  detectSqlInjection,
  logSecurityEvent,
  checkIpIsBlocked,
  recordFailedLoginAttempt,
} from "@/lib/security";

export interface AuthFormState {
  error?: string;
  success?: string;
  accessToken?: string;
  refreshToken?: string;
  redirectTo?: string;
}

function sanitizeCallbackUrl(raw: string | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) {
    return "/dashboard";
  }
  return raw;
}

export async function findUserByContact(identifier: string) {
  const clean = identifier.trim();
  if (!clean) return null;
  if (clean.includes("@")) {
    return prisma.user.findUnique({
      where: { email: clean.toLowerCase() },
      select: {
        id: true,
        authUserId: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        preferredLang: true,
        isBanned: true,
      },
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
    select: {
      id: true,
      authUserId: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      preferredLang: true,
      isBanned: true,
    },
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

  // Extraction des métadonnées du client pour la sécurité et la détection anti-brute-force
  let clientIp = "127.0.0.1";
  let clientUserAgent = "unknown";
  let clientCountry = "Cameroun (par défaut)";
  try {
    const h = await headers();
    const forwardedFor = h.get("x-forwarded-for");
    const realIp = h.get("x-real-ip");
    clientIp = forwardedFor ? forwardedFor.split(",")[0].trim() : (realIp || "127.0.0.1");
    clientUserAgent = h.get("user-agent") || "unknown";
    clientCountry = h.get("x-vercel-ip-country") || h.get("cf-ipcountry") || "Cameroun (par défaut)";
  } catch {
    // Hors contexte HTTP direct
  }

  // 0. Vérification Anti-Brute-Force : blocage IP 30 minutes après 5 échecs consécutifs
  const ipBlockCheck = await checkIpIsBlocked(clientIp);
  if (ipBlockCheck.isBlocked) {
    return {
      error:
        lang === "fr"
          ? "Trop de tentatives, réessayez plus tard."
          : "Too many attempts, please try again later.",
    };
  }

  // 1. Détection proactive des attaques par injection SQL sur le formulaire de login
  if (detectSqlInjection(rawIdentifier) || detectSqlInjection(password)) {
    try {
      await logSecurityEvent({
        type: "injection_attempt",
        emailEssaye: rawIdentifier.slice(0, 150),
        ip: clientIp,
        userAgent: clientUserAgent,
        details: { target: "login_credentials", payload: rawIdentifier, country: clientCountry },
      });
    } catch (e) {
      console.error("[SECURITY] Logging injection attempt failed:", e);
    }
    return {
      error:
        lang === "fr"
          ? "Email ou mot de passe incorrect."
          : "Incorrect email or password.",
    };
  }

  try {
    let emailToUse = rawIdentifier;
    let userRole: string | null = null;

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
        // Enregistre l'échec et vérifie si le seuil est dépassé
        const failureResult = await recordFailedLoginAttempt({
          emailEssaye: rawIdentifier,
          ip: clientIp,
          userAgent: clientUserAgent,
          country: clientCountry,
          isAdminTarget: false,
        });
        if (failureResult.blocked) {
          return {
            error:
              lang === "fr"
                ? "Trop de tentatives, réessayez plus tard."
                : "Too many attempts, please try again later.",
          };
        }
        return {
          error:
            lang === "fr"
              ? "Email ou mot de passe incorrect."
              : "Incorrect email or password.",
        };
      }
      emailToUse = user.email;
      userRole = user.role;
    } else {
      userRole = user?.role ?? null;
      emailToUse = rawIdentifier.toLowerCase();
    }

    const { data, error } = await getSupabaseAuthClient().auth.signInWithPassword({
      email: emailToUse,
      password,
    });

    if (error || !data?.session?.access_token || !data?.session?.refresh_token || !data.user) {
      const isAdminTarget = isAdminRole(userRole) || emailToUse.includes("admin") || emailToUse === "divaasso17@gmail.com";
      const failureResult = await recordFailedLoginAttempt({
        emailEssaye: emailToUse,
        ip: clientIp,
        userAgent: clientUserAgent,
        country: clientCountry,
        isAdminTarget,
      });

      if (failureResult.blocked) {
        return {
          error:
            lang === "fr"
              ? "Trop de tentatives, réessayez plus tard."
              : "Too many attempts, please try again later.",
        };
      }

      return {
        error:
          lang === "fr"
            ? "Email ou mot de passe incorrect."
            : "Incorrect email or password.",
      };
    }

    if (user && !user.authUserId) {
      await prisma.user
        .update({ where: { id: user.id }, data: { authUserId: data.user.id } })
        .catch(() => {});
    } else if (!user) {
      const dbUser = await prisma.user.findUnique({
        where: { email: emailToUse },
        select: { id: true, role: true, isBanned: true },
      });
      if (dbUser?.isBanned) {
        return {
          error:
            lang === "fr"
              ? "Ce compte a été banni. Vous ne pouvez plus vous connecter à l'application."
              : "This account has been banned.",
        };
      }
      userRole = dbUser?.role ?? "MEMBER";
    }

    await clearServerAuthCookies();
    await setServerSupabaseCookies(data.session.access_token, data.session.refresh_token);

    const safeCallback = sanitizeCallbackUrl(callbackUrl);
    const redirectTo =
      safeCallback === "/dashboard" && isAdminRole(userRole) ? "/admin" : safeCallback;

    return {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      redirectTo,
    };
  } catch (err) {
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
    let targetAuthId = user.authUserId;

    if (!targetAuthId) {
      const { data: list, error: listError } = await supabaseAdmin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      if (listError) {
        console.error("[confirmPasswordResetAction] listUsers failed:", listError.message);
        return {
          error:
            lang === "fr"
              ? "Impossible de réinitialiser le mot de passe actuellement."
              : "Could not reset password. Please try again.",
        };
      }
      const found = list.users.find(
        (u) => u.email?.toLowerCase() === user.email.toLowerCase(),
      );
      if (found) {
        targetAuthId = found.id;
        await prisma.user
          .update({ where: { id: user.id }, data: { authUserId: found.id } })
          .catch(() => {});
      }
    }

    if (targetAuthId) {
      const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(targetAuthId, {
        password: newPassword,
        email_confirm: true,
      });
      if (updateError) {
        console.error("[confirmPasswordResetAction] updateUserById failed:", updateError.message);
        return { error: updateError.message };
      }
    } else {
      const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: user.email,
        password: newPassword,
        email_confirm: true,
        user_metadata: { full_name: user.name },
      });
      if (createError) {
        console.error("[confirmPasswordResetAction] createUser failed:", createError.message);
        return { error: createError.message };
      }
      if (created?.user?.id) {
        await prisma.user
          .update({ where: { id: user.id }, data: { authUserId: created.user.id } })
          .catch(() => {});
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
): Promise<{
  error?: string;
  success?: boolean;
  accessToken?: string;
  refreshToken?: string;
  redirectTo?: string;
}> {
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
    const supabaseAdmin = getSupabaseAdminClient();
    const { data: createdAuth, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    const isAlreadyRegistered = Boolean(
      createErr &&
        (createErr.message?.toLowerCase().includes("already registered") ||
          createErr.message?.toLowerCase().includes("already exists") ||
          createErr.message?.toLowerCase().includes("user already") ||
          (createErr as { code?: string })?.code === "user_already_exists" ||
          (createErr as { code?: string })?.code === "email_exists" ||
          createErr.message?.toLowerCase().includes("already been registered")),
    );

    if (isAlreadyRegistered) {
      return {
        error:
          lang === "fr"
            ? "Un compte existe déjà avec cette adresse email. Veuillez vous connecter."
            : "An account with this email address already exists. Please sign in.",
      };
    }

    if (createErr && !createdAuth?.user) {
      console.error("[confirmSignUpAction] supabase createUser error:", createErr);
      return {
        error:
          lang === "fr"
            ? `Erreur lors de la création du compte : ${createErr.message}`
            : createErr.message,
      };
    }

    const authUserId = createdAuth?.user?.id ?? null;

    const user = await prisma.user.upsert({
      where: { email },
      update: {
        name: fullName,
        emailVerified: new Date(),
        ...(authUserId ? { authUserId } : {}),
      },
      create: {
        email,
        name: fullName,
        emailVerified: new Date(),
        ...(authUserId ? { authUserId } : {}),
      },
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

    const safeCallback = sanitizeCallbackUrl(callbackUrl);
    const redirectTo =
      safeCallback === "/dashboard" && isAdminRole(user.role) ? "/admin" : safeCallback;

    const { data: signInData, error: signInErr } =
      await getSupabaseAuthClient().auth.signInWithPassword({
        email,
        password,
      });

    if (
      !signInErr &&
      signInData?.session?.access_token &&
      signInData?.session?.refresh_token
    ) {
      await clearServerAuthCookies();
      await setServerSupabaseCookies(
        signInData.session.access_token,
        signInData.session.refresh_token,
      );
      return {
        success: true,
        accessToken: signInData.session.access_token,
        refreshToken: signInData.session.refresh_token,
        redirectTo,
      };
    }

    return { success: true, redirectTo: "/login" };
  } catch (err) {
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
  void callbackUrl;
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

/**
 * Finalizes a Supabase OAuth login (Google) after `/auth/callback` obtains a
 * browser session: verifies the JWT, enforces ban checks, ensures `memberCode`
 * + welcome notifications for brand-new accounts, sets SSR cookies, and
 * computes the role-appropriate destination URL.
 */
export async function finalizeSupabaseOAuthAction(
  accessToken: string,
  refreshToken: string,
  callbackUrl: string = "/dashboard",
): Promise<{ error?: string; redirectTo: string }> {
  const lang = await getLang();
  try {
    if (!accessToken || !refreshToken) {
      return { error: "Default", redirectTo: "/login?error=Default" };
    }

    const { data, error } = await getSupabaseAuthClient().auth.getUser(accessToken);
    const rawSupaEmail = data?.user?.email?.trim();
    if (error || !data?.user || !rawSupaEmail) {
      return { error: "Default", redirectTo: "/login?error=Default" };
    }

    const supaUser = data.user;
    const email = rawSupaEmail.toLowerCase();
    const meta = (supaUser.user_metadata ?? {}) as Record<string, unknown>;
    const displayName =
      (typeof meta.full_name === "string" && meta.full_name.trim()) ||
      (typeof meta.name === "string" && meta.name.trim()) ||
      email.split("@")[0] ||
      "Membre";
    const googlePicture =
      (typeof meta.avatar_url === "string" && meta.avatar_url.trim()) ||
      (typeof meta.picture === "string" && meta.picture.trim()) ||
      null;

    let dbUser = await prisma.user.findFirst({
      where: {
        OR: [{ authUserId: supaUser.id }, { email: { equals: email, mode: "insensitive" } }],
      },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
        role: true,
        isBanned: true,
        authUserId: true,
        emailVerified: true,
        createdAt: true,
      },
    });

    if (!dbUser) {
      dbUser = await prisma.user.create({
        data: {
          authUserId: supaUser.id,
          email,
          name: displayName,
          image: googlePicture,
          emailVerified: new Date(),
        },
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
          role: true,
          isBanned: true,
          authUserId: true,
          emailVerified: true,
          createdAt: true,
        },
      });
    } else if (!dbUser.isBanned) {
      const updates: { authUserId?: string; emailVerified?: Date; image?: string } = {};
      if (!dbUser.authUserId) updates.authUserId = supaUser.id;
      if (!dbUser.emailVerified) updates.emailVerified = new Date();
      if (!dbUser.image && googlePicture) updates.image = googlePicture;
      if (Object.keys(updates).length > 0) {
        await prisma.user.update({ where: { id: dbUser.id }, data: updates }).catch(() => {});
      }
    }

    if (dbUser.isBanned) {
      await clearServerAuthCookies();
      return { error: "AccountBanned", redirectTo: "/login?error=AccountBanned" };
    }

    const memberCode = await ensureMemberCode(dbUser.id);

    // Send welcome notifications once if this account was just created via Google OAuth
    const isFreshAccount = Date.now() - dbUser.createdAt.getTime() < 120_000;
    if (isFreshAccount) {
      const existingNotifCount = await prisma.notification.count({
        where: { userId: dbUser.id },
      });
      if (existingNotifCount === 0) {
        void sendWelcomeAndAdminNotifications({
          userId: dbUser.id,
          name: dbUser.name,
          email: dbUser.email,
          memberCode,
          lang,
        });
      }
    }

    await clearServerAuthCookies();
    await setServerSupabaseCookies(accessToken, refreshToken);

    const safeCallback = sanitizeCallbackUrl(callbackUrl);
    const redirectTo =
      safeCallback === "/dashboard" && isAdminRole(dbUser.role) ? "/admin" : safeCallback;

    return { redirectTo };
  } catch (err) {
    console.error("[finalizeSupabaseOAuthAction] unexpected error:", err);
    return { error: "Default", redirectTo: "/login?error=Default" };
  }
}

/**
 * Local development quick-login helper (disabled in production).
 */
export async function devSignInSupabaseAction(email: string, callbackUrl: string = "/dashboard") {
  if (process.env.NODE_ENV === "production") return;

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { email: true, role: true, isBanned: true },
  });
  if (!user || user.isBanned) {
    redirect("/login?error=AccountBanned");
  }

  const admin = getSupabaseAdminClient();
  const { data: linkData } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: user.email,
  });
  const tokenHash = linkData?.properties?.hashed_token;
  if (!tokenHash) {
    redirect("/login?error=Default");
  }

  const { data: verified } = await getSupabaseAuthClient().auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  if (!verified?.session?.access_token || !verified?.session?.refresh_token) {
    redirect("/login?error=Default");
  }

  await clearServerAuthCookies();
  await setServerSupabaseCookies(verified.session.access_token, verified.session.refresh_token);

  const safeCallback = sanitizeCallbackUrl(callbackUrl);
  const redirectTo =
    safeCallback === "/dashboard" && isAdminRole(user.role) ? "/admin" : safeCallback;
  redirect(redirectTo);
}
