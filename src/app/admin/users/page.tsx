import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/require-admin";
import { getLang, getTranslator } from "@/lib/i18n/get-lang";
import { AdminUsersClient } from "./admin-users-client";

export default async function AdminUsersPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/admin");
  const lang = await getLang();
  const t = getTranslator(lang);

  return (
    <main className="px-container-padding pt-stack-gap-lg pb-32 max-w-4xl mx-auto w-full">
      <h2 className="font-headline-lg-mobile text-headline-lg-mobile md:font-headline-lg md:text-headline-lg text-primary mb-2">
        {t("allUsersCard")}
      </h2>
      <p className="text-on-surface-variant font-body-lg mb-section-margin">{t("allUsersCardBody")}</p>
      <AdminUsersClient lang={lang} />
    </main>
  );
}
