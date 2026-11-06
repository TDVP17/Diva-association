import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { isAdminRole } from "@/lib/constants";
import { getLang } from "@/lib/i18n/get-lang";
import { SecurityDashboardClient } from "./security-dashboard-client";

export default async function AdminSecurityPage() {
  const session = await auth();
  if (!isAdminRole(session?.user?.role)) {
    redirect("/dashboard");
  }

  const lang = await getLang();

  return (
    <main className="px-container-padding py-stack-gap-lg max-w-6xl mx-auto w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-[32px]">shield</span>
          Sécurité & Verrouillage d'Urgence
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          Surveillance anti-brute-force, détection d'intrusions et contrôle du bouton panique en temps réel.
        </p>
      </div>

      <SecurityDashboardClient lang={lang} />
    </main>
  );
}
