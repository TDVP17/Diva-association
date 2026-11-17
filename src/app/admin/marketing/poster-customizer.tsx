"use client";

import { useState, useRef, useEffect } from "react";
import { type Lang } from "@/lib/i18n/translations";

interface PosterCustomizerProps {
  lang: Lang;
}

export function PosterCustomizer({ lang }: { lang: Lang }) {
  const isFr = lang === "fr";

  // Textes
  const [badgeText, setBadgeText] = useState("CAMPAGNE OFFICIELLE · DIVA ASSO");
  const [headline, setHeadline] = useState("VOTRE TONTINE 100% SÉCURISÉE EN LIGNE");
  const [subtitle, setSubtitle] = useState(
    "Épargnez ensemble en toute confiance. Tirage audité en direct, paiements Orange & MTN Money instantanés, zéro intermédiaire."
  );
  const [ctaText, setCtaText] = useState("Rejoignez dès maintenant sur divaasso.com");
  const [website, setWebsite] = useState("divaasso.com");

  // Tailles
  const [headlineSize, setHeadlineSize] = useState(28);
  const [subtitleSize, setSubtitleSize] = useState(14);

  // Couleurs (avec codes HEX et sélecteurs)
  const [bgColor, setBgColor] = useState("#064e3b");
  const [bgSecondaryColor, setBgSecondaryColor] = useState("#00281e");
  const [textColor, setTextColor] = useState("#ffffff");
  const [accentColor, setAccentColor] = useState("#f59e0b");
  const [cardBgColor, setCardBgColor] = useState("#043327");

  // Images & Logo
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [illustrationUrl, setIllustrationUrl] = useState<string | null>(null);

  // Onglet actif : "templates" ou "customizer"
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Canvas pour export image HD
  const previewRef = useRef<HTMLDivElement | null>(null);

  // Charger les paramètres enregistrés
  useEffect(() => {
    try {
      const saved = localStorage.getItem("diva_custom_poster");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.headline) setHeadline(parsed.headline);
        if (parsed.subtitle) setSubtitle(parsed.subtitle);
        if (parsed.badgeText) setBadgeText(parsed.badgeText);
        if (parsed.bgColor) setBgColor(parsed.bgColor);
        if (parsed.bgSecondaryColor) setBgSecondaryColor(parsed.bgSecondaryColor);
        if (parsed.textColor) setTextColor(parsed.textColor);
        if (parsed.accentColor) setAccentColor(parsed.accentColor);
        if (parsed.headlineSize) setHeadlineSize(parsed.headlineSize);
        if (parsed.subtitleSize) setSubtitleSize(parsed.subtitleSize);
      }
    } catch {
      // Ignorer si localStorage indisponible
    }
  }, []);

  function saveToLocalStorage() {
    try {
      localStorage.setItem(
        "diva_custom_poster",
        JSON.stringify({
          headline,
          subtitle,
          badgeText,
          bgColor,
          bgSecondaryColor,
          textColor,
          accentColor,
          headlineSize,
          subtitleSize,
        })
      );
      alert(isFr ? "Modifications sauvegardées avec succès !" : "Poster settings saved successfully!");
    } catch {
      // Ignorer
    }
  }

  function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => setLogoUrl(reader.result as string);
      reader.readAsDataURL(file);
    }
  }

  function handleIllustrationUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => setIllustrationUrl(reader.result as string);
      reader.readAsDataURL(file);
    }
  }

  async function handleDownloadPoster() {
    if (!previewRef.current) return;
    setIsExporting(true);

    try {
      // Création d'un canvas HTML5 pour export haute définition 1080x1080
      const canvas = document.createElement("canvas");
      canvas.width = 1080;
      canvas.height = 1080;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Dessin du fond dégradé
      const grad = ctx.createLinearGradient(0, 0, 1080, 1080);
      grad.addColorStop(0, bgColor);
      grad.addColorStop(1, bgSecondaryColor);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 1080, 1080);

      // Si illustration présente
      if (illustrationUrl) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        await new Promise((resolve) => {
          img.onload = resolve;
          img.onerror = resolve;
          img.src = illustrationUrl;
        });
        ctx.globalAlpha = 0.25;
        ctx.drawImage(img, 0, 0, 1080, 1080);
        ctx.globalAlpha = 1.0;
      }

      // Dessin des cercles décoratifs
      ctx.fillStyle = accentColor;
      ctx.globalAlpha = 0.08;
      ctx.beginPath();
      ctx.arc(950, 150, 250, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(100, 950, 200, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1.0;

      // Carte centrale intérieure
      ctx.fillStyle = cardBgColor;
      ctx.beginPath();
      ctx.roundRect(80, 80, 920, 920, 36);
      ctx.fill();

      // En-tête : Badge
      ctx.fillStyle = accentColor;
      ctx.beginPath();
      ctx.roundRect(140, 140, 380, 50, 25);
      ctx.fill();
      ctx.fillStyle = "#000000";
      ctx.font = "bold 20px sans-serif";
      ctx.fillText(badgeText, 160, 172);

      // Logo
      if (logoUrl) {
        const logoImg = new Image();
        logoImg.crossOrigin = "anonymous";
        await new Promise((resolve) => {
          logoImg.onload = resolve;
          logoImg.onerror = resolve;
          logoImg.src = logoUrl;
        });
        ctx.drawImage(logoImg, 840, 130, 80, 80);
      } else {
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 28px sans-serif";
        ctx.fillText("DIVA Asso.", 800, 175);
      }

      // Titre principal (Headline) avec wrap automatique
      ctx.fillStyle = textColor;
      ctx.font = `bold ${Math.round(headlineSize * 1.8)}px sans-serif`;
      const words = headline.split(" ");
      let line = "";
      let y = 300;
      for (const w of words) {
        const testLine = line + w + " ";
        const metrics = ctx.measureText(testLine);
        if (metrics.width > 800 && line !== "") {
          ctx.fillText(line, 140, y);
          line = w + " ";
          y += Math.round(headlineSize * 2.1);
        } else {
          line = testLine;
        }
      }
      ctx.fillText(line, 140, y);

      // Description / Sous-titre
      y += 60;
      ctx.fillStyle = "#e2e8f0";
      ctx.font = `${Math.round(subtitleSize * 1.8)}px sans-serif`;
      const subWords = subtitle.split(" ");
      line = "";
      for (const w of subWords) {
        const testLine = line + w + " ";
        const metrics = ctx.measureText(testLine);
        if (metrics.width > 800 && line !== "") {
          ctx.fillText(line, 140, y);
          line = w + " ";
          y += Math.round(subtitleSize * 2.3);
        } else {
          line = testLine;
        }
      }
      ctx.fillText(line, 140, y);

      // 3 Puces piliers
      y = Math.max(y + 80, 680);
      const points = [
        "✓ Tirage au sort en direct audité",
        "✓ 100% Mobile Money Orange & MTN",
        "✓ Cotisations & Prêts solidaires sécurisés",
      ];
      ctx.font = "bold 24px sans-serif";
      for (const p of points) {
        ctx.fillStyle = accentColor;
        ctx.fillText("●", 140, y);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(p, 180, y);
        y += 45;
      }

      // Bannière CTA en bas
      ctx.fillStyle = accentColor;
      ctx.beginPath();
      ctx.roundRect(140, 850, 800, 90, 24);
      ctx.fill();

      ctx.fillStyle = "#000000";
      ctx.font = "bold 30px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${ctaText} · ${website}`, 540, 907);
      ctx.textAlign = "left";

      // Téléchargement PNG direct
      const dataUrl = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `affiche-personnalisee-diva-asso-${Date.now()}.png`;
      a.click();
    } catch (e) {
      console.error("Export poster error:", e);
      alert(isFr ? "Erreur lors du téléchargement de l'affiche." : "Error downloading poster.");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 mb-8">
      {/* ── Bouton d'ouverture du Studio de personnalisation ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl bg-white border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-900 flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-2xl">palette</span>
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">
              {isFr ? "Studio de personnalisation des affiches" : "Custom Poster Studio"}
            </h2>
            <p className="text-xs text-slate-500">
              {isFr
                ? "Modifiez vous-même les logos, images, textes, tailles et codes couleurs pour générer vos visuels sur mesure."
                : "Customize logos, images, text, sizes, and hex colors to generate bespoke promotional posters."}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className={`inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs transition-all shadow-xs cursor-pointer ${
            isOpen
              ? "bg-slate-800 text-white hover:bg-slate-900"
              : "bg-primary hover:bg-primary/90 text-white"
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">
            {isOpen ? "close" : "tune"}
          </span>
          <span>{isOpen ? (isFr ? "Masquer le studio" : "Close Studio") : (isFr ? "Ouvrir le studio d'édition" : "Open Poster Studio")}</span>
        </button>
      </div>

      {/* ── Panneau complet du studio d'édition (visible quand isOpen) ── */}
      {isOpen && (
        <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-xl grid grid-cols-1 lg:grid-cols-12 gap-8 animate-in fade-in duration-200">
          {/* Colonne gauche : Commandes & Réglages */}
          <div className="lg:col-span-6 flex flex-col gap-5">
            <div className="border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">tune</span>
                <span>{isFr ? "Paramètres de personnalisation" : "Poster Settings"}</span>
              </h3>
            </div>

            {/* 1. Logos et Images */}
            <div className="flex flex-col gap-3">
              <span className="text-xs font-bold text-slate-700 uppercase">
                {isFr ? "1. Logo & Image d'illustration" : "1. Logo & Illustration"}
              </span>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-xs text-slate-600 font-medium">
                  <span>{isFr ? "Changer le logo :" : "Upload logo:"}</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleLogoUpload}
                    className="text-[11px] file:mr-2 file:py-1 file:px-2 file:rounded-md file:border-0 file:text-[11px] file:bg-primary/10 file:text-primary file:cursor-pointer"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-slate-600 font-medium">
                  <span>{isFr ? "Image de fond / illustration :" : "Background / photo:"}</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleIllustrationUpload}
                    className="text-[11px] file:mr-2 file:py-1 file:px-2 file:rounded-md file:border-0 file:text-[11px] file:bg-primary/10 file:text-primary file:cursor-pointer"
                  />
                </label>
              </div>
            </div>

            {/* 2. Textes */}
            <div className="flex flex-col gap-3">
              <span className="text-xs font-bold text-slate-700 uppercase">
                {isFr ? "2. Contenu des textes" : "2. Text Content"}
              </span>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-bold text-slate-600">
                  {isFr ? "Badge en-tête :" : "Header badge:"}
                </label>
                <input
                  type="text"
                  value={badgeText}
                  onChange={(e) => setBadgeText(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold text-slate-600">
                    {isFr ? "Grand titre (Headline) :" : "Headline title:"}
                  </label>
                  <span className="text-[10px] text-slate-400">Taille : {headlineSize}px</span>
                </div>
                <textarea
                  rows={2}
                  value={headline}
                  onChange={(e) => setHeadline(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs font-bold text-slate-900 focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <input
                  type="range"
                  min={18}
                  max={40}
                  value={headlineSize}
                  onChange={(e) => setHeadlineSize(parseInt(e.target.value))}
                  className="w-full accent-primary mt-1"
                />
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold text-slate-600">
                    {isFr ? "Sous-titre / Description :" : "Subtitle / description:"}
                  </label>
                  <span className="text-[10px] text-slate-400">Taille : {subtitleSize}px</span>
                </div>
                <textarea
                  rows={3}
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <input
                  type="range"
                  min={11}
                  max={20}
                  value={subtitleSize}
                  onChange={(e) => setSubtitleSize(parseInt(e.target.value))}
                  className="w-full accent-primary mt-1"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-bold text-slate-600">
                    {isFr ? "Bouton d'appel (CTA) :" : "CTA text:"}
                  </label>
                  <input
                    type="text"
                    value={ctaText}
                    onChange={(e) => setCtaText(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-bold text-slate-600">
                    {isFr ? "Lien du site :" : "Website:"}
                  </label>
                  <input
                    type="text"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>
            </div>

            {/* 3. Codes Couleurs personnalisés (HEX) */}
            <div className="flex flex-col gap-3">
              <span className="text-xs font-bold text-slate-700 uppercase">
                {isFr ? "3. Codes Couleurs (HEX) & Sélecteurs" : "3. Color Codes (HEX)"}
              </span>

              <div className="grid grid-cols-2 gap-3">
                {/* Fond principal */}
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-bold text-slate-600">
                    {isFr ? "Fond principal :" : "Primary background:"}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={bgColor}
                      onChange={(e) => setBgColor(e.target.value)}
                      className="w-8 h-8 rounded-lg border border-slate-200 cursor-pointer p-0.5"
                    />
                    <input
                      type="text"
                      value={bgColor}
                      onChange={(e) => setBgColor(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono font-bold"
                    />
                  </div>
                </div>

                {/* Couleur d'accent */}
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-bold text-slate-600">
                    {isFr ? "Couleur d'accent :" : "Accent color:"}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={accentColor}
                      onChange={(e) => setAccentColor(e.target.value)}
                      className="w-8 h-8 rounded-lg border border-slate-200 cursor-pointer p-0.5"
                    />
                    <input
                      type="text"
                      value={accentColor}
                      onChange={(e) => setAccentColor(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono font-bold"
                    />
                  </div>
                </div>

                {/* Couleur texte */}
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-bold text-slate-600">
                    {isFr ? "Couleur du texte :" : "Text color:"}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={textColor}
                      onChange={(e) => setTextColor(e.target.value)}
                      className="w-8 h-8 rounded-lg border border-slate-200 cursor-pointer p-0.5"
                    />
                    <input
                      type="text"
                      value={textColor}
                      onChange={(e) => setTextColor(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono font-bold"
                    />
                  </div>
                </div>

                {/* Fond de la carte centrale */}
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-bold text-slate-600">
                    {isFr ? "Fond encadré :" : "Card background:"}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={cardBgColor}
                      onChange={(e) => setCardBgColor(e.target.value)}
                      className="w-8 h-8 rounded-lg border border-slate-200 cursor-pointer p-0.5"
                    />
                    <input
                      type="text"
                      value={cardBgColor}
                      onChange={(e) => setCardBgColor(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono font-bold"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Boutons d'action pour la configuration */}
            <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={saveToLocalStorage}
                className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-bold text-xs hover:bg-slate-50 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">save</span>
                <span>{isFr ? "Sauvegarder mes réglages" : "Save settings"}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setBgColor("#064e3b");
                  setBgSecondaryColor("#00281e");
                  setTextColor("#ffffff");
                  setAccentColor("#f59e0b");
                  setCardBgColor("#043327");
                  setHeadlineSize(28);
                  setSubtitleSize(14);
                  setHeadline("VOTRE TONTINE 100% SÉCURISÉE EN LIGNE");
                  setSubtitle(
                    "Épargnez ensemble en toute confiance. Tirage audité en direct, paiements Orange & MTN Money instantanés, zéro intermédiaire."
                  );
                }}
                className="py-2.5 px-3 rounded-xl border border-slate-200 text-slate-500 font-bold text-xs hover:bg-slate-100 transition-colors cursor-pointer"
                title={isFr ? "Réinitialiser par défaut" : "Reset defaults"}
              >
                <span className="material-symbols-outlined text-[16px]">restart_alt</span>
              </button>
            </div>
          </div>

          {/* Colonne droite : Prévisualisation en direct (Live Preview) */}
          <div className="lg:col-span-6 flex flex-col gap-4 items-center">
            <span className="text-xs font-bold text-slate-500 uppercase self-start flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>{isFr ? "Aperçu en temps réel (1080 x 1080 HD)" : "Live HD Preview (1080 x 1080)"}</span>
            </span>

            {/* Cadre de l'affiche */}
            <div
              ref={previewRef}
              style={{
                background: `linear-gradient(135deg, ${bgColor} 0%, ${bgSecondaryColor} 100%)`,
              }}
              className="w-full max-w-md aspect-square rounded-3xl p-5 sm:p-6 shadow-2xl relative overflow-hidden flex flex-col justify-between border border-white/10"
            >
              {/* Illustration de fond si chargée */}
              {illustrationUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={illustrationUrl}
                  alt="Illustration"
                  className="absolute inset-0 w-full h-full object-cover opacity-20 pointer-events-none"
                />
              )}

              {/* Cercles lumineux */}
              <div
                style={{ backgroundColor: accentColor }}
                className="absolute -right-10 -top-10 w-44 h-44 rounded-full opacity-10 blur-xl pointer-events-none"
              />

              {/* Carte intérieure */}
              <div
                style={{ backgroundColor: cardBgColor }}
                className="relative z-10 w-full h-full rounded-2xl p-4 sm:p-5 flex flex-col justify-between border border-white/10 shadow-inner"
              >
                {/* En-tête : Badge & Logo */}
                <div className="flex items-center justify-between gap-2">
                  <span
                    style={{ backgroundColor: accentColor, color: "#000000" }}
                    className="inline-block px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider shadow-xs"
                  >
                    {badgeText}
                  </span>

                  {logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoUrl} alt="Logo" className="w-8 h-8 object-contain rounded-lg" />
                  ) : (
                    <span className="font-extrabold text-sm text-white tracking-tight">
                      DIVA Asso.
                    </span>
                  )}
                </div>

                {/* Titre & Sous-titre */}
                <div className="my-auto flex flex-col gap-2">
                  <h4
                    style={{ color: textColor, fontSize: `${headlineSize}px` }}
                    className="font-black leading-tight tracking-tight uppercase"
                  >
                    {headline}
                  </h4>
                  <p
                    style={{ color: "#e2e8f0", fontSize: `${subtitleSize}px` }}
                    className="leading-relaxed opacity-90 line-clamp-4"
                  >
                    {subtitle}
                  </p>

                  {/* Puces */}
                  <div className="mt-2 flex flex-col gap-1 text-[11px] font-bold text-white">
                    <span className="flex items-center gap-1.5">
                      <span style={{ color: accentColor }}>✓</span>
                      <span>Tirage au sort en direct audité</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span style={{ color: accentColor }}>✓</span>
                      <span>100% Mobile Money Orange & MTN</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span style={{ color: accentColor }}>✓</span>
                      <span>Cotisations & Prêts solidaires</span>
                    </span>
                  </div>
                </div>

                {/* Bas de page : CTA */}
                <div
                  style={{ backgroundColor: accentColor }}
                  className="rounded-xl p-2.5 text-center text-black font-extrabold text-xs shadow-md"
                >
                  <span>{ctaText} · {website}</span>
                </div>
              </div>
            </div>

            {/* Boutons d'exportation */}
            <div className="w-full max-w-md flex flex-col sm:flex-row gap-2.5">
              <button
                type="button"
                onClick={handleDownloadPoster}
                disabled={isExporting}
                className="flex-1 py-3 px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-extrabold text-xs transition-all shadow-md active:scale-98 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[18px]">download</span>
                <span>
                  {isExporting
                    ? (isFr ? "Génération de l'affiche..." : "Generating...")
                    : (isFr ? "Télécharger l'affiche HD (PNG)" : "Download HD Poster (PNG)")}
                </span>
              </button>

              <a
                href={`https://api.whatsapp.com/send?text=${encodeURIComponent(
                  `${headline}\n\n${subtitle}\n\n👉 Rejoignez-nous dès maintenant sur https://${website}`
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="py-3 px-4 rounded-xl bg-[#25D366] hover:bg-[#128C7E] text-white font-bold text-xs transition-colors shadow-md flex items-center justify-center gap-2 cursor-pointer"
                title={isFr ? "Partager sur WhatsApp" : "Share on WhatsApp"}
              >
                <span className="material-symbols-outlined text-[18px]">share</span>
                <span>WhatsApp</span>
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

