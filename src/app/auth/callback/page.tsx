"use client";

import { useEffect } from "react";
import { finalizeSupabaseOAuthAction } from "@/app/login/actions";
import {
  clearBrowserSupabaseCookies,
  getSupabaseBrowserClient,
  writeBrowserSupabaseCookies,
} from "@/lib/supabase/client";

/**
 * Handles the return leg of Supabase Google OAuth (`/auth/callback`).
 * Exchanges `#access_token` or `?code=...` directly in the browser via
 * `@supabase/supabase-js`, syncs SSR cookies + DB user profile via
 * `finalizeSupabaseOAuthAction`, and redirects to the member/admin home.
 */
export default function AuthCallbackPage() {
  useEffect(() => {
    let cancelled = false;

    async function completeOAuth() {
      try {
        const search = new URLSearchParams(window.location.search);
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const nextUrl = search.get("next") || "/dashboard";

        const oauthErr =
          search.get("error") ||
          hash.get("error") ||
          search.get("error_code") ||
          hash.get("error_code");

        if (oauthErr) {
          const mapped = oauthErr.toLowerCase().includes("denied") ? "AccessDenied" : "Default";
          window.location.replace(`/login?error=${mapped}`);
          return;
        }

        const supabase = getSupabaseBrowserClient();
        if (!supabase) {
          window.location.replace("/login?error=Configuration");
          return;
        }

        let {
          data: { session },
        } = await supabase.auth.getSession();

        // If implicit hash tokens arrived before detectSessionInUrl settled, set explicitly
        if (!session) {
          const hashAccess = hash.get("access_token");
          const hashRefresh = hash.get("refresh_token");
          if (hashAccess && hashRefresh) {
            const explicit = await supabase.auth.setSession({
              access_token: hashAccess,
              refresh_token: hashRefresh,
            });
            session = explicit.data.session;
          }
        }

        // If PKCE code flow was used, exchange `?code=...`
        const code = search.get("code");
        if (!session && code) {
          const exchanged = await supabase.auth.exchangeCodeForSession(code);
          session = exchanged.data.session;
        }

        if (!session?.access_token || !session?.refresh_token) {
          window.location.replace("/login?error=Default");
          return;
        }

        writeBrowserSupabaseCookies(session);
        const result = await finalizeSupabaseOAuthAction(
          session.access_token,
          session.refresh_token,
          nextUrl,
        );

        if (cancelled) return;

        if (result.error) {
          await supabase.auth.signOut().catch(() => {});
          clearBrowserSupabaseCookies();
          window.location.replace(result.redirectTo || `/login?error=${result.error}`);
          return;
        }

        window.location.replace(result.redirectTo || "/dashboard");
      } catch (err) {
        console.error("[AuthCallbackPage] OAuth completion error:", err);
        if (!cancelled) {
          window.location.replace("/login?error=Default");
        }
      }
    }

    void completeOAuth();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 bg-background">
      <div className="glass-card rounded-3xl p-8 max-w-sm w-full text-center flex flex-col items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-primary/10 text-primary flex items-center justify-center">
          <span className="w-7 h-7 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
        <h1 className="font-title-md text-title-md text-on-surface font-semibold">
          Connexion sécurisée en cours…
        </h1>
        <p className="font-body-sm text-body-sm text-on-surface-variant">
          Veuillez patienter un instant pendant l&apos;ouverture de votre espace DIVA Asso.
        </p>
      </div>
    </main>
  );
}

