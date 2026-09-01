import Link from "next/link";
import { LanguageToggle } from "@/components/language-toggle";
import type { Lang } from "@/lib/i18n/translations";

export function LegalPageShell({
  lang,
  title,
  lastUpdated,
  children,
}: {
  lang: Lang;
  title: string;
  lastUpdated: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="w-full sticky top-0 z-40 bg-surface/95 backdrop-blur-sm border-b border-outline-variant/30">
        <div className="max-w-3xl mx-auto px-container-padding h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-512.png" alt="DIVA Association" className="w-8 h-8 rounded-lg flex-shrink-0" />
            <span className="font-title-md text-title-md text-primary tracking-tight truncate">DIVA Association</span>
          </Link>
          <LanguageToggle currentLang={lang} />
        </div>
      </header>

      <main className="flex-1 max-w-3xl mx-auto w-full px-container-padding py-section-margin">
        <h1 className="font-headline-lg-mobile text-headline-lg-mobile md:font-headline-lg md:text-headline-lg text-primary mb-2">
          {title}
        </h1>
        <p className="font-label-sm text-label-sm text-on-surface-variant mb-section-margin">{lastUpdated}</p>
        <div className="flex flex-col gap-section-margin">{children}</div>
      </main>

      <footer className="border-t border-outline-variant/30 bg-surface py-stack-gap-lg">
        <div className="max-w-3xl mx-auto px-container-padding text-center">
          <Link href="/" className="font-label-sm text-label-sm text-primary hover:underline">
            ← DIVA Association
          </Link>
        </div>
      </footer>
    </div>
  );
}

export function LegalSection({ title, body }: { title: string; body: string }) {
  return (
    <section>
      <h2 className="font-title-md text-title-md text-on-surface mb-stack-gap-sm">{title}</h2>
      <p className="font-body-md text-body-md text-on-surface-variant whitespace-pre-wrap">{body}</p>
    </section>
  );
}
