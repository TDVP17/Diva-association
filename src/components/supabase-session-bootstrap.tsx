"use client";

import { useEffect } from "react";
import { ensureBrowserSupabaseSession } from "@/lib/supabase/client";

/**
 * Ensures the browser holds an active Supabase Auth `Bearer` token and Realtime
 * JWT matching the server-authenticated user. If the member arrived with a
 * pre-migration NextAuth cookie, silently upgrades them once in the background.
 */
export function SupabaseSessionBootstrap({ expectedEmail }: { expectedEmail?: string }) {
  useEffect(() => {
    void ensureBrowserSupabaseSession(expectedEmail);
  }, [expectedEmail]);

  return null;
}

