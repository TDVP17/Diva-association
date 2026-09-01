import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getLang } from "@/lib/i18n/get-lang";
import { getPublicStats, type PublicStats } from "@/lib/landing-stats";
import { LandingPage } from "@/components/landing/landing-page";

const FALLBACK_STATS: PublicStats = { memberCount: 0, activeCotisationCount: 0, totalContributionsTracked: 0 };

export default async function Home() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  // The stats row is a nice-to-have trust signal, not core content — a
  // transient DB/connection hiccup must never take down the entire public
  // landing page (a visitor's first impression of the platform).
  const [lang, stats] = await Promise.all([
    getLang(),
    getPublicStats().catch((err) => {
      console.error("[landing] getPublicStats failed, falling back to zeros:", err);
      return FALLBACK_STATS;
    }),
  ]);
  return <LandingPage lang={lang} stats={stats} />;
}
