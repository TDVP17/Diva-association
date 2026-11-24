import type { Lang } from "@/lib/i18n/translations";

/**
 * Clean splash shown by Next.js Suspense boundary while a route resolves.
 * Shows only the spinning indicator as requested (no logo, no loading text).
 */
export function AppLoadingScreen({ lang: _lang }: { lang?: Lang }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#003528]"
    >
      <span
        aria-hidden
        className="w-10 h-10 border-[3px] border-[#efc25b]/25 border-t-[#efc25b] rounded-full animate-spin"
      />
    </div>
  );
}
