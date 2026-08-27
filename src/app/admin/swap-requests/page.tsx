import { getLang, getTranslator } from "@/lib/i18n/get-lang";
import { requireAdmin } from "@/lib/require-admin";
import { redirect } from "next/navigation";
import { SwapRequestPanel } from "@/components/admin/swap-request-panel";

export default async function AdminSwapRequestsPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/admin");
  const lang = await getLang();
  const t = getTranslator(lang);

  return (
    <main className="px-container-padding pt-stack-gap-lg pb-32 max-w-3xl mx-auto w-full">
      <h2 className="font-display-lg text-display-lg text-primary mb-2">{t("positionChangeRequestsCard")}</h2>
      <p className="text-on-surface-variant font-body-lg mb-section-margin">{t("positionChangeRequestsCardBody")}</p>
      <SwapRequestPanel lang={lang} />
    </main>
  );
}
