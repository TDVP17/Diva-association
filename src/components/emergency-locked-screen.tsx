import { type Lang } from "@/lib/i18n/translations";

export function EmergencyLockedScreen({ lang }: { lang: Lang }) {
  const isFr = lang === "fr";
  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 text-center select-none">
      <div className="w-20 h-20 rounded-2xl bg-red-600/20 border-2 border-red-500/40 text-red-500 flex items-center justify-center mb-6 shadow-[0_0_50px_rgba(239,68,68,0.25)] animate-pulse">
        <span className="material-symbols-outlined text-[44px]">lock</span>
      </div>

      <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight mb-3">
        {isFr ? "Application Temporairement Verrouillée" : "Application Temporarily Locked"}
      </h1>

      <p className="text-slate-300 max-w-md text-base leading-relaxed mb-6 font-medium">
        {isFr
          ? "Application temporairement verrouillée par l'admin, veuillez réessayer plus tard."
          : "Application temporarily locked by the administrator, please try again later."}
      </p>

      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-400 max-w-sm space-y-1">
        <p className="font-semibold text-slate-300 flex items-center justify-center gap-1.5">
          <span className="material-symbols-outlined text-[16px] text-amber-500">security</span>
          <span>DIVA Asso — Protection des Fonds</span>
        </p>
        <p>
          {isFr
            ? "Les cotisations et les paiements sont momentanément suspendus par mesure de sécurité."
            : "Contributions and payments are temporarily suspended for security purposes."}
        </p>
      </div>
    </div>
  );
}
