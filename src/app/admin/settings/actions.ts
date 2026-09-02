"use server";

import { revalidatePath } from "next/cache";
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
    // Without this, Next's client-side router cache can keep serving the
    // stale (or empty) version of /reglement-general to anyone whose
    // browser already had that route cached/prefetched — the page itself
    // re-renders fresh on a real server request (auth() makes it dynamic),
    // but a cached client navigation never issues one until this expires.
    revalidatePath("/reglement-general");
    return { success: "General rules updated." };
  } catch (err) {
    console.error("[saveGeneralRulesAction] unexpected error:", err);
    return { error: "Could not save the general rules. Please try again." };
  }
}
