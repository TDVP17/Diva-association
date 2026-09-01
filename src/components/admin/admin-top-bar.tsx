import { signOut } from "@/auth";
import { LanguageToggle } from "@/components/language-toggle";
import { NotificationBell } from "@/components/notification-bell";
import { TopRightMenu, type TopRightMenuItem } from "@/components/top-right-menu";
import { translate, type Lang } from "@/lib/i18n/translations";
import { prisma } from "@/lib/prisma";

export async function AdminTopBar({
  userId,
  userName,
  isPresident,
  lang,
}: {
  userId: string;
  userName: string;
  isPresident: boolean;
  lang: Lang;
}) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const [unreadMessages, unreadNotifications] = await Promise.all([
    prisma.chatMessage.count({ where: { receiverId: userId, readAt: null } }),
    prisma.notification.count({ where: { userId, status: { in: ["SENT", "FAILED"] }, readAt: null } }),
  ]);

  const menuItems: TopRightMenuItem[] = [
    { href: "/admin/support", label: t("messages"), icon: "chat_bubble", badge: unreadMessages },
    { href: "/admin/contributions", label: t("contributionsNavItem"), icon: "account_balance" },
    { href: "/admin/sessions/new", label: t("addContributionNav"), icon: "add_circle" },
    { href: "/admin/membership-requests", label: t("joinRequestsNav"), icon: "group_add" },
    { href: "/admin/food-requests", label: t("foodRequestsNav"), icon: "restaurant" },
    { href: "/admin/users", label: t("allUsersCard"), icon: "group" },
  ];

  return (
    <header className="w-full top-0 sticky bg-primary text-on-primary flex items-center justify-between px-container-padding h-16 z-40 shadow-md">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-512.png" alt="DIVA Association" className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg flex-shrink-0" />
        <div className="min-w-0">
          <p className="font-label-md text-label-md sm:font-title-md sm:text-title-md leading-none truncate">
            {translate(lang, "adminBrand")}
          </p>
          <p className="font-label-sm text-label-sm text-on-primary/70 leading-none mt-1 truncate">
            {userName}
            {isPresident ? ` · ${t("presidentBadgeLabel")}` : ""}
          </p>
        </div>
      </div>
      <nav className="flex items-center gap-2 flex-shrink-0">
        <LanguageToggle currentLang={lang} dark />
        <NotificationBell lang={lang} unreadCount={unreadNotifications} href="/admin/notifications" dark />
        <TopRightMenu
          lang={lang}
          items={menuItems}
          dark
          onLogout={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        />
      </nav>
    </header>
  );
}
