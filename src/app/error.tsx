"use client";

import { FriendlyError } from "@/components/friendly-error";

export default function RootSegmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <FriendlyError error={error} reset={reset} />;
}
