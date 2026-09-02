import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getLang, getTranslator } from "@/lib/i18n/get-lang";
import { listUnpaidSlotsForBulkPayment } from "@/lib/initiate-bulk-payment";
import { GlobalPaymentForm } from "./global-payment-form";

export default async function GlobalPaymentPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const lang = await getLang();
  const t = getTranslator(lang);

  const [slots, user] = await Promise.all([
    listUnpaidSlotsForBulkPayment(session.user.id),
    prisma.user.findUnique({ where: { id: session.user.id }, select: { phone: true } }),
  ]);

  return (
    <main className="px-container-padding py-stack-gap-lg max-w-3xl lg:max-w-6xl mx-auto w-full flex flex-col gap-stack-gap-md">
      <div>
        <h1 className="font-title-md text-title-md text-primary">{t("globalPaymentTitle")}</h1>
        <p className="font-body-md text-body-md text-on-surface-variant mt-1">{t("globalPaymentSubtitle")}</p>
      </div>

      {slots.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant flex flex-col items-center gap-stack-gap-sm">
          <span className="material-symbols-outlined text-outline text-[40px]">task_alt</span>
          <p className="font-body-md text-body-md text-on-surface-variant">{t("globalPaymentNoUnpaidSlots")}</p>
        </div>
      ) : (
        <GlobalPaymentForm slots={slots} defaultPhone={user?.phone ?? null} lang={lang} />
      )}
    </main>
  );
}
