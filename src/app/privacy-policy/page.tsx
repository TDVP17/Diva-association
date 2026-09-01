import type { Metadata } from "next";
import { getLang, getTranslator } from "@/lib/i18n/get-lang";
import { LegalPageShell, LegalSection } from "@/components/landing/legal-page-shell";

const LAST_UPDATED = "2026-09-01";

export const metadata: Metadata = { title: "Privacy Policy" };

export default async function PrivacyPolicyPage() {
  const lang = await getLang();
  const t = getTranslator(lang);

  return (
    <LegalPageShell
      lang={lang}
      title={t("privacyPolicyTitle")}
      lastUpdated={t("privacyPolicyLastUpdated", { date: LAST_UPDATED })}
    >
      <p className="font-body-md text-body-md text-on-surface-variant">{t("privacyPolicyIntro")}</p>
      <LegalSection title={t("privacyPolicySectionDataTitle")} body={t("privacyPolicySectionDataBody")} />
      <LegalSection title={t("privacyPolicySectionUseTitle")} body={t("privacyPolicySectionUseBody")} />
      <LegalSection title={t("privacyPolicySectionSharingTitle")} body={t("privacyPolicySectionSharingBody")} />
      <LegalSection title={t("privacyPolicySectionSecurityTitle")} body={t("privacyPolicySectionSecurityBody")} />
      <LegalSection title={t("privacyPolicySectionRightsTitle")} body={t("privacyPolicySectionRightsBody")} />
      <LegalSection title={t("privacyPolicySectionContactTitle")} body={t("privacyPolicySectionContactBody")} />
    </LegalPageShell>
  );
}
