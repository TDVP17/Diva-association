import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getLang, getTranslator } from "@/lib/i18n/get-lang";
import { FinePayButton } from "./fine-pay-button";

const TONTINE_LABELS: Record<string, string> = {
  HEBDO_SUNDAY: "Weekly Tontine (Sunday)",
  MONTHLY_28: "Monthly Tontine (28th)",
  MONTHLY_25: "Monthly Tontine (25th)",
  BIWEEKLY_SUNDAY: "Every 2 Weeks (Sunday)",
  QUARTERLY_25: "Every 3 Months (25th)",
};

export default async function FinesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const lang = await getLang();
  const t = getTranslator(lang);

  const fines = await prisma.fine.findMany({
    where: { membershipSlot: { membership: { userId: session.user.id } }, status: "UNPAID" },
    include: { membershipSlot: { include: { membership: { include: { tontineSession: true } } } } },
    orderBy: { dueDate: "desc" },
  });

  const total = fines.reduce((sum, f) => sum + Number(f.amount), 0);

  return (
    <main className="px-container-padding py-stack-gap-lg max-w-md mx-auto w-full">
      <h1 className="text-xl md:text-2xl font-bold text-on-surface mb-1">{t("unpaidFines")}</h1>
      <p className="font-numeric-data text-numeric-data text-error mb-stack-gap-lg">
        {total.toLocaleString("en-US")} <span className="font-body-md text-body-md font-normal">F</span>
      </p>

      {fines.length === 0 ? (
        <div className="bg-white rounded-xl p-6 text-center shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant">
          <p className="font-body-md text-body-md text-on-surface-variant">{t("noUnpaidFines")}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-stack-gap-sm">
          {fines.map((f) => {
            const tontineSession = f.membershipSlot.membership.tontineSession;
            const sessionLabel = tontineSession.title || TONTINE_LABELS[tontineSession.type] || tontineSession.type;
            return (
              <div
                key={f.id}
                className="bg-white rounded-xl p-4 shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="font-label-md text-label-md text-on-surface truncate">{sessionLabel}</p>
                  <p className="font-label-sm text-label-sm text-on-surface-variant truncate">
                    {f.membershipSlot.beneficiaryName} ·{" "}
                    {t("fineReasonLatePayment", {
                      date: f.dueDate.toLocaleDateString("en-GB", { timeZone: "Africa/Douala" }),
                    })}
                  </p>
                  <p className="font-numeric-data text-[18px] text-error mt-1">
                    {Number(f.amount).toLocaleString("en-US")} F
                  </p>
                </div>
                <FinePayButton fineId={f.id} lang={lang} />
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
