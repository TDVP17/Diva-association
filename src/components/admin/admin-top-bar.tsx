import { signOut } from "@/auth";
import { LanguageToggle } from "@/components/language-toggle";
import { translate, type Lang } from "@/lib/i18n/translations";

export function AdminTopBar({ userName, lang }: { userName: string; lang: Lang }) {
  return (
    <header className="w-full top-0 sticky bg-primary text-on-primary flex items-center justify-between px-container-padding h-16 z-40 shadow-md">
      <div className="flex items-center gap-3 min-w-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-512.png" alt="DIVA Associations" className="w-9 h-9 rounded-lg flex-shrink-0" />
        <div className="min-w-0">
          <p className="font-title-md text-title-md leading-none truncate">{translate(lang, "adminBrand")}</p>
          <p className="font-label-sm text-label-sm text-on-primary/70 leading-none mt-1 truncate">{userName}</p>
        </div>
      </div>
      <nav className="flex items-center gap-4 flex-shrink-0">
        <LanguageToggle currentLang={lang} dark />
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button
            type="submit"
            className="font-label-md text-label-md hover:opacity-80 transition-opacity flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[20px]">logout</span>
            <span className="hidden sm:inline">{translate(lang, "signOut")}</span>
          </button>
        </form>
      </nav>
    </header>
  );
}
