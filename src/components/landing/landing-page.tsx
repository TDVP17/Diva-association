import Link from "next/link";
import { LanguageToggle } from "@/components/language-toggle";
import { translate, type Lang, type TranslationKey } from "@/lib/i18n/translations";
import type { PublicStats } from "@/lib/landing-stats";

const STEP_ICONS = ["person_add", "groups", "smartphone", "payments"] as const;
const STEPS: { titleKey: TranslationKey; bodyKey: TranslationKey }[] = [
  { titleKey: "landingStep1Title", bodyKey: "landingStep1Body" },
  { titleKey: "landingStep2Title", bodyKey: "landingStep2Body" },
  { titleKey: "landingStep3Title", bodyKey: "landingStep3Body" },
  { titleKey: "landingStep4Title", bodyKey: "landingStep4Body" },
];

const BADGE_ICONS = ["lock", "fingerprint", "account_balance_wallet", "fact_check"] as const;
const BADGES: { titleKey: TranslationKey; bodyKey: TranslationKey }[] = [
  { titleKey: "landingBadgeEncryptedTitle", bodyKey: "landingBadgeEncryptedBody" },
  { titleKey: "landingBadgeKycTitle", bodyKey: "landingBadgeKycBody" },
  { titleKey: "landingBadgeMobileMoneyTitle", bodyKey: "landingBadgeMobileMoneyBody" },
  { titleKey: "landingBadgeTransparentTitle", bodyKey: "landingBadgeTransparentBody" },
];

function formatCompact(n: number): string {
  return n.toLocaleString("en-US");
}

