"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function JoinButton({ tontineSessionId, label }: { tontineSessionId: string; label: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleJoin() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${tontineSessionId}/join`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not submit your join request");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit your join request");
      setLoading(false);
    }
  }

  return (
    <div>
      {error && <p className="font-label-sm text-label-sm text-error text-center mb-2">{error}</p>}
      <button
        onClick={handleJoin}
        disabled={loading}
        className="w-full bg-primary text-on-primary font-label-md text-label-md h-12 rounded-lg flex items-center justify-center gap-2 hover:opacity-90 active:scale-95 transition-all disabled:opacity-60"
      >
        <span className="material-symbols-outlined">group_add</span>
        {loading ? "Submitting..." : label}
      </button>
    </div>
  );
}
