import Link from "next/link";
import { translate, type Lang } from "@/lib/i18n/translations";

export function NotificationBell({
  lang,
  unreadCount,
  href = "/notifications",
  dark,
}: {
  lang: Lang;
  unreadCount: number;
  href?: string;
  dark?: boolean;
}) {
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);

  return (
    <Link
      href={href}
      aria-label={t("myNotificationsNav")}
      className={`relative w-10 h-10 flex items-center justify-center rounded-full transition-colors ${
        dark ? "hover:bg-white/10" : "hover:bg-surface-container-low"
      }`}
    >
      <span className={`material-symbols-outlined text-[24px] ${dark ? "text-on-primary" : "text-on-surface"}`}>
        notifications
      </span>
      {unreadCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white font-bold text-[10px] leading-none shadow-sm ring-2 ring-white">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </Link>
  );
}
