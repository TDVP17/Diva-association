"use client";

import { useEffect } from "react";

/**
 * If Supabase OAuth ever falls back to the root Site URL (`/#access_token=...`),
 * immediately forwards the hash to `/auth/callback` so login completes cleanly.
 */
export function OAuthHashForwarder() {
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash.includes("access_token=")) {
      window.location.replace(`/auth/callback${window.location.search}${window.location.hash}`);
    }
  }, []);

  return null;
}

