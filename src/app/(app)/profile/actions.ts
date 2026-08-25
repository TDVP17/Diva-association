"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

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
