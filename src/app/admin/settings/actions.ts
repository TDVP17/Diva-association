"use server";

import { requireAdmin } from "@/lib/require-admin";
import { setAssociationRules } from "@/lib/association-rules";

export interface GeneralRulesFormState {
  error?: string;
  success?: string;
}

export async function saveGeneralRulesAction(
  _prevState: GeneralRulesFormState,
  formData: FormData,
): Promise<GeneralRulesFormState> {
  const admin = await requireAdmin();
  if (!admin) {
    return { error: "You must be an admin to do this." };
  }

  const content = String(formData.get("content") ?? "").trim();

  try {
    await setAssociationRules(content, admin.user.id);
    return { success: "General rules updated." };
  } catch (err) {
    console.error("[saveGeneralRulesAction] unexpected error:", err);
    return { error: "Could not save the general rules. Please try again." };
  }
}
