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
  const t = getTranslator(await getLang());

  const slots = await prisma.membershipSlot.findMany({
    where: { membership: { userId: session.user.id } },
    include: {
      contributions: { orderBy: { dueDate: "desc" }, include: { paidByUser: { select: { name: true } } } },
      fines: { orderBy: { dueDate: "desc" } },
      membership: { include: { tontineSession: true } },
    },
  });

  const rows: Row[] = [];
  for (const slot of slots) {
    const sessionLabel =
      slot.membership.tontineSession.title || TONTINE_LABELS[slot.membership.tontineSession.type];
    for (const c of slot.contributions) {
      rows.push({
        kind: "contribution",
        id: c.id,
        dueDate: c.dueDate,
        amount: Number(c.amountPaid) + Number(c.feePaid) + Number(c.finePaid),
        status: c.status,
        sessionLabel,
        beneficiaryName: slot.beneficiaryName,
        paidByName: c.paidByUser?.name ?? null,
      });
    }
    for (const f of slot.fines) {
      rows.push({
        kind: "fine",
        id: f.id,
        dueDate: f.dueDate,
        amount: Number(f.amount),
        status: f.status,
        sessionLabel,
        beneficiaryName: slot.beneficiaryName,
        paidByName: null,
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
              className={`flex items-center justify-between p-4 ${i < rows.length - 1 ? "border-b border-surface-variant" : ""}`}
            >
              <div className="min-w-0">
                <p className="font-label-md text-label-md text-on-surface truncate">
                  {r.kind === "contribution" ? t("contributionLabel") : t("fineLabel")} — {r.sessionLabel}
                </p>
                <p className="font-label-sm text-label-sm text-on-surface-variant">
                  {r.beneficiaryName} · {r.dueDate.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })}
                  {r.paidByName && ` · ${t("paidByLabel")} ${r.paidByName}`}
                </p>
              </div>
              <div className="text-right flex-shrink-0 ml-3">
                <p className="font-numeric-data text-numeric-data text-on-surface">
                  {r.amount.toLocaleString("en-US")} F
                </p>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-md font-label-sm text-label-sm ${STATUS_CLASS[r.status] ?? ""}`}
                >
                  {r.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
