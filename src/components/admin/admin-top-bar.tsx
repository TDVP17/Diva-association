import Link from "next/link";
import { LanguageToggle } from "@/components/language-toggle";
import { translate, type Lang } from "@/lib/i18n/translations";

export function AdminTopBar({ userName, lang }: { userName: string; lang: Lang }) {
  return (
    <header className="w-full top-0 sticky bg-primary text-on-primary flex items-center justify-between px-container-padding h-16 z-40 shadow-md">
      <div className="flex items-center gap-3">
        <span className="material-symbols-outlined text-2xl">shield</span>
        <div>
          <p className="font-title-md text-title-md leading-none">DIVA Admin</p>
          <p className="font-label-sm text-label-sm text-on-primary/70 leading-none mt-1">{userName}</p>
        </div>
      </div>
      <nav className="flex items-center gap-4">
        <Link
          href="/admin/sessions/new"
          className="font-label-md text-label-md hover:opacity-80 transition-opacity hidden sm:block"
        >
          + {translate(lang, "newCotisation")}
        </Link>
        <Link
          href="/dashboard"
          className="font-label-md text-label-md hover:opacity-80 transition-opacity flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-[20px]">logout</span>
          <span className="hidden sm:inline">Exit Admin</span>
        </Link>
        <LanguageToggle currentLang={lang} dark />
      </nav>
    </header>
  );
}
