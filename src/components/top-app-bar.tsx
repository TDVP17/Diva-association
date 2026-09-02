import Link from "next/link";
import { signOut } from "@/auth";
import { LanguageToggle } from "@/components/language-toggle";
import { NotificationBell } from "@/components/notification-bell";
import { TopRightMenu, type TopRightMenuItem } from "@/components/top-right-menu";
import { translate, type Lang } from "@/lib/i18n/translations";
import { prisma } from "@/lib/prisma";
import { getInitials } from "@/lib/initials";

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
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);
  const [unreadMessages, unreadNotifications] = await Promise.all([
    prisma.chatMessage.count({ where: { receiverId: userId, readAt: null } }),
    prisma.notification.count({ where: { userId, status: { in: ["SENT", "FAILED"] }, readAt: null } }),
  ]);

  const menuItems: TopRightMenuItem[] = [
    { href: "/chat", label: t("messages"), icon: "chat_bubble", badge: unreadMessages },
    { href: "/sessions", label: t("contributionsNavItem"), icon: "account_balance" },
    { href: "/contribute-for-relative", label: t("contributeForRelativeNav"), icon: "volunteer_activism" },
  ];

  return (
    <header className="w-full top-0 sticky shadow-sm bg-surface flex items-center justify-between px-container-padding h-16 z-40 shadow-[0px_4px_20px_rgba(30,41,59,0.05)]">
      <Link href="/profile" className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 rounded-full border-2 border-secondary-fixed-dim overflow-hidden bg-primary-container flex items-center justify-center flex-shrink-0">
          {userImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={userImage} alt={userName} className="w-full h-full object-cover" />
          ) : (
            <span className="font-label-md text-label-md text-primary">{getInitials(userName)}</span>
          )}
        </div>
        <span className="font-title-md text-title-md text-primary hidden sm:block truncate">{userName}</span>
      </Link>
      <Link href="/dashboard" className="flex items-center gap-1.5 sm:hidden min-w-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-512.png" alt="" className="w-9 h-9 rounded-lg flex-shrink-0" />
        <span className="flex flex-col leading-[1.05] min-w-0">
          <span className="font-label-md text-label-md font-bold text-primary tracking-tight truncate">DIVA</span>
          <span className="font-label-sm text-label-sm font-bold text-secondary tracking-tight truncate">
            Association
          </span>
        </span>
      </Link>
      <div className="flex items-center gap-1 flex-shrink-0">
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
