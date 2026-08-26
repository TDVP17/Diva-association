import Link from "next/link";
import { LanguageToggle } from "@/components/language-toggle";
import type { Lang } from "@/lib/i18n/translations";

export function TopAppBar({
  userName,
  userImage,
  lang,
}: {
  userName: string;
  userImage: string | null;
  lang: Lang;
}) {
  return (
    <header className="w-full top-0 sticky shadow-sm bg-surface flex items-center justify-between px-container-padding h-16 z-40 shadow-[0px_4px_20px_rgba(30,41,59,0.05)]">
      <Link href="/profile" className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 rounded-full border-2 border-secondary-fixed-dim overflow-hidden bg-surface-variant flex items-center justify-center flex-shrink-0">
          {userImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={userImage} alt={userName} className="w-full h-full object-cover" />
          ) : (
            <span className="material-symbols-outlined text-outline">person</span>
          )}
        </div>
        <span className="font-title-md text-title-md text-primary hidden sm:block truncate">{userName}</span>
      </Link>
      <Link href="/dashboard" className="flex items-center gap-2 sm:hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-512.png" alt="DIVA Associations" className="w-8 h-8 rounded-lg" />
        <span className="font-headline-lg-mobile text-headline-lg-mobile font-bold text-primary tracking-tight">
          DIVA
        </span>
      </Link>
      <LanguageToggle currentLang={lang} />
    </header>
  );
}
