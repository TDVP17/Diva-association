import Link from "next/link";
import { signOut } from "@/auth";
import { LanguageToggle } from "@/components/language-toggle";
import { QuickSearch } from "@/components/quick-search";
import { NotificationBell } from "@/components/notification-bell";
import { TopRightMenu, type TopRightMenuItem } from "@/components/top-right-menu";
import { translate, type Lang } from "@/lib/i18n/translations";
import { prisma } from "@/lib/prisma";
import { getInitials } from "@/lib/initials";

import { getUnreadInAppNotificationCount } from "@/lib/notifications/unread";

export async function TopAppBar({
  userId,
  userName,
  userImage,
  lang,
}: {
  userId: string;
  userName: string;
  userImage: string | null;
  lang: Lang;
}) {
  const [unreadMessages, unreadNotifications, unpaidFines, pendingCotisations] = await Promise.all([
    prisma.chatMessage.count({ where: { receiverId: userId, readAt: null } }),
    getUnreadInAppNotificationCount(userId),
    prisma.fine.count({ where: { membershipSlot: { membership: { userId } }, status: "UNPAID" } }),
    prisma.membership.count({ where: { userId, status: "APPROVED", slotCount: null } }),
  ]);

  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);

  const menuItems: TopRightMenuItem[] = [
    { href: "/fines", label: t("finesNavItem"), icon: "receipt_long", badge: unpaidFines || undefined },
    { href: "/sessions", label: t("contributionsNavItem"), icon: "account_balance", badge: pendingCotisations || undefined },
    { href: "/contribute-for-relative", label: t("contributeForRelativeNav"), icon: "volunteer_activism" },
    { href: "/chat", label: t("customerSupport"), icon: "chat", badge: unreadMessages || undefined },
  ];

  return (
    <header className="w-full top-0 sticky bg-surface flex items-center justify-between px-container-padding h-16 z-40 border-b border-outline-variant/30">
      {/* Profile avatar + User Name in Brand Green */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <Link href="/profile" className="flex-shrink-0" aria-label="Profil">
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-full border-2 border-secondary-fixed-dim overflow-hidden bg-primary-container flex items-center justify-center hover:opacity-90 transition-opacity">
            {userImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={userImage} alt={userName} className="w-full h-full object-cover" />
            ) : (
              <span className="font-label-md text-label-md text-primary">{getInitials(userName)}</span>
            )}
          </div>
        </Link>
        <Link href="/profile" className="flex items-center min-w-0 group" aria-label={userName}>
          <span className="font-title-md font-extrabold text-[#025b34] truncate tracking-tight group-hover:underline">
            {userName}
          </span>
        </Link>
      </div>
      <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0">
        <QuickSearch lang={lang} />
        <LanguageToggle currentLang={lang} />
        <NotificationBell lang={lang} unreadCount={unreadNotifications} />
        <TopRightMenu
          lang={lang}
          items={menuItems}
          onLogout={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        />
      </div>
    </header>
  );
}
