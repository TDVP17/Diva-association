"use client";

import { useEffect } from "react";

export default function ProfileError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[profile] render error:", error);
  }, [error]);

  return (
    <main className="px-container-padding py-stack-gap-lg max-w-md mx-auto text-center flex flex-col items-center gap-3">
      <span className="material-symbols-outlined text-error text-4xl">error</span>
      <h1 className="font-title-md text-title-md text-on-surface">Couldn&rsquo;t load your profile</h1>
      <p className="font-body-md text-body-md text-on-surface-variant">
        Something went wrong while loading this page. Please try again.
      </p>
      <button
        onClick={reset}
        className="py-2 px-4 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 active:scale-95 transition-all"
      >
        Try again
      </button>
    </main>
  );
}
