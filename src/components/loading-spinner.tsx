/**
 * Standard loading placeholder — replaces bare "…" text across the app.
 * Always horizontally AND vertically centered within its container via
 * flex, matching the spinner style used by the full-page splash
 * (app-loading-screen.tsx) and src/app/(app)/profile/loading.tsx.
 *
 * Use `fullPage` for a route's primary content while its initial data is
 * still loading (min-h-[60vh], enough to center within the visible
 * viewport below the header); omit it for a smaller list/section inside
 * an already-rendered page or modal (compact vertical padding instead).
 */
export function LoadingSpinner({ fullPage = false, className = "" }: { fullPage?: boolean; className?: string }) {
  return (
    <div
      className={`w-full flex items-center justify-center ${fullPage ? "min-h-[60vh]" : "py-10"} ${className}`}
    >
      <span
        aria-hidden
        className="w-8 h-8 border-4 border-surface-variant border-t-primary rounded-full animate-spin"
      />
    </div>
  );
}
