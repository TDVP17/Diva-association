import { translate, type Lang } from "@/lib/i18n/translations";

interface Props {
  lang: Lang;
  beneficiaryName: string;
  sessionLabel: string;
  amount: number;
  paidByName: string;
  date: string;
  time: string;
  transRef: string;
  receiptUrl: string | null;
}

export function PaymentSuccessBanner({
  lang,
  beneficiaryName,
  sessionLabel,
  amount,
  paidByName,
  date,
  time,
  transRef,
  receiptUrl,
}: Props) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);

  return (
    <section className="mb-stack-gap-lg bg-white rounded-xl p-5 shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border-2 border-[#a7f3d0]">
      <div className="text-center mb-4">
        <span className="text-3xl">🎉</span>
        <h2 className="font-title-md text-title-md text-[#065f46] mt-1">{t("paymentSuccessfulTitle")}</h2>
      </div>
      <div className="flex flex-col gap-2">
        <Row label={t("contributedForLabel")} value={beneficiaryName} />
        <Row label={t("contributionLabel")} value={sessionLabel} />
        <Row label={t("amountLabel")} value={`${amount.toLocaleString("en-US")} F`} />
        <Row label={t("paidByLabel")} value={paidByName} />
        <Row label={t("dateLabelShort")} value={date} />
        <Row label={t("timeLabel")} value={time} />
        <Row label={t("transactionIdLabel")} value={transRef} />
      </div>
      {receiptUrl && (
        <a
          href={receiptUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-4 w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:opacity-90 active:scale-95 transition-all"
        >
          <span className="material-symbols-outlined text-[18px]">download</span>
          {t("downloadReceiptPdf")}
        </a>
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center gap-3">
      <span className="font-label-sm text-label-sm text-on-surface-variant">{label}</span>
      <span className="font-label-md text-label-md text-on-surface text-right">{value}</span>
    </div>
  );
}
