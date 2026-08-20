"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getSupabaseAuthClient } from "@/lib/supabase-auth";

export interface AuthFormState {
  error?: string;
  success?: string;
}

export async function signInAction(
  callbackUrl: string,
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  try {
    await signIn("email-password", { email, password, redirectTo: callbackUrl });
  } catch (err) {
    if (err instanceof AuthError) {
      return { error: "Incorrect email or password." };
    }
    throw err; // NEXT_REDIRECT (on success) and other framework internals must propagate
  }
  return {};
}

export async function signUpAction(
  callbackUrl: string,
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const fullName = String(formData.get("fullName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const sponsorCode = String(formData.get("sponsorCode") ?? "").trim();

  if (!fullName || !email || !password || !sponsorCode) {
    return { error: "All fields are required." };
  }
  if (password.length < 6) {
    return { error: "Password must be at least 6 characters." };
  }

  const { data, error } = await getSupabaseAuthClient().auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });

  if (error) {
    return { error: error.message };
  }
  if (!data.user) {
    return { error: "Could not create your account. Please try again." };
  }
  if (data.user.identities && data.user.identities.length === 0) {
    // Supabase's signal for "this email is already registered" when email
    // enumeration protection is on: it returns a fake-success user instead
    // of a clear error, to avoid leaking which emails already have accounts.
    return { error: "An account with this email already exists. Try signing in instead." };
  }

  // Supabase Auth now owns the credential; mirror the account into our own
  // users table so the rest of the app (role, kycStatus, memberships, etc.)
  // has something to attach to.
  await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: fullName, sponsorCode },
  });

  if (!data.session) {
    // Email confirmation is required before the account can sign in.
    return {
      success: "Account created! Check your email to confirm it, then sign in.",
    };
  }

  try {
    await signIn("email-password", { email, password, redirectTo: callbackUrl });
  } catch (err) {
    if (err instanceof AuthError) {
      return { success: "Account created — please sign in." };
    }
    throw err;
  }
  return {};
}
