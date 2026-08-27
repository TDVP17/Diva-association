import { redirect } from "next/navigation";
import Link from "next/link";
import { getLang, getTranslator } from "@/lib/i18n/get-lang";
import { requireAdmin } from "@/lib/require-admin";
import { AdminContributionsClient } from "./admin-contributions-client";

export default async function AdminContributionsPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/admin");
  const lang = await getLang();
  const t = getTranslator(lang);

  return (
    <main className="px-container-padding pt-stack-gap-lg pb-32 max-w-4xl mx-auto w-full">
      <div className="flex justify-between items-end mb-section-margin gap-3 flex-wrap">
        <div>
          <h2 className="font-display-lg text-display-lg text-primary mb-2">{t("myCotisationsCard")}</h2>
          <p className="text-on-surface-variant font-body-lg">{t("myCotisationsCardBody")}</p>
        </div>
        <Link
          href="/admin/sessions/new"
          className="px-3 py-2 rounded-lg bg-primary text-on-primary font-label-sm text-label-sm hover:opacity-90 flex items-center gap-1 flex-shrink-0"
        >
          <span className="material-symbols-outlined text-[16px]">add</span>
          {t("newCotisation")}
        </Link>
      </div>
      <AdminContributionsClient lang={lang} />
    </main>
  );
}
