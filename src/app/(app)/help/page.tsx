import Link from "next/link";
import { getLang, getTranslator } from "@/lib/i18n/get-lang";

const FAQ_KEYS = [
  ["helpQ1", "helpA1"],
  ["helpQ2", "helpA2"],
  ["helpQ3", "helpA3"],
  ["helpQ4", "helpA4"],
  ["helpQ5", "helpA5"],
] as const;

export default async function HelpPage() {
  const t = getTranslator(await getLang());

  return (
    <main className="px-container-padding py-stack-gap-lg max-w-3xl lg:max-w-4xl mx-auto w-full">
      <h1 className="font-title-md text-title-md text-primary mb-stack-gap-md">{t("helpCenterTitle")}</h1>

      <div className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant overflow-hidden mb-stack-gap-lg">
        {FAQ_KEYS.map(([qKey, aKey], i) => (
          <details
            key={qKey}
            className={`group px-4 py-3 ${i < FAQ_KEYS.length - 1 ? "border-b border-surface-variant" : ""}`}
          >
            <summary className="font-label-md text-label-md text-on-surface cursor-pointer list-none flex items-center justify-between gap-2">
              {t(qKey)}
              <span className="material-symbols-outlined text-outline transition-transform group-open:rotate-180">
                expand_more
              </span>
            </summary>
            <p className="font-body-md text-body-md text-on-surface-variant mt-2">{t(aKey)}</p>
          </details>
        ))}
      </div>

      <Link
        href="/chat?tab=admin"
        className="w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 active:scale-95 transition-all"
      >
        <span className="material-symbols-outlined text-[20px]">support_agent</span>
        {t("contactAdminSupport")}
      </Link>
    </main>
  );
}
