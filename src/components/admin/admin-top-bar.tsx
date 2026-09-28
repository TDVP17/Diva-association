import Link from "next/link";
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
  const [unreadMessages, unreadNotifications, pendingMemberships, pendingFoodRequests] = await Promise.all([
    prisma.chatMessage.count({
      where: {
        OR: [
          { receiverId: userId },
          { receiver: { role: { in: ["ADMIN", "PRESIDENT"] } } },
        ],
        readAt: null,
      },
    }),
    prisma.notification.count({ where: { userId, status: { in: ["SENT", "FAILED"] }, readAt: null } }),
    prisma.membership.count({ where: { status: "PENDING" } }),
    prisma.payout.count({ where: { status: { not: "CONFIRMED" } } }),
  ]);

  const menuItems: TopRightMenuItem[] = [
    { href: "/admin/support", label: t("messages"), icon: "chat_bubble", badge: unreadMessages },
    { href: "/admin/contributions", label: t("contributionsNavItem"), icon: "account_balance" },
    { href: "/admin/sessions/new", label: t("addContributionNav"), icon: "add_circle" },
    { href: "/admin/membership-requests", label: t("joinRequestsNav"), icon: "group_add", badge: pendingMemberships },
    { href: "/admin/food-requests", label: t("foodRequestsNav"), icon: "restaurant", badge: pendingFoodRequests },
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
      <nav className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
        <LanguageToggle currentLang={lang} dark />
        <Link
          href="/admin/support"
          aria-label={t("messages")}
          className="relative w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
        >
          <span className="material-symbols-outlined text-on-primary">support_agent</span>
          {unreadMessages > 0 && (
            <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 bg-error text-on-error rounded-full font-label-sm text-[10px] font-bold flex items-center justify-center leading-none">
              {unreadMessages}
            </span>
          )}
        </Link>
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