export function LandingPage({ lang, stats }: { lang: Lang; stats: PublicStats }) {
  const t = (key: TranslationKey, vars?: Record<string, string>) => translate(lang, key, vars);
  const year = new Date().getFullYear();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="w-full sticky top-0 z-40 bg-surface/95 backdrop-blur-sm border-b border-outline-variant/30">
        <div className="max-w-6xl mx-auto px-container-padding h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-512.png" alt="DIVA Association" className="w-8 h-8 rounded-lg flex-shrink-0" />
            <span className="font-title-md text-title-md text-primary tracking-tight truncate">DIVA Association</span>
          </Link>
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            <LanguageToggle currentLang={lang} />
            <Link
              href="/login"
              className="hidden sm:inline-flex px-4 py-2 rounded-lg font-label-md text-label-md text-primary border border-primary/30 hover:bg-primary/5 transition-colors"
            >
              {t("landingNavSignIn")}
            </Link>
            <Link
              href="/login?mode=signup"
              className="inline-flex px-4 py-2 rounded-lg font-label-md text-label-md bg-primary text-on-primary hover:opacity-90 active:scale-[0.98] transition-all shadow-sm"
            >
              {t("landingNavGetStarted")}
            </Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="absolute top-0 right-0 w-72 h-72 bg-secondary-container rounded-full blur-[100px] opacity-20 -mr-20 -mt-20" />
          <div className="absolute bottom-0 left-0 w-72 h-72 bg-primary-container rounded-full blur-[100px] opacity-10 -ml-20 -mb-20" />
          <div className="relative max-w-4xl mx-auto px-container-padding py-16 sm:py-20 md:py-28 text-center flex flex-col items-center">
            <span className="inline-flex items-center gap-1.5 bg-secondary-fixed-dim/20 text-on-secondary-fixed-variant px-3 py-1 rounded-full font-label-sm text-label-sm mb-stack-gap-md">
              <span className="material-symbols-outlined text-[16px]">verified</span>
              {t("landingHeroEyebrow")}
            </span>
            <h1 className="font-headline-lg-mobile text-headline-lg-mobile md:font-display-lg md:text-display-lg text-primary tracking-tight mb-stack-gap-md max-w-3xl text-balance">
              {t("landingHeroTitle")}
            </h1>
            <p className="font-body-lg text-body-lg text-on-surface-variant max-w-xl mb-section-margin text-balance">
              {t("landingHeroSubtitle")}
            </p>
            <div className="flex flex-col sm:flex-row gap-stack-gap-md w-full sm:w-auto">
              <Link
                href="/login?mode=signup"
                className="px-6 py-3.5 rounded-xl bg-primary text-on-primary font-title-sm text-title-sm hover:opacity-90 active:scale-[0.98] transition-all shadow-[0px_8px_30px_rgba(30,41,59,0.15)] text-center"
              >
                {t("landingHeroCtaPrimary")}
              </Link>
              <Link
                href="/login"
                className="px-6 py-3.5 rounded-xl bg-white text-primary border border-outline-variant font-title-sm text-title-sm hover:bg-surface-container-low active:scale-[0.98] transition-all text-center"
              >
                {t("landingHeroCtaSecondary")}
              </Link>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="max-w-6xl mx-auto px-container-padding py-section-margin md:py-20">
          <div className="text-center mb-section-margin md:mb-16">
            <h2 className="font-headline-lg-mobile text-headline-lg-mobile md:font-headline-lg md:text-headline-lg text-on-surface mb-stack-gap-sm">
              {t("landingHowItWorksTitle")}
            </h2>
            <p className="font-body-md text-body-md text-on-surface-variant">{t("landingHowItWorksSubtitle")}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-stack-gap-lg">
            {STEPS.map((step, i) => (
              <div key={step.titleKey} className="relative flex flex-col items-center text-center gap-stack-gap-sm">
                <div className="w-14 h-14 rounded-2xl bg-primary-container flex items-center justify-center mb-1">
                  <span className="material-symbols-outlined text-primary text-[26px]">{STEP_ICONS[i]}</span>
                </div>
                <span className="font-label-sm text-label-sm text-secondary font-bold">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="font-title-md text-title-md text-on-surface">{t(step.titleKey)}</h3>
                <p className="font-body-md text-body-md text-on-surface-variant">{t(step.bodyKey)}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Trust & security */}
        <section className="bg-primary text-on-primary">
          <div className="max-w-6xl mx-auto px-container-padding py-section-margin md:py-20">
            <div className="text-center mb-section-margin md:mb-16">
              <h2 className="font-headline-lg-mobile text-headline-lg-mobile md:font-headline-lg md:text-headline-lg mb-stack-gap-sm">
                {t("landingTrustTitle")}
              </h2>
              <p className="font-body-md text-body-md text-on-primary/80">{t("landingTrustSubtitle")}</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-stack-gap-md mb-section-margin md:mb-16">
              {BADGES.map((badge, i) => (
                <div key={badge.titleKey} className="bg-white/10 rounded-xl p-5 flex flex-col gap-2 backdrop-blur-sm">
                  <span className="material-symbols-outlined text-secondary-fixed-dim text-[24px]">{BADGE_ICONS[i]}</span>
                  <h3 className="font-title-md text-title-md">{t(badge.titleKey)}</h3>
                  <p className="font-label-md text-label-md text-on-primary/75">{t(badge.bodyKey)}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-stack-gap-lg text-center border-t border-white/15 pt-section-margin">
              <div>
                <p className="font-display-lg text-display-lg text-secondary-fixed-dim">{formatCompact(stats.memberCount)}</p>
                <p className="font-label-md text-label-md text-on-primary/75 mt-1">{t("landingStatMembers")}</p>
              </div>
              <div>
                <p className="font-display-lg text-display-lg text-secondary-fixed-dim">{formatCompact(stats.activeCotisationCount)}</p>
                <p className="font-label-md text-label-md text-on-primary/75 mt-1">{t("landingStatCotisations")}</p>
              </div>
              <div>
                <p className="font-display-lg text-display-lg text-secondary-fixed-dim">
                  {formatCompact(stats.totalContributionsTracked)}
                </p>
                <p className="font-label-md text-label-md text-on-primary/75 mt-1">{t("landingStatContributions")}</p>
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="max-w-4xl mx-auto px-container-padding py-section-margin md:py-20 text-center">
          <h2 className="font-headline-lg-mobile text-headline-lg-mobile md:font-headline-lg md:text-headline-lg text-on-surface mb-stack-gap-md">
            {t("landingHeroCtaPrimary")}
          </h2>
          <Link
            href="/login?mode=signup"
            className="inline-flex px-8 py-3.5 rounded-xl bg-primary text-on-primary font-title-sm text-title-sm hover:opacity-90 active:scale-[0.98] transition-all shadow-[0px_8px_30px_rgba(30,41,59,0.15)]"
          >
            {t("landingHeroCtaPrimary")}
          </Link>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-outline-variant/30 bg-surface">
        <div className="max-w-6xl mx-auto px-container-padding py-stack-gap-lg flex flex-col sm:flex-row items-center justify-between gap-stack-gap-md">
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-512.png" alt="" className="w-6 h-6 rounded-md" />
            <div>
              <p className="font-label-md text-label-md text-on-surface">DIVA Association</p>
              <p className="font-label-sm text-[11px] text-on-surface-variant">{t("landingFooterTagline")}</p>
            </div>
          </div>
          <div className="flex items-center gap-stack-gap-md font-label-sm text-label-sm text-on-surface-variant">
            <Link href="/privacy-policy" className="hover:text-primary transition-colors">
              {t("landingFooterPrivacy")}
            </Link>
            <Link href="/terms-of-service" className="hover:text-primary transition-colors">
              {t("landingFooterTerms")}
            </Link>
          </div>
        </div>
        <p className="text-center font-label-sm text-[11px] text-on-surface-variant pb-stack-gap-md">
          {t("landingFooterRights", { year: String(year) })}
        </p>
      </footer>
    </div>
  );
}
