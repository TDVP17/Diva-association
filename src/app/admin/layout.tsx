import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getLang } from "@/lib/i18n/get-lang";
import { AdminTopBar } from "@/components/admin/admin-top-bar";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { BackBar } from "@/components/back-bar";
import { AdminBottomNav } from "@/components/admin/admin-bottom-nav";
import { IosInstallBanner } from "@/components/ios-install-banner";
import { NotificationBadgeSync } from "@/components/notification-badge-sync";
import { isAdminRole } from "@/lib/constants";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) redirect("/dashboard");
  const lang = await getLang();

  const isPresident = session.user.role === "PRESIDENT";

  return (
    <div className="min-h-screen flex flex-col bg-surface-container-lowest">
      <AdminTopBar userId={session.user.id} userName={session.user.name ?? "Admin"} isPresident={isPresident} lang={lang} />
      <AdminSidebar lang={lang} isPresident={isPresident} />
      <div className="flex-1 md:pl-60 pb-24 md:pb-8">
        <BackBar lang={lang} area="admin" />
        {children}
      </div>
      <AdminBottomNav lang={lang} isPresident={isPresident} />
      <IosInstallBanner lang={lang} />
      <NotificationBadgeSync />
    </div>
  );
}
