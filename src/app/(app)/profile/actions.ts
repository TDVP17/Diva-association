"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getSupabaseAdminClient, getSupabaseAuthClient } from "@/lib/supabase-auth";

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

  const phone = String(formData.get("phone") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const neighborhood = String(formData.get("neighborhood") ?? "").trim();

  try {
    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        phone: phone || null,
        city: city || null,
        neighborhood: neighborhood || null,
      },
    });
    return { success: "Profile updated." };
  } catch (err) {
    console.error("[updateProfileAction] unexpected error:", err);
    return { error: "Could not save your profile. Please try again." };
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

  try {
    // Re-verify identity with the current password before allowing a change —
    // a valid NextAuth session alone shouldn't be enough to rotate the
    // underlying Supabase Auth credential.
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
