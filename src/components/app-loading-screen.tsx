import { translate, type Lang } from "@/lib/i18n/translations";

/**
 * Branded splash shown by Next.js's automatic loading.tsx Suspense
 * boundary while a route segment's async Server Components (auth check,
 * initial data fetch) resolve — fires once when entering a top-level
 * segment like (app)/ or admin/, not on every internal navigation, since
 * the layout that owns the boundary doesn't remount for sibling routes.
 */
export function AppLoadingScreen({ lang }: { lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#003528] px-container-padding text-center"
    >
      <div className="flex flex-col items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icons/icon-512.png"
          alt="DIVA Asso."
          className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl shadow-2xl object-contain"
        />
        <div className="mt-8 flex flex-col items-center gap-3">
          <span
            aria-hidden
            className="w-7 h-7 border-2 border-[#e9c349]/30 border-t-[#fed65b] rounded-full animate-spin"
          />
          <p className="font-label-sm text-[12px] text-[#fed65b]/80 tracking-wider">
            {t("loadingEllipsis")}
          </p>
        </div>
      </div>
    </div>
  );
}
