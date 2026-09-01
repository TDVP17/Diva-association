import type { Metadata } from "next";
import { getLang, getTranslator } from "@/lib/i18n/get-lang";
import { LegalPageShell, LegalSection } from "@/components/landing/legal-page-shell";

const LAST_UPDATED = "2026-09-01";

export const metadata: Metadata = { title: "Terms of Service" };

export default async function TermsOfServicePage() {
  const lang = await getLang();
  const t = getTranslator(lang);

  return (
    <LegalPageShell
      lang={lang}
      title={t("termsOfServiceTitle")}
      lastUpdated={t("termsOfServiceLastUpdated", { date: LAST_UPDATED })}
    >
      <p className="font-body-md text-body-md text-on-surface-variant">{t("termsOfServiceIntro")}</p>
      <LegalSection title={t("termsSectionServiceTitle")} body={t("termsSectionServiceBody")} />
      <LegalSection title={t("termsSectionEligibilityTitle")} body={t("termsSectionEligibilityBody")} />
      <LegalSection title={t("termsSectionResponsibilitiesTitle")} body={t("termsSectionResponsibilitiesBody")} />
      <LegalSection title={t("termsSectionPaymentsTitle")} body={t("termsSectionPaymentsBody")} />
      <LegalSection title={t("termsSectionTerminationTitle")} body={t("termsSectionTerminationBody")} />
      <LegalSection title={t("termsSectionLiabilityTitle")} body={t("termsSectionLiabilityBody")} />
      <LegalSection title={t("termsSectionChangesTitle")} body={t("termsSectionChangesBody")} />
      <LegalSection title={t("termsSectionContactTitle")} body={t("termsSectionContactBody")} />
    </LegalPageShell>
  );
}
