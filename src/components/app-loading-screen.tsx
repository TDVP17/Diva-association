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
    <main className="min-h-screen w-full flex flex-col items-center justify-center gap-4 bg-background px-container-padding text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/icon-512.png" alt="" className="w-32 h-32 sm:w-36 sm:h-36 rounded-3xl shadow-lg" />
      <div className="flex flex-col items-center leading-tight">
        <span className="font-display-lg text-display-lg text-primary tracking-tight">DIVA</span>
        <span className="font-headline-lg text-headline-lg text-secondary tracking-wide -mt-1">Association</span>
      </div>
      <span
        aria-hidden
        className="w-8 h-8 border-4 border-surface-variant border-t-primary rounded-full animate-spin mt-2"
      />
      <p className="font-label-sm text-label-sm text-on-surface-variant">{t("loadingEllipsis")}</p>
    </main>
  );
}
