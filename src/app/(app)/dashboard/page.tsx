import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getLang } from "@/lib/i18n/get-lang";
import { getDashboardData } from "@/lib/dashboard";
import { DashboardClient } from "@/components/dashboard/dashboard-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const lang = await getLang();
  const resolvedParams = searchParams ? await searchParams : {};
  const isAccessDenied = resolvedParams.error === "access_denied";

  const dashboardData = await getDashboardData(userId, lang);

  return (
    <main className="px-container-padding pt-stack-gap-md pb-24 max-w-xl mx-auto w-full">
      <DashboardClient
        data={dashboardData}
        lang={lang}
        accessDeniedError={isAccessDenied}
      />
    </main>
  );
}
