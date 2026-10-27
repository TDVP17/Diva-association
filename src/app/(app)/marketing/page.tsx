import Link from "next/link";
import { getLang, getTranslator } from "@/lib/i18n/get-lang";

interface PosterItem {
  id: string;
  day: string;
  dayEn: string;
  headline: string;
  headlineEn: string;
  deviceType: "Mobile" | "PC";
  description: string;
  descriptionEn: string;
  filename: string;
  badgeColor: string;
}

const POSTERS: PosterItem[] = [
  {
    id: "lundi",
    day: "Lundi",
    dayEn: "Monday",
    headline: "BON LUNDI, BELLE SEMAINE.",
    headlineEn: "HAPPY MONDAY, GREAT WEEK.",
    deviceType: "Mobile",
    description: "Le premier jour est le bon pour sécuriser votre épargne et rejoindre une tontine.",
    descriptionEn: "The first day is the right day to secure your savings and join a tontine.",
    filename: "1-lundi-diva-asso.jpg",
    badgeColor: "bg-emerald-100 text-emerald-800 border-emerald-300",
  },
  {
    id: "mardi",
    day: "Mardi",
    dayEn: "Tuesday",
    headline: "MARDI MOTIVATION, PROJETS EN MARCHE.",
    headlineEn: "TUESDAY MOTIVATION, PROJECTS IN MOTION.",
    deviceType: "PC",
    description: "Chaque semaine compte. Épargnez ensemble et réalisez vos objectifs en toute transparence.",
    descriptionEn: "Every week counts. Save together and achieve your goals with complete transparency.",
    filename: "2-mardi-diva-asso.jpg",
    badgeColor: "bg-blue-100 text-blue-800 border-blue-300",
  },
  {
    id: "mercredi",
    day: "Mercredi",
    dayEn: "Wednesday",
    headline: "MERCREDI, CAP À MI-SEMAINE.",
    headlineEn: "WEDNESDAY, MIDWEEK MILESTONE.",
    deviceType: "Mobile",
    description: "Tirage transparent sous vos yeux : découvrez votre ordre de passage en toute confiance.",
    descriptionEn: "Transparent draw right before your eyes: discover your payout order with confidence.",
    filename: "3-mercredi-diva-asso.jpg",
    badgeColor: "bg-purple-100 text-purple-800 border-purple-300",
  },
  {
    id: "jeudi",
    day: "Jeudi",
    dayEn: "Thursday",
    headline: "JEUDI D'ANTICIPATION, SOUTENEZ VOS PROCHES.",
    headlineEn: "THURSDAY ANTICIPATION, SUPPORT YOUR RELATIVES.",
    deviceType: "PC",
    description: "Payez pour vos proches en un clic grâce à la contribution directe depuis votre compte.",
    descriptionEn: "Pay for your relatives in one click with direct contribution from your account.",
    filename: "4-jeudi-diva-asso.jpg",
    badgeColor: "bg-amber-100 text-amber-900 border-amber-300",
  },
  {
    id: "vendredi",
    day: "Vendredi",
    dayEn: "Friday",
    headline: "VENDREDI, TOUT EST PRÊT.",
    headlineEn: "FRIDAY, EVERYTHING IS READY.",
    deviceType: "Mobile",
    description: "Paiement Global synchronisé en un seul débit Orange Money ou MTN Mobile Money.",
    descriptionEn: "Synchronized Bulk Payment in a single Orange Money or MTN Mobile Money charge.",
    filename: "5-vendredi-diva-asso.jpg",
    badgeColor: "bg-teal-100 text-teal-800 border-teal-300",
  },
  {
    id: "samedi",
    day: "Samedi",
    dayEn: "Saturday",
    headline: "SAMEDI, JOUR DE VÉRIFICATION.",
    headlineEn: "SATURDAY, VERIFICATION DAY.",
    deviceType: "PC",
    description: "Consultez votre tableau de bord, solde et statut avant la grande session de dimanche.",
    descriptionEn: "Check your dashboard, balance, and status ahead of Sunday's big session.",
    filename: "6-samedi-diva-asso.jpg",
    badgeColor: "bg-indigo-100 text-indigo-800 border-indigo-300",
  },
  {
    id: "dimanche",
    day: "Dimanche",
    dayEn: "Sunday",
    headline: "DIMANCHE, GRAND JOUR DE COTISATION !",
    headlineEn: "SUNDAY, BIG CONTRIBUTION DAY!",
    deviceType: "Mobile",
    description: "Cotisez à l'heure : la cagnotte est reversée instantanément dès que 100% des membres ont payé.",
    descriptionEn: "Contribute on time: the pot is released instantly as soon as 100% of members have paid.",
    filename: "7-dimanche-diva-asso.jpg",
    badgeColor: "bg-rose-100 text-rose-800 border-rose-300",
  },
  {
    id: "guide",
    day: "Guide",
    dayEn: "Guide",
    headline: "COMMENT ÇA FONCTIONNE ?",
    headlineEn: "HOW DOES IT WORK?",
    deviceType: "PC",
    description: "1. Rejoignez · 2. Tirage transparent · 3. Cotisez simplement · 4. Encaissez 100% de la cagnotte.",
    descriptionEn: "1. Join · 2. Transparent draw · 3. Simple payment · 4. Cash out 100% of the pot.",
    filename: "8-comment-ca-marche-diva-asso.jpg",
    badgeColor: "bg-yellow-100 text-yellow-900 border-yellow-300",
  },
];

