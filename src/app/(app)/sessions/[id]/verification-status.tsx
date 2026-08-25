"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * No websocket/polling infra exists elsewhere in this app — the webhook
 * that resolves verification lands asynchronously, so this just refreshes
 * the server component periodically until the KycVerification row (fetched
 * server-side) moves out of PENDING.
 */
export function VerificationPollingRefresh() {
  const router = useRouter();
  useEffect(() => {
    const interval = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(interval);
  }, [router]);
  return null;
}
