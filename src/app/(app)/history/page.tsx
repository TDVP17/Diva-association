import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getLang, getTranslator } from "@/lib/i18n/get-lang";

const TONTINE_LABELS: Record<string, string> = {
  HEBDO_SUNDAY: "Weekly Tontine (Sunday)",
  MONTHLY_28: "Monthly Tontine (28th)",
  MONTHLY_25: "Monthly Tontine (25th)",
};

interface Row {
  kind: "contribution" | "fine";
  id: string;
  dueDate: Date;
  amount: number;
  status: string;
  sessionLabel: string;
  beneficiaryName: string;
  paidByName: string | null;
  receiptPdfUrl: string | null;
}

const STATUS_CLASS: Record<string, string> = {
  PAID: "bg-[#d1fae5] text-[#065f46]",
  LATE: "bg-error-container text-on-error-container",
  PENDING: "bg-secondary-fixed text-on-secondary-fixed-variant",
  UNPAID: "bg-error-container text-on-error-container",
  DEDUCTED: "bg-secondary-fixed text-on-secondary-fixed-variant",
};

export default async function HistoryPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const lang = await getLang();
  const t = getTranslator(lang);

  const [slots, archives] = await Promise.all([
    prisma.membershipSlot.findMany({
      where: { membership: { userId: session.user.id } },
      include: {
        contributions: { orderBy: { dueDate: "desc" }, include: { paidByUser: { select: { name: true } } } },
        fines: { orderBy: { dueDate: "desc" } },
        membership: { include: { tontineSession: true } },
      },
    }),
    prisma.transactionArchive.findMany({
      where: { userId: session.user.id },
      orderBy: { periodStart: "desc" },
    }),
  ]);

  function isArchived(date: Date): boolean {
    return archives.some((a) => date >= a.periodStart && date <= a.periodEnd);
  }

  const rows: Row[] = [];
  for (const slot of slots) {
    const sessionLabel =
      slot.membership.tontineSession.title || TONTINE_LABELS[slot.membership.tontineSession.type];
    for (const c of slot.contributions) {
      if (isArchived(c.dueDate)) continue;
      rows.push({
        kind: "contribution",
        id: c.id,
        dueDate: c.dueDate,
        amount: Number(c.amountPaid) + Number(c.feePaid) + Number(c.finePaid),
        status: c.status,
        sessionLabel,
        beneficiaryName: slot.beneficiaryName,
        paidByName: c.paidByUser?.name ?? null,
        receiptPdfUrl: c.status === "PAID" ? c.receiptPdfUrl : null,
      });
    }
    for (const f of slot.fines) {
      if (isArchived(f.dueDate)) continue;
      rows.push({
        kind: "fine",
        id: f.id,
        dueDate: f.dueDate,
        amount: Number(f.amount),
        status: f.status,
        sessionLabel,
        beneficiaryName: slot.beneficiaryName,
        paidByName: null,
        receiptPdfUrl: null,
      });
    }
  }
  rows.sort((a, b) => b.dueDate.getTime() - a.dueDate.getTime());

  return (
    <main className="px-container-padding py-stack-gap-lg max-w-3xl lg:max-w-4xl mx-auto w-full">
      <h1 className="font-title-md text-title-md text-primary mb-stack-gap-md">{t("transactionHistory")}</h1>

      {rows.length === 0 ? (
        <div className="bg-white rounded-xl p-6 text-center shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant">
          <p className="font-body-md text-body-md text-on-surface-variant">{t("noTransactionsYet")}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant overflow-hidden">
          {rows.map((r, i) => (
            <div
              key={`${r.kind}-${r.id}`}
              className={`flex items-center gap-2 px-3 py-2.5 sm:px-4 ${i < rows.length - 1 ? "border-b border-surface-variant" : ""}`}
            >
              <div className="min-w-0 flex-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                <span className="font-label-sm text-label-sm sm:font-label-md sm:text-label-md text-on-surface truncate">
                  {r.kind === "contribution" ? t("contributionLabel") : t("fineLabel")} – {r.sessionLabel}
                </span>
                <span className="font-numeric-data text-[13px] sm:text-numeric-data text-on-surface">
                  {r.amount.toLocaleString("en-US")} F
                </span>
                <span className="font-label-sm text-label-sm text-on-surface-variant">
                  {r.dueDate.toLocaleDateString("en-GB", { timeZone: "Africa/Douala" })}
                </span>
                {r.paidByName && (
                  <span className="font-label-sm text-label-sm text-on-surface-variant">
                    · {t("paidByLabel")} {r.paidByName}
                  </span>
                )}
              </div>
              <span
                className={`flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded-md font-label-sm text-label-sm ${STATUS_CLASS[r.status] ?? ""}`}
              >
                {r.status}
              </span>
              {r.receiptPdfUrl && (
                <a
                  href={`/api/files/${r.receiptPdfUrl}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={t("downloadReceiptPdf")}
                  className="flex-shrink-0 p-1.5 rounded-full text-primary hover:bg-primary/10 transition-colors"
                >
                  <span className="material-symbols-outlined text-[20px]">download</span>
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {archives.length > 0 && (
        <section className="mt-section-margin">
          <h2 className="font-title-sm text-title-sm text-primary mb-stack-gap-md">{t("archivedHistoryTitle")}</h2>
          <div className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant overflow-hidden">
            {archives.map((a, i) => (
              <div
                key={a.id}
                className={`flex items-center justify-between gap-2 px-4 py-3 ${i < archives.length - 1 ? "border-b border-surface-variant" : ""}`}
              >
                <span className="font-label-md text-label-md text-on-surface">
                  {a.periodStart.getUTCFullYear()}
                </span>
                <a
                  href={`/api/files/${a.pdfUrl}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 font-label-sm text-label-sm text-primary underline"
                >
                  <span className="material-symbols-outlined text-[18px]">download</span>
                  {t("downloadReceiptPdf")}
                </a>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
