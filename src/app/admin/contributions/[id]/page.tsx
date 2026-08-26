import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getLang, getTranslator } from "@/lib/i18n/get-lang";
import { ContributionDetailClient } from "./contribution-detail-client";

export default async function ContributionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (session?.user.role !== "ADMIN") redirect("/dashboard");
  const lang = await getLang();
  const t = getTranslator(lang);

  const { id } = await params;
  const exists = await prisma.tontineSession.findUnique({ where: { id }, select: { id: true } });
  if (!exists) {
    return (
      <main className="px-container-padding py-stack-gap-lg max-w-md mx-auto text-center">
        <p className="font-body-md text-body-md text-on-surface-variant mb-stack-gap-md">
          {t("contributionNotFound")}
        </p>
        <Link href="/admin" className="font-label-md text-label-md text-primary underline">
          {t("backToDashboard")}
        </Link>
      </main>
    );
  }

  return <ContributionDetailClient tontineSessionId={id} lang={lang} />;
}
