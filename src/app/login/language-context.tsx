"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { translations, type Lang, type TranslationKey } from "./i18n";

const LANGUAGE_STORAGE_KEY = "diva_lang";

const LanguageContext = createContext<{
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TranslationKey) => string;
} | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    // Deliberately deferred to an effect rather than a useState lazy
    // initializer: the server has no `window`/localStorage, so it always
    // renders "en". Reading the persisted preference during render would
    // make the client's first render disagree with the server-rendered
    // HTML (a real hydration mismatch), not just an avoidable extra
    // render — this is the standard, correct pattern for browser-only
    // preferences (theme, language, etc.), not something to restructure.
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored === "en" || stored === "fr") setLangState(stored);
  }, []);

  function setLang(next: Lang) {
    setLangState(next);
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
  }

  function t(key: TranslationKey): string {
    return translations[lang][key];
  }

  return <LanguageContext.Provider value={{ lang, setLang, t }}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within a LanguageProvider");
  return ctx;
}

export function LanguageToggle() {
  const { lang, setLang } = useLanguage();
  return (
    <div className="flex justify-center gap-1 mb-stack-gap-md relative z-10">
      <button
        type="button"
        onClick={() => setLang("en")}
        className={
          lang === "en"
            ? "px-3 py-1 rounded-full font-label-sm text-label-sm bg-primary text-on-primary"
            : "px-3 py-1 rounded-full font-label-sm text-label-sm text-on-surface-variant hover:bg-surface-container-low"
        }
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => setLang("fr")}
        className={
          lang === "fr"
            ? "px-3 py-1 rounded-full font-label-sm text-label-sm bg-primary text-on-primary"
            : "px-3 py-1 rounded-full font-label-sm text-label-sm text-on-surface-variant hover:bg-surface-container-low"
        }
      >
        FR
      </button>
    </div>
  );
}
