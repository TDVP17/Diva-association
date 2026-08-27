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
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background px-container-padding">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/icon-512.png" alt="DIVA Association" className="w-20 h-20 rounded-2xl shadow-md" />
      <h1 className="font-headline-lg-mobile text-headline-lg-mobile md:font-headline-lg md:text-headline-lg text-primary tracking-tight text-center">
        DIVA Association
      </h1>
      <span
        aria-hidden
        className="w-8 h-8 border-4 border-surface-variant border-t-primary rounded-full animate-spin mt-2"
      />
      <p className="font-label-sm text-label-sm text-on-surface-variant">{t("loadingEllipsis")}</p>
    </main>
  );
}
