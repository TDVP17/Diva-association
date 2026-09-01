import { redirect } from "next/navigation";
import { getLang, getTranslator } from "@/lib/i18n/get-lang";
import { requirePresident } from "@/lib/require-admin";
import { getRevenueAnalytics } from "@/lib/analytics";
import { formatXAF } from "@/lib/format-currency";

export default async function AdminAnalyticsPage() {
  const president = await requirePresident();
  if (!president) redirect("/admin");
  const t = getTranslator(await getLang());

  const { totalFees, totalFines, totalGrossReceived, totalPresidentFeeShare, totalUnpaidFines, totalSuccessfulPayments, totalPendingPayments, sessions: perSession } =
    await getRevenueAnalytics();

  return (
    <main className="px-container-padding pt-stack-gap-lg pb-32 max-w-4xl mx-auto w-full flex flex-col gap-section-margin">
      <div>
        <h2 className="font-headline-lg-mobile text-headline-lg-mobile md:font-headline-lg md:text-headline-lg text-primary">
          {t("revenueAnalytics")}
        </h2>
        <p className="text-on-surface-variant font-body-lg mt-2">{t("revenueAnalyticsSubtitle")}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-stack-gap-md">
        <div className="bg-primary text-on-primary rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] p-4">
          <p className="font-label-sm text-label-sm text-primary-fixed-dim">{t("totalMoneyReceived")}</p>
          <p className="font-numeric-data text-numeric-data text-white mt-1">
            {formatXAF(totalGrossReceived)}
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-4">
          <p className="font-label-sm text-label-sm text-on-surface-variant">{t("totalServiceFees")}</p>
          <p className="font-numeric-data text-numeric-data text-on-surface mt-1">
            {formatXAF(totalFees)}
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-4">
          <p className="font-label-sm text-label-sm text-on-surface-variant">{t("presidentFeeShareLabel")}</p>
          <p className="font-numeric-data text-numeric-data text-on-surface mt-1">
            {formatXAF(totalPresidentFeeShare)}
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-4">
          <p className="font-label-sm text-label-sm text-on-surface-variant">{t("totalFinesCollected")}</p>
          <p className="font-numeric-data text-numeric-data text-on-surface mt-1">
            {formatXAF(totalFines)}
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-4">
          <p className="font-label-sm text-label-sm text-on-surface-variant">{t("unpaidFines")}</p>
          <p className="font-numeric-data text-numeric-data text-error mt-1">
            {formatXAF(totalUnpaidFines)}
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-4">
          <p className="font-label-sm text-label-sm text-on-surface-variant">{t("successfulPaymentsLabel")}</p>
          <p className="font-numeric-data text-numeric-data text-on-surface mt-1">{totalSuccessfulPayments}</p>
        </div>
        <div className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-4">
          <p className="font-label-sm text-label-sm text-on-surface-variant">{t("pendingPaymentsLabel")}</p>
          <p className="font-numeric-data text-numeric-data text-on-surface mt-1">{totalPendingPayments}</p>
        </div>
      </div>

      <section>
        <h3 className="font-title-md text-title-md text-primary mb-stack-gap-md">{t("perCotisationBreakdown")}</h3>
        {perSession.length === 0 ? (
          <p className="font-label-sm text-label-sm text-on-surface-variant">{t("noRevenueYet")}</p>
        ) : (
          <div className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant overflow-x-auto">
            <table className="w-full text-left min-w-[640px]">
              <thead>
                <tr className="border-b border-surface-variant">
                  <th className="p-3 font-label-sm text-label-sm text-on-surface-variant">{t("title")}</th>
                  <th className="p-3 font-label-sm text-label-sm text-on-surface-variant">{t("totalMoneyReceived")}</th>
                  <th className="p-3 font-label-sm text-label-sm text-on-surface-variant">{t("totalServiceFees")}</th>
                  <th className="p-3 font-label-sm text-label-sm text-on-surface-variant">{t("presidentFeeShareLabel")}</th>
                  <th className="p-3 font-label-sm text-label-sm text-on-surface-variant">
                    {t("totalFinesCollected")}
                  </th>
                  <th className="p-3 font-label-sm text-label-sm text-on-surface-variant">{t("unpaidFines")}</th>
                </tr>
              </thead>
              <tbody>
                {perSession.map((s) => (
                  <tr key={s.id} className="border-b last:border-b-0 border-surface-variant">
                    <td className="p-3 font-label-md text-label-md text-on-surface">{s.title}</td>
                    <td className="p-3 font-numeric-data text-[14px] text-primary">
                      {formatXAF(s.grossReceived)}
                    </td>
                    <td className="p-3 font-numeric-data text-[14px] text-on-surface">
                      {formatXAF(s.fees)}
                    </td>
                    <td className="p-3 font-numeric-data text-[14px] text-on-surface">
                      {formatXAF(s.presidentFeeShare)}
                    </td>
                    <td className="p-3 font-numeric-data text-[14px] text-on-surface">
                      {formatXAF(s.fines)}
                    </td>
                    <td className="p-3 font-numeric-data text-[14px] text-error">
                      {formatXAF(s.unpaidFines)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
