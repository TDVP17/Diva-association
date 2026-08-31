import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getLang, getTranslator } from "@/lib/i18n/get-lang";
import { getAssociationRules } from "@/lib/association-rules";

export default async function GeneralRulesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const lang = await getLang();
  const t = getTranslator(lang);

  const content = await getAssociationRules();

  return (
    <main className="px-container-padding py-stack-gap-lg max-w-2xl mx-auto w-full">
      <h1 className="text-xl md:text-2xl font-bold text-on-surface mb-stack-gap-md">{t("rulesTitle")}</h1>
      <div className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-5">
        {content ? (
          <p className="font-body-md text-body-md text-on-surface whitespace-pre-wrap">{content}</p>
        ) : (
          <p className="font-body-md text-body-md text-on-surface-variant">{t("noRulesYet")}</p>
        )}
      </div>
    </main>
  );
}
