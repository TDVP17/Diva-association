"use client";

import { Suspense, useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";

function isStandaloneMode(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true ||
    document.referrer.includes("android-app://") ||
    window.location.search.includes("mode=pwa")
  );
}

function SmartOpenContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const target = searchParams.get("target") || "/dashboard";
  const [device, setDevice] = useState<"ios" | "android" | "desktop">("desktop");
  const [isStandalone, setIsStandalone] = useState(false);
  const [countdown, setCountdown] = useState(2);

  useEffect(() => {
    const standalone = isStandaloneMode();
    setIsStandalone(standalone);

    const ua = navigator.userAgent;
    const isIos = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && "ontouchend" in document);
    const isAndroid = /Android/i.test(ua);

    if (isIos) setDevice("ios");
    else if (isAndroid) setDevice("android");
    else setDevice("desktop");

    // If already inside standalone app, navigate immediately with no delay
    if (standalone) {
      router.replace(target);
      return;
    }

    // Auto-proceed countdown
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          startTransition(() => {
            router.replace(target);
          });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [router, target]);

  function handleContinueInBrowser() {
    startTransition(() => {
      router.replace(target);
    });
  }

  return (
    <div className="min-h-screen bg-[#f8f9fa] flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-xl border border-emerald-900/10 p-6 text-center flex flex-col items-center">
        {/* Logo */}
        <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center mb-4 p-2 shadow-inner">
          <Image
            src="/icons/icon-192.png"
            alt="DIVA Asso"
            width={72}
            height={72}
            className="rounded-xl object-contain"
            priority
          />
        </div>

        <h1 className="text-xl font-bold text-primary mb-1">DIVA Asso.</h1>
        <p className="text-xs text-on-surface-variant mb-6">
          {isStandalone
            ? "Ouverture directe dans votre application..."
            : "Redirection vers votre espace sécurisé..."}
        </p>

        {/* Loading Spinner / Progress */}
        <div className="w-full bg-emerald-50 rounded-full h-1.5 mb-6 overflow-hidden">
          <div className="bg-primary h-full animate-[pulse_1.5s_ease-in-out_infinite] w-full" />
        </div>

        {/* Smart App Status info */}
        {!isStandalone && (
          <div className="w-full bg-[#f3f4f5] rounded-2xl p-3 mb-5 text-left flex items-start gap-3">
            <span className="material-symbols-outlined text-primary text-xl flex-shrink-0 mt-0.5">
              {device === "ios" ? "phone_iphone" : "smartphone"}
            </span>
            <div className="text-xs text-on-surface-variant">
              <p className="font-semibold text-primary">
                {device === "ios" ? "Navigateur Safari / iOS" : "Navigateur Google / Android"}
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed">
                {device === "ios"
                  ? "Si l'application est sur votre écran d'accueil, elle sera privilégiée. Sinon, la session s'ouvre dans Safari."
                  : "Si l'application est installée, elle s'ouvre automatiquement. Sinon, la session continue dans Chrome."}
              </p>
            </div>
          </div>
        )}

        {/* Action Button */}
        <button
          onClick={handleContinueInBrowser}
          className="w-full py-3 px-4 rounded-xl bg-primary hover:bg-[#064e3b] text-white font-semibold text-sm transition-all shadow-md active:scale-98 flex items-center justify-center gap-2 cursor-pointer"
        >
          <span>Continuer maintenant</span>
          {countdown > 0 && (
            <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full font-mono">
              {countdown}s
            </span>
          )}
        </button>
      </div>

      <p className="text-[11px] text-gray-400 mt-4">
        DIVA Asso • Bertoua, Cameroun • www.divaasso.com
      </p>
    </div>
  );
}

export default function SmartOpenPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#f8f9fa] flex items-center justify-center">
          <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        </div>
      }
    >
      <SmartOpenContent />
    </Suspense>
  );
}
