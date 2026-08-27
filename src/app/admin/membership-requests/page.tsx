import { redirect } from "next/navigation";
import { getLang, getTranslator } from "@/lib/i18n/get-lang";
import { requireAdmin } from "@/lib/require-admin";
import { AdminMembershipRequestsClient } from "./admin-membership-requests-client";

export default async function AdminMembershipRequestsPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/admin");
  const lang = await getLang();
  const t = getTranslator(lang);

  return (
    <main className="px-container-padding pt-stack-gap-lg pb-32 max-w-3xl mx-auto w-full">
      <h2 className="font-display-lg text-display-lg text-primary mb-2">{t("cotisationMembershipRequestsCard")}</h2>
      <p className="text-on-surface-variant font-body-lg mb-section-margin">
        {t("cotisationMembershipRequestsCardBody")}
      </p>
      <AdminMembershipRequestsClient lang={lang} />
    </main>
  );
}
