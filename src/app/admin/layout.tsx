import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getLang } from "@/lib/i18n/get-lang";
import { AdminTopBar } from "@/components/admin/admin-top-bar";
import { AdminSidebar, type AdminNavCounts } from "@/components/admin/admin-sidebar";
import { BackBar } from "@/components/back-bar";
import { AdminBottomNav } from "@/components/admin/admin-bottom-nav";
import { InstallPromptModal } from "@/components/install-prompt-modal";
import { PushPermissionPrompt } from "@/components/push-permission-prompt";
import { NotificationBadgeSync } from "@/components/notification-badge-sync";
import { InactivityAutoLogout } from "@/components/inactivity-auto-logout";
import { isAdminRole } from "@/lib/constants";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) redirect("/dashboard");
  const lang = await getLang();

  const isPresident = session.user.role === "PRESIDENT";

  const [unreadMessages, unreadNotifications, pendingPaymentIssues, pendingMembershipRequests] = await Promise.all([
    prisma.chatMessage.count({
      where: {
        OR: [
          { receiverId: session.user.id },
          { receiver: { role: { in: ["ADMIN", "PRESIDENT"] } } },
        ],
        readAt: null,
      },
    }),
    prisma.notification.count({
      where: { userId: session.user.id, status: { in: ["SENT", "FAILED"] }, readAt: null },
    }),
    prisma.paymentAttempt.count({
      where: { status: { in: ["REFUND_FAILED_MANUAL_REVIEW", "DUPLICATE_PAID"] } },
    }),
    prisma.membership.count({
      where: { status: "PENDING" },
    }),
  ]);

  const counts: AdminNavCounts = {
    support: unreadMessages,
    notifications: unreadNotifications,
    paymentIssues: pendingPaymentIssues,
    membershipRequests: pendingMembershipRequests,
  };

  return (
    <div className="min-h-screen flex flex-col bg-surface-container-lowest">
      <AdminTopBar userId={session.user.id} userName={session.user.name ?? "Admin"} isPresident={isPresident} lang={lang} />
      <AdminSidebar lang={lang} isPresident={isPresident} counts={counts} />
      <div className="flex-1 md:pl-60 pb-24 md:pb-8">
        <BackBar lang={lang} area="admin" />
        {children}
      </div>
      <AdminBottomNav lang={lang} isPresident={isPresident} counts={counts} />
      <InstallPromptModal lang={lang} />
      <PushPermissionPrompt lang={lang} />
      <NotificationBadgeSync />
      <InactivityAutoLogout />
    </div>
  );
}
