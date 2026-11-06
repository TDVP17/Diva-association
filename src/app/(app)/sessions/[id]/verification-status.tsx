"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Étape 1 (STOP CPU): le router.refresh() toutes les 5s a été supprimé.
 * Écoute uniquement les mises à jour Realtime de la ligne `kyc_verifications`
 * (ou le retour au premier plan de l'onglet) pour rafraîchir sans aucun polling.
 */
export function VerificationPollingRefresh({
  verificationId,
}: {
  verificationId?: string;
}) {
  const router = useRouter();

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      ? supabase
          .channel(
            verificationId
              ? `kyc-verification:${verificationId}`
              : "kyc-verification",
          )
          .on(
            "postgres_changes",
            {
              event: "UPDATE",
              schema: "public",
              table: "kyc_verifications",
              ...(verificationId ? { filter: `id=eq.${verificationId}` } : {}),
            },
            () => {
              router.refresh();
            },
          )
          .subscribe()
      : null;

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      if (supabase && channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [router, verificationId]);

  return null;
}
