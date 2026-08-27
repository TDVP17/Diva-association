"use client";

import { FriendlyError } from "@/components/friendly-error";

// Only fires when the root layout itself throws — Next.js requires this
// boundary to render its own <html>/<body> since it replaces the layout
// that would normally provide them.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <FriendlyError error={error} reset={reset} />
      </body>
    </html>
  );
}
