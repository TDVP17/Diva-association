"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getSupabaseAdminClient, getSupabaseAuthClient } from "@/lib/supabase-auth";
import { hasVerifiedOtp } from "@/lib/otp";
import { getLang } from "@/lib/i18n/get-lang";
import { validateEmailAddress } from "@/lib/email-validator";

export interface ProfileFormState {
  error?: string;
  success?: string;
}

export async function updateProfileAction(
  _prevState: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const session = await auth();
  if (!session?.user) {
    return { error: "You must be signed in to update your profile." };
  }

  const city = String(formData.get("city") ?? "").trim();
  const neighborhood = String(formData.get("neighborhood") ?? "").trim();
  const rawLat = String(formData.get("latitude") ?? "").trim();
  const rawLng = String(formData.get("longitude") ?? "").trim();
  const latitude = rawLat ? Number(rawLat) : null;
  const longitude = rawLng ? Number(rawLng) : null;

  try {
    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        city: city || null,
        neighborhood: neighborhood || null,
        latitude: latitude !== null && Number.isFinite(latitude) ? latitude : undefined,
        longitude: longitude !== null && Number.isFinite(longitude) ? longitude : undefined,
      },
    });
    return { success: "Profile updated." };
  } catch (err) {
    console.error("[updateProfileAction] unexpected error:", err);
    return { error: "Could not save your profile. Please try again." };
  }
}

/** Phone is a sensitive field — requires a fresh, verified PHONE_CHANGE OTP sent to the new number. */
export async function updatePhoneAction(
  _prevState: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const session = await auth();
  const lang = await getLang();
  if (!session?.user) {
    return { error: lang === "fr" ? "Vous devez être connecté pour modifier votre profil." : "You must be signed in to update your profile." };
  }

  const phone = String(formData.get("phone") ?? "").trim();
  if (!phone) {
    return { error: lang === "fr" ? "Veuillez entrer un numéro de téléphone." : "Please enter a phone number." };
  }

  const verified = await hasVerifiedOtp(session.user.id, "PHONE_CHANGE", phone);
  if (!verified) {
    return {
      error:
        lang === "fr"
          ? "Veuillez d'abord valider ce numéro avec le code de vérification."
          : "Please verify this phone number with the code we sent you first.",
    };
  }

  try {
    await prisma.user.update({ where: { id: session.user.id }, data: { phone } });
    return { success: lang === "fr" ? "Numéro de téléphone mis à jour." : "Phone number updated." };
  } catch (err) {
    console.error("[updatePhoneAction] unexpected error:", err);
    return {
      error:
        lang === "fr"
          ? "L'enregistrement de votre numéro n'a pas pu aboutir pour le moment. Veuillez réessayer plus tard."
          : "Could not register your phone number right now. Please try again later.",
    };
  }
}

/**
 * Email changes don't exist anywhere else in this codebase — this is net
 * new. Requires a fresh, verified EMAIL_CHANGE OTP (sent to the on-file
 * WhatsApp number, since that's the identity channel proving it's really
 * the account owner). Bypasses Supabase Auth's own email-confirmation flow
 * on purpose — the WhatsApp OTP is the chosen verification gate instead.
 */
export async function updateEmailAction(
  _prevState: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const session = await auth();
  if (!session?.user?.email) {
    return { error: "You must be signed in to update your profile." };
  }

  const rawEmail = String(formData.get("email") ?? "").trim();
  const lang = await getLang();
  const check = await validateEmailAddress(rawEmail, lang);
  if (!check.valid) {
    return { error: check.error };
  }
  const email = check.normalizedEmail || rawEmail.toLowerCase();

  const verified = await hasVerifiedOtp(session.user.id, "EMAIL_CHANGE", email);
  if (!verified) {
    return { error: lang === "fr" ? "Veuillez d'abord valider cette adresse e-mail avec le code de vérification." : "Please verify this email address with the code we sent you first." };
  }

  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const { data: list, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    if (listError) {
      console.error("[updateEmailAction] could not list Supabase users:", listError.message);
      return { error: "Could not update your email. Please try again." };
    }
    const authUser = list.users.find((u) => u.email === session.user.email);
    if (!authUser) {
      return { error: "Could not update your email. Please try again." };
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(authUser.id, { email });
    if (updateError) {
      console.error("[updateEmailAction] email update failed:", updateError.message);
      return { error: "Could not update your email. Please try again." };
    }

    await prisma.user.update({ where: { id: session.user.id }, data: { email } });
    return { success: "Email updated." };
  } catch (err) {
    console.error("[updateEmailAction] unexpected error:", err);
    return { error: "Could not update your email. Please try again." };
  }
}

export async function changePasswordAction(
  _prevState: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const session = await auth();
  if (!session?.user?.email) {
    return { error: "You must be signed in to change your password." };
  }

  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!currentPassword || !newPassword || !confirmPassword) {
    return { error: "All fields are required." };
  }
  if (newPassword.length < 6) {
    return { error: "New password must be at least 6 characters." };
  }
  if (newPassword !== confirmPassword) {
    return { error: "New passwords do not match." };
  }

  const verified = await hasVerifiedOtp(session.user.id, "PASSWORD_CHANGE", null);
  if (!verified) {
    return { error: "Please verify the code we sent you first." };
  }

  try {
    // Two factors required: the current password AND a fresh OTP (checked
    // above) — a valid NextAuth session plus the current password alone
    // shouldn't be enough to rotate the underlying Supabase Auth credential.
    const { error: verifyError } = await getSupabaseAuthClient().auth.signInWithPassword({
      email: session.user.email,
      password: currentPassword,
    });
    if (verifyError) {
      return { error: "Current password is incorrect, or this account doesn't sign in with a password." };
    }

    const supabaseAdmin = getSupabaseAdminClient();
    const { data: list, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    if (listError) {
      console.error("[changePasswordAction] could not list Supabase users:", listError.message);
      return { error: "Could not update your password. Please try again." };
    }
    const authUser = list.users.find((u) => u.email === session.user.email);
    if (!authUser) {
      return { error: "Could not update your password. Please try again." };
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
      password: newPassword,
    });
    if (updateError) {
      console.error("[changePasswordAction] password update failed:", updateError.message);
      return { error: "Could not update your password. Please try again." };
    }

    return { success: "Password updated." };
  } catch (err) {
    console.error("[changePasswordAction] unexpected error:", err);
    return { error: "Could not update your password. Please try again." };
  }
}
