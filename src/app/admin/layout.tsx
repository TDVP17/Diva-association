import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getLang } from "@/lib/i18n/get-lang";
import { AdminTopBar } from "@/components/admin/admin-top-bar";
import { IosInstallBanner } from "@/components/ios-install-banner";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (session?.user.role !== "ADMIN") redirect("/dashboard");
  const lang = await getLang();

  return (
    <div className="min-h-screen flex flex-col bg-surface-container-lowest">
      <AdminTopBar userName={session.user.name ?? "Admin"} lang={lang} />
      <div className="flex-1">{children}</div>
      <IosInstallBanner lang={lang} />
    </div>
  );
}
