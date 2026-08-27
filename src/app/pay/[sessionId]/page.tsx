import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getNextDueDate } from "@/lib/tontine-engine";
import { getLang, getTranslator } from "@/lib/i18n/get-lang";
import { LanguageToggle } from "@/components/language-toggle";
import { PublicPayForm } from "./public-pay-form";

const TONTINE_LABELS: Record<string, string> = {
  HEBDO_SUNDAY: "Weekly Tontine (Sunday)",
  MONTHLY_28: "Monthly Tontine (28th)",
  MONTHLY_25: "Monthly Tontine (25th)",
};

export default async function PublicPayPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const lang = await getLang();
  const t = getTranslator(lang);

  const tontineSession = await prisma.tontineSession.findUnique({ where: { id: sessionId } });
  if (!tontineSession) notFound();

  const dueDate = getNextDueDate(tontineSession.type, new Date());
  const slots = await prisma.membershipSlot.findMany({
    where: { membership: { tontineSessionId: sessionId, status: "APPROVED" } },
    select: {
      id: true,
      beneficiaryName: true,
      contributions: { where: { dueDate }, select: { status: true } },
    },
  });
  const unpaidSlots = slots
    .filter((s) => s.contributions[0]?.status !== "PAID")
    .map((s) => ({ id: s.id, beneficiaryName: s.beneficiaryName }));

  const sessionLabel = tontineSession.title || TONTINE_LABELS[tontineSession.type];

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-container-padding bg-background">
      <div className="w-full max-w-sm">
        <div className="flex justify-end mb-2">
          <LanguageToggle currentLang={lang} />
        </div>
        <div className="text-center mb-stack-gap-lg">
          <span className="font-headline-lg text-headline-lg text-primary tracking-tight">DIVA Association</span>
          <h1 className="font-title-md text-title-md text-on-surface mt-2">{t("contributeForMember")}</h1>
          <p className="font-body-md text-body-md text-on-surface-variant mt-1">{sessionLabel}</p>
        </div>
        <PublicPayForm initialUnpaidSlots={unpaidSlots} lang={lang} />
      </div>
    </main>
  );
}
