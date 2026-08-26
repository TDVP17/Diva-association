"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getSupabaseAuthClient } from "@/lib/supabase-auth";
import { isAdminRole } from "@/lib/constants";

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
    // The login form's callbackUrl defaults to the member dashboard, with no
    // way to know in advance whether the signing-in account is an admin —
    // admins never have a member dashboard to land on, so redirect them
    // straight to /admin instead, unless a specific non-default page was
    // being requested (e.g. a deep link that bounced through /login).
    let redirectTo = callbackUrl;
    if (callbackUrl === "/dashboard") {
      const target = await prisma.user.findUnique({ where: { email }, select: { role: true } });
      if (isAdminRole(target?.role)) redirectTo = "/admin";
    }
    await signIn("email-password", { email, password, redirectTo });
    return {};
  } catch (err) {
    if (isRedirectSignal(err)) throw err; // successful sign-in — let the redirect happen
    if (err instanceof AuthError) {
      return { error: "Incorrect email or password." };
    }
    console.error("[signInAction] unexpected error:", err);
    return { error: "Something went wrong while signing you in. Please try again." };
  }
}

export async function signUpAction(
  callbackUrl: string,
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const fullName = String(formData.get("fullName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!fullName || !email || !password) {
    return { error: "All fields are required." };
  }
  if (password.length < 6) {
    return { error: "Password must be at least 6 characters." };
  }

  try {
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
    // users table so the rest of the app (role, memberships, etc.) has
    // something to attach to. A personal/sponsor code, if the user ever
    // sets one, is added later — not required to create an account.
    await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, name: fullName },
    });

    if (!data.session) {
      // Email confirmation is required before the account can sign in.
      return {
        success: "Account created! Check your email to confirm it, then sign in.",
      };
    }

    await signIn("email-password", { email, password, redirectTo: callbackUrl });
    return {};
  } catch (err) {
    if (isRedirectSignal(err)) throw err; // successful sign-in — let the redirect happen
    if (err instanceof AuthError) {
      return { success: "Account created — please sign in." };
    }
    console.error("[signUpAction] unexpected error:", err);
    return { error: "Something went wrong while creating your account. Please try again." };
  }
}
