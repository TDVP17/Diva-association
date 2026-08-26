import { prisma } from "@/lib/prisma";
import { getLang, getTranslator } from "@/lib/i18n/get-lang";

const TONTINE_LABELS: Record<string, string> = {
  HEBDO_SUNDAY: "Weekly Tontine",
  MONTHLY_28: "Monthly Tontine (28th)",
  MONTHLY_25: "Monthly Tontine (25th)",
};

export default async function AdminAnalyticsPage() {
  const t = getTranslator(await getLang());

  const sessions = await prisma.tontineSession.findMany({
    select: {
      id: true,
      title: true,
      type: true,
      memberships: {
        select: {
          slots: {
            select: {
              contributions: { where: { status: "PAID" }, select: { feePaid: true } },
              fines: { where: { status: { in: ["PAID", "DEDUCTED"] } }, select: { amount: true } },
            },
          },
        },
      },
    },
    orderBy: { startDate: "desc" },
  });

  const perSession = sessions.map((s) => {
    const slots = s.memberships.flatMap((m) => m.slots);
    const fees = slots.reduce(
      (sum, slot) => sum + slot.contributions.reduce((a, c) => a + Number(c.feePaid), 0),
      0,
    );
    const fines = slots.reduce((sum, slot) => sum + slot.fines.reduce((a, f) => a + Number(f.amount), 0), 0);
    return {
      id: s.id,
      title: s.title || TONTINE_LABELS[s.type] || s.type,
      fees,
      fines,
      total: fees + fines,
    };
  });

  const totalFees = perSession.reduce((sum, s) => sum + s.fees, 0);
  const totalFines = perSession.reduce((sum, s) => sum + s.fines, 0);
  const totalRevenue = totalFees + totalFines;

  return (
    <main className="px-container-padding pt-stack-gap-lg pb-32 max-w-4xl mx-auto w-full flex flex-col gap-section-margin">
      <div>
        <h2 className="font-display-lg text-display-lg text-primary">{t("revenueAnalytics")}</h2>
        <p className="text-on-surface-variant font-body-lg mt-2">{t("revenueAnalyticsSubtitle")}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-stack-gap-md">
        <div className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-4">
          <p className="font-label-sm text-label-sm text-on-surface-variant">{t("totalServiceFees")}</p>
          <p className="font-numeric-data text-numeric-data text-on-surface mt-1">
            {totalFees.toLocaleString("en-US")} F
          </p>
        </div>
        <div className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-4">
          <p className="font-label-sm text-label-sm text-on-surface-variant">{t("totalFinesCollected")}</p>
          <p className="font-numeric-data text-numeric-data text-on-surface mt-1">
            {totalFines.toLocaleString("en-US")} F
          </p>
        </div>
        <div className="bg-primary text-on-primary rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] p-4">
          <p className="font-label-sm text-label-sm text-primary-fixed-dim">{t("totalAdminRevenue")}</p>
          <p className="font-numeric-data text-numeric-data text-white mt-1">
            {totalRevenue.toLocaleString("en-US")} F
          </p>
        </div>
      </div>

      <section>
        <h3 className="font-title-md text-title-md text-primary mb-stack-gap-md">{t("perCotisationBreakdown")}</h3>
        {perSession.length === 0 ? (
          <p className="font-label-sm text-label-sm text-on-surface-variant">{t("noRevenueYet")}</p>
        ) : (
          <div className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant overflow-x-auto">
            <table className="w-full text-left min-w-[480px]">
              <thead>
                <tr className="border-b border-surface-variant">
                  <th className="p-3 font-label-sm text-label-sm text-on-surface-variant">{t("title")}</th>
                  <th className="p-3 font-label-sm text-label-sm text-on-surface-variant">{t("totalServiceFees")}</th>
                  <th className="p-3 font-label-sm text-label-sm text-on-surface-variant">
                    {t("totalFinesCollected")}
                  </th>
                  <th className="p-3 font-label-sm text-label-sm text-on-surface-variant">
                    {t("totalAdminRevenue")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {perSession.map((s) => (
                  <tr key={s.id} className="border-b last:border-b-0 border-surface-variant">
                    <td className="p-3 font-label-md text-label-md text-on-surface">{s.title}</td>
                    <td className="p-3 font-numeric-data text-[14px] text-on-surface">
                      {s.fees.toLocaleString("en-US")} F
                    </td>
                    <td className="p-3 font-numeric-data text-[14px] text-on-surface">
                      {s.fines.toLocaleString("en-US")} F
                    </td>
                    <td className="p-3 font-numeric-data text-[14px] text-primary">
                      {s.total.toLocaleString("en-US")} F
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