export default async function MarketingPostersPage() {
  const lang = await getLang();
  const isFr = lang === "fr";

  return (
    <main className="px-container-padding py-stack-gap-lg max-w-5xl mx-auto w-full pb-36">
      {/* Header Banner */}
      <section className="bg-gradient-to-br from-[#003528] via-[#064e3b] to-[#022c22] text-white rounded-3xl p-6 sm:p-8 shadow-xl border border-emerald-500/20 mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-400/20 border border-amber-300/40 text-amber-300 font-bold text-xs uppercase tracking-wider mb-3">
            <span>✨</span>
            <span>{isFr ? "Campagne Officielle" : "Official Campaign"}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
            {isFr ? "Affiches Publicitaires DIVA Asso." : "DIVA Asso. Marketing Posters"}
          </h1>
          <p className="text-sm sm:text-base text-emerald-100/90 mt-2 leading-relaxed">
            {isFr
              ? "Téléchargez les visuels professionnels officiels (Lundi à Dimanche + Guide) conçus pour promouvoir l'application divaasso.com sur WhatsApp, Facebook, Instagram et vos groupes."
              : "Download official high-resolution posters (Monday to Sunday + Guide) designed to promote divaasso.com on WhatsApp, Facebook, Instagram, and social groups."}
          </p>
        </div>

        {/* Global Download Pack Button */}
        <div className="flex-shrink-0">
          <a
            href="/posters/pack-affiches-pub-diva-asso.zip"
            download="pack-affiches-pub-diva-asso.zip"
            className="inline-flex items-center gap-2.5 px-6 py-3.5 rounded-2xl bg-amber-400 hover:bg-amber-300 text-emerald-950 font-black text-sm transition-all shadow-lg shadow-black/20 hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
          >
            <span className="material-symbols-outlined text-[22px]">folder_zip</span>
            <span>{isFr ? "Télécharger le Pack Complet (ZIP)" : "Download All Pack (ZIP)"}</span>
          </a>
        </div>
      </section>

      {/* Grid of Posters */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {POSTERS.map((poster) => {
          const downloadUrl = `/posters/${poster.filename}`;
          const title = isFr ? poster.headline : poster.headlineEn;
          const desc = isFr ? poster.description : poster.descriptionEn;
          const day = isFr ? poster.day : poster.dayEn;

          return (
            <article
              key={poster.id}
              className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden flex flex-col hover:shadow-md transition-shadow"
            >
              {/* Image Preview Container */}
              <div className="relative bg-slate-900 aspect-[9/16] max-h-[460px] overflow-hidden flex items-center justify-center group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={downloadUrl}
                  alt={title}
                  className="w-full h-full object-contain group-hover:scale-[1.02] transition-transform duration-300"
                  loading="lazy"
                />
                <div className="absolute top-3 left-3 flex items-center gap-2">
                  <span
                    className={`inline-block px-3 py-1 rounded-full border text-xs font-bold uppercase tracking-wider shadow-xs ${poster.badgeColor}`}
                  >
                    {day}
                  </span>
                  <span className="inline-block px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-sm text-white text-[11px] font-semibold border border-white/20">
                    {poster.deviceType} Mockup
                  </span>
                </div>
                <a
                  href={downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="absolute bottom-3 right-3 px-3 py-1.5 rounded-xl bg-black/70 hover:bg-black/90 backdrop-blur-sm text-white text-xs font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[16px]">visibility</span>
                  <span>{isFr ? "Plein écran" : "Full preview"}</span>
                </a>
              </div>

              {/* Poster Details & Actions */}
              <div className="p-5 flex flex-col flex-1 justify-between gap-4">
                <div>
                  <h2 className="font-extrabold text-slate-900 text-base leading-snug">
                    {title}
                  </h2>
                  <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                    {desc}
                  </p>
                </div>

                <div className="flex items-center gap-2.5 pt-2 border-t border-slate-100">
                  {/* Direct Download Button */}
                  <a
                    href={downloadUrl}
                    download={poster.filename}
                    className="flex-1 py-2.5 px-4 rounded-xl bg-[#003528] hover:bg-[#064e3b] text-white font-bold text-xs inline-flex items-center justify-center gap-1.5 transition-transform active:scale-[0.98] shadow-xs cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[18px]">download</span>
                    <span>{isFr ? "Télécharger l'affiche HD" : "Download HD Poster"}</span>
                  </a>

                  {/* Share on WhatsApp */}
                  <a
                    href={`https://api.whatsapp.com/send?text=${encodeURIComponent(
                      `${title}\n${desc}\n\n👉 Rejoignez la tontine dès maintenant sur https://www.divaasso.com`
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2.5 rounded-xl bg-[#25D366] hover:bg-[#128C7E] text-white inline-flex items-center justify-center transition-colors shadow-xs cursor-pointer"
                    title={isFr ? "Partager sur WhatsApp" : "Share on WhatsApp"}
                  >
                    <span className="material-symbols-outlined text-[18px]">share</span>
                  </a>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </main>
  );
}
