"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { type Lang } from "@/lib/i18n/translations";
import type { DashboardSummaryData } from "@/lib/dashboard";

const BALANCE_VISIBILITY_KEY = "diva_balance_hidden";

export function DashboardClient({
  data,
  lang,
  accessDeniedError = false,
}: {
  data: DashboardSummaryData;
  lang: Lang;
  accessDeniedError?: boolean;
}) {
  const [isBalanceHidden, setIsBalanceHidden] = useState(true);

  // Synchronize balance visibility preference with localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(BALANCE_VISIBILITY_KEY);
      if (stored !== null) {
        setIsBalanceHidden(stored === "true");
      }
    } catch {}
  }, []);

  function toggleBalanceVisibility() {
    setIsBalanceHidden((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(BALANCE_VISIBILITY_KEY, String(next));
      } catch {}
      return next;
    });
  }

  const { member, wallet, statistics, nextContribution, sessions, recentTransactions, loan, notifications } = data;

  return (
    <div className="flex flex-col gap-5 max-w-xl mx-auto w-full pb-6">
      {/* ── ALERTE SI ACCÈS REFUSÉ SUR UNE SESSION PRIVÉE ── */}
      {accessDeniedError && (
        <div className="bg-red-50 border-2 border-red-500/40 rounded-2xl p-4 flex items-center gap-3 text-red-900 shadow-sm animate-in fade-in duration-200">
          <span className="material-symbols-outlined text-red-600 text-2xl flex-shrink-0">gpp_bad</span>
          <div>
            <h4 className="font-bold text-sm">
              {lang === "fr" ? "Accès restreint" : "Restricted Access"}
            </h4>
            <p className="text-xs text-red-800 mt-0.5">
              {lang === "fr"
                ? "Vous ne faites pas partie de cette cotisation. L'accès est strictement réservé aux membres inscrits."
                : "You are not a member of this cotisation. Access is reserved for enrolled participants."}
            </p>
          </div>
        </div>
      )}

      {/* ── 1. EN-TÊTE PERSONNALISÉ ── */}
      <div className="flex items-center justify-between gap-3 pt-1">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative w-12 h-12 rounded-2xl overflow-hidden border-2 border-emerald-600/30 bg-emerald-50 flex items-center justify-center flex-shrink-0 shadow-xs">
            {member.avatar ? (
              <Image
                src={member.avatar}
                alt={member.fullName}
                fill
                sizes="48px"
                className="object-cover"
              />
            ) : (
              <span className="material-symbols-outlined text-emerald-800 text-[26px]">
                account_circle
              </span>
            )}
          </div>
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-extrabold text-slate-900 tracking-tight truncate">
              Bonjour, {member.firstName} 👋
            </h1>
            <p className="text-xs text-slate-500 font-medium truncate">
              Bienvenue dans votre espace DIVA Asso
            </p>
          </div>
        </div>

        {/* Badge Étoiles Confiance */}
        <Link
          href="/loans"
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-colors flex-shrink-0 shadow-2xs"
          title="Score de Confiance DIVA Asso"
        >
          <span className="material-symbols-outlined text-amber-500 text-[18px]">star</span>
          <span className="text-xs font-extrabold text-amber-900">{member.stars}/5</span>
        </Link>
      </div>

      {/* ── 2. CARTE FINANCIÈRE "MON PORTEFEUILLE" (Fintech Premium) ── */}
      <div className="relative rounded-3xl p-5 bg-gradient-to-br from-[#072d21] via-[#0b3d2e] to-[#0f513c] text-white shadow-lg border border-emerald-600/30 overflow-hidden">
        {/* Subtle decorative glow */}
        <div className="absolute -top-12 -right-12 w-44 h-44 bg-emerald-400/10 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute -bottom-10 -left-10 w-36 h-36 bg-amber-400/10 rounded-full blur-xl pointer-events-none" />

        <div className="relative z-10 flex flex-col gap-4">
          {/* Top Label & Eye Toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-emerald-300 text-[18px]">
                account_balance_wallet
              </span>
              <span className="text-[11px] font-extrabold tracking-wider uppercase text-emerald-200/90">
                Mon Portefeuille
              </span>
            </div>
            <button
              type="button"
              onClick={toggleBalanceVisibility}
              className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 active:scale-95 transition-all text-white flex items-center justify-center cursor-pointer"
              title={isBalanceHidden ? "Afficher le solde" : "Masquer le solde"}
              aria-label={isBalanceHidden ? "Afficher le solde" : "Masquer le solde"}
            >
              <span className="material-symbols-outlined text-[18px]">
                {isBalanceHidden ? "visibility_off" : "visibility"}
              </span>
            </button>
          </div>

          {/* Solde en gros chiffres */}
          <div>
            <div className="text-3xl sm:text-4xl font-extrabold tracking-tight font-numeric-data text-white">
              {isBalanceHidden ? "•••••• FCFA" : wallet.formattedBalance}
            </div>
            <p className="text-[11px] text-emerald-200/80 mt-1 flex items-center gap-1.5">
              <span>0% de frais sur les retraits</span>
              <span>•</span>
              <span>Frais recharge : {wallet.feePercentage}%</span>
            </p>
          </div>

          {/* Boutons d'actions rapides du Portefeuille */}
          <div className="pt-2 border-t border-white/10 flex items-center gap-2.5">
            <Link
              href="/wallet?action=recharge"
              className="flex-1 py-2.5 px-3 rounded-xl bg-white text-emerald-950 font-bold text-xs flex items-center justify-center gap-1.5 hover:bg-emerald-50 active:scale-[0.98] transition-all shadow-sm"
            >
              <span className="material-symbols-outlined text-[18px] text-emerald-700">add_circle</span>
              <span>Recharger</span>
            </Link>

            <Link
              href="/wallet?action=withdraw"
              className="flex-1 py-2.5 px-3 rounded-xl bg-white/15 hover:bg-white/20 active:scale-[0.98] text-white font-bold text-xs flex items-center justify-center gap-1.5 border border-white/20 transition-all backdrop-blur-xs"
            >
              <span className="material-symbols-outlined text-[18px]">payments</span>
              <span>Retirer</span>
            </Link>

            <Link
              href="/wallet"
              className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center border border-white/15 transition-all"
              title="Voir mon portefeuille complet"
            >
              <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
            </Link>
          </div>
        </div>
      </div>

      {/* ── 3. ACTIONS RAPIDES (Quick Access 4 Grids) ── */}
      <div>
        <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 mb-2.5 px-0.5">
          Actions rapides
        </h2>
        <div className="grid grid-cols-4 gap-2 sm:gap-2.5">
          {/* Action 1: Créer cotisation privée */}
          <Link
            href="/private-tontines"
            className="flex flex-col items-center justify-center p-3 rounded-2xl bg-white border border-slate-200/80 hover:border-amber-400 hover:bg-amber-50/40 active:scale-95 transition-all text-center group shadow-2xs"
          >
            <div className="w-10 h-10 rounded-xl bg-amber-100/80 text-amber-900 flex items-center justify-center mb-1.5 group-hover:scale-105 transition-transform">
              <span className="material-symbols-outlined text-[20px]">add_moderator</span>
            </div>
            <span className="text-[11px] font-bold text-slate-800 line-clamp-1">Créer</span>
            <span className="text-[9px] text-slate-400">Privée</span>
          </Link>

          {/* Action 2: Cotiser */}
          <Link
            href="/sessions"
            className="flex flex-col items-center justify-center p-3 rounded-2xl bg-white border border-slate-200/80 hover:border-emerald-500 hover:bg-emerald-50/40 active:scale-95 transition-all text-center group shadow-2xs"
          >
            <div className="w-10 h-10 rounded-xl bg-emerald-100/80 text-emerald-900 flex items-center justify-center mb-1.5 group-hover:scale-105 transition-transform">
              <span className="material-symbols-outlined text-[20px]">payments</span>
            </div>
            <span className="text-[11px] font-bold text-slate-800 line-clamp-1">Cotiser</span>
            <span className="text-[9px] text-slate-400">Session</span>
          </Link>

          {/* Action 3: Découvrir cotisations publiques */}
          <Link
            href="/sessions"
            className="flex flex-col items-center justify-center p-3 rounded-2xl bg-white border border-slate-200/80 hover:border-blue-400 hover:bg-blue-50/40 active:scale-95 transition-all text-center group shadow-2xs"
          >
            <div className="w-10 h-10 rounded-xl bg-blue-100/80 text-blue-900 flex items-center justify-center mb-1.5 group-hover:scale-105 transition-transform">
              <span className="material-symbols-outlined text-[20px]">explore</span>
            </div>
            <span className="text-[11px] font-bold text-slate-800 line-clamp-1">Découvrir</span>
            <span className="text-[9px] text-slate-400">Publiques</span>
          </Link>

          {/* Action 4: Portefeuille */}
          <Link
            href="/wallet"
            className="flex flex-col items-center justify-center p-3 rounded-2xl bg-white border border-slate-200/80 hover:border-teal-500 hover:bg-teal-50/40 active:scale-95 transition-all text-center group shadow-2xs"
          >
            <div className="w-10 h-10 rounded-xl bg-teal-100/80 text-teal-900 flex items-center justify-center mb-1.5 group-hover:scale-105 transition-transform">
              <span className="material-symbols-outlined text-[20px]">account_balance_wallet</span>
            </div>
            <span className="text-[11px] font-bold text-slate-800 line-clamp-1">Portefeuille</span>
            <span className="text-[9px] text-slate-400">Finances</span>
          </Link>
        </div>
      </div>

      {/* ── 4. APERÇU DE L'ACTIVITÉ DU MEMBRE (Statistiques réelles) ── */}
      <div className="grid grid-cols-3 gap-2 sm:gap-2.5">
        <div className="p-3 rounded-2xl bg-white border border-slate-200/80 shadow-2xs flex flex-col gap-0.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Tontines actives
          </span>
          <span className="text-lg font-extrabold text-slate-900">
            {statistics.activeSessionsCount}
          </span>
          <span className="text-[10px] text-emerald-700 font-semibold">
            {statistics.activeSessionsCount > 0 ? "Inscrit" : "Aucune"}
          </span>
        </div>

        <div className="p-3 rounded-2xl bg-white border border-slate-200/80 shadow-2xs flex flex-col gap-0.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Cotisations versées
          </span>
          <span className="text-lg font-extrabold text-emerald-800">
            {statistics.completedContributionsCount}
          </span>
          <span className="text-[10px] text-slate-500 font-semibold truncate">
            {wallet.formattedTotalContributed}
          </span>
        </div>

        <div className="p-3 rounded-2xl bg-white border border-slate-200/80 shadow-2xs flex flex-col gap-0.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Amendes
          </span>
          <span
            className={`text-lg font-extrabold ${
              statistics.unpaidFinesCount > 0 ? "text-red-600" : "text-emerald-700"
            }`}
          >
            {statistics.unpaidFinesCount}
          </span>
          <span className="text-[10px] text-slate-500 font-semibold">
            {statistics.unpaidFinesCount > 0 ? "À régulariser" : "Impeccable ✨"}
          </span>
        </div>
      </div>

      {/* ── 5. MA PROCHAINE COTISATION (Échéance imminente ou Empty State) ── */}
      <div>
        <div className="flex items-center justify-between mb-2 px-0.5">
          <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
            Ma prochaine cotisation
          </h2>
          {nextContribution && (
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                nextContribution.isOverdue
                  ? "bg-red-100 text-red-800"
                  : "bg-emerald-100 text-emerald-900"
              }`}
            >
              {nextContribution.isOverdue ? "En retard" : "Échéance à venir"}
            </span>
          )}
        </div>

        {nextContribution ? (
          <div
            className={`rounded-2xl p-4 sm:p-5 border-2 shadow-xs transition-all ${
              nextContribution.isOverdue
                ? "bg-red-50/60 border-red-300"
                : "bg-white border-emerald-600/30"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <h3 className="font-extrabold text-slate-900 text-sm sm:text-base">
                    {nextContribution.sessionTitle}
                  </h3>
                  {nextContribution.isPrivate && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 text-[10px] font-extrabold">
                      Privée
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-600 mt-0.5">
                  Nom : <strong>{nextContribution.beneficiaryName}</strong>
                </p>
                <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[16px] text-slate-400">
                    event
                  </span>
                  <span>{nextContribution.formattedDueDate}</span>
                </p>
              </div>

              <div className="text-right flex-shrink-0">
                <span className="text-[10px] font-bold uppercase text-slate-400 block">
                  Montant
                </span>
                <span className="text-base sm:text-lg font-extrabold text-emerald-800">
                  {nextContribution.formattedAmount}
                </span>
              </div>
            </div>

            <div className="mt-3.5 pt-3 border-t border-slate-200/80 flex items-center justify-between gap-2">
              <span className="text-xs text-slate-500 font-medium">
                {nextContribution.isOverdue
                  ? "Veuillez cotiser pour éviter les pénalités de retard."
                  : "Votre tour de cotisation est programmé."}
              </span>
              <Link
                href={`/sessions/${nextContribution.sessionId}`}
                className="px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 active:scale-95 text-white font-bold text-xs flex items-center gap-1 transition-all shadow-xs flex-shrink-0"
              >
                <span>Cotiser</span>
                <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
              </Link>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-2xs text-center flex flex-col items-center">
            <div className="relative w-24 h-24 mb-3">
              <Image
                src="/images/no-upcoming-payment.png"
                alt="Aucune cotisation prévue"
                fill
                sizes="96px"
                className="object-contain"
              />
            </div>
            <h3 className="font-extrabold text-slate-900 text-sm">
              Aucune cotisation prévue pour le moment
            </h3>
            <p className="text-xs text-slate-500 max-w-xs mt-1">
              Toutes vos cotisations sont à jour ou vos sessions sont en cours d&apos;organisation.
            </p>
          </div>
        )}
      </div>

      {/* ── 6. MES TONTINES (Cards ou Empty State avec image) ── */}
      <div>
        <div className="flex items-center justify-between mb-2 px-0.5">
          <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
            Mes cotisations ({sessions.length})
          </h2>
          <Link
            href="/sessions"
            className="text-xs font-bold text-emerald-700 hover:text-emerald-800 flex items-center gap-0.5"
          >
            <span>Voir tout</span>
            <span className="material-symbols-outlined text-[14px]">chevron_right</span>
          </Link>
        </div>

        {sessions.length === 0 ? (
          <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-2xs text-center flex flex-col items-center">
            <div className="relative w-28 h-28 mb-3">
              <Image
                src="/images/empty-tontines.png"
                alt="Aucune cotisation"
                fill
                sizes="112px"
                className="object-contain"
              />
            </div>
            <h3 className="font-extrabold text-slate-900 text-sm">
              Vous ne participez encore à aucune tontine
            </h3>
            <p className="text-xs text-slate-500 max-w-xs mt-1 mb-4">
              Rejoignez une cotisation publique pour épargner en communauté, ou créez votre propre cotisation privée.
            </p>
            <div className="flex items-center gap-2 flex-wrap justify-center w-full max-w-xs">
              <Link
                href="/sessions"
                className="flex-1 py-2 px-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs active:scale-95 transition-all text-center"
              >
                Découvrir les tontines
              </Link>
              <Link
                href="/private-tontines"
                className="flex-1 py-2 px-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 font-bold text-xs active:scale-95 transition-all text-center"
              >
                Créer une tontine
              </Link>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {sessions.map((s) => (
              <Link
                key={s.id}
                href={`/sessions/${s.id}`}
                className="p-3.5 sm:p-4 rounded-2xl bg-white border border-slate-200/80 hover:border-emerald-600/40 active:scale-[0.99] transition-all shadow-2xs flex items-center justify-between gap-3 group"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h3 className="text-sm font-extrabold text-slate-900 group-hover:text-emerald-800 transition-colors">
                      {s.title}
                    </h3>
                    {s.isPrivate && (
                      <span className="px-1.5 py-0.2 rounded bg-amber-100 text-amber-900 text-[9px] font-extrabold">
                        Privée
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                    <span className="font-extrabold text-slate-900 font-numeric-data">
                      {s.formattedTotal}
                    </span>
                    <span>•</span>
                    <span className="text-emerald-800 font-semibold">{s.statusLabel}</span>
                    <span>•</span>
                    <span>{s.userSlotsCount} nom(s)</span>
                  </p>
                </div>
                <div className="flex items-center gap-1 text-slate-400 group-hover:text-emerald-700 transition-colors">
                  <span className="material-symbols-outlined text-[20px]">chevron_right</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* ── 7. RAPPEL PRÊT D'URGENCE (Si actif ou éligible) ── */}
      {loan.activeLoan ? (
        <div className="p-4 rounded-2xl bg-amber-50/80 border-2 border-amber-300 shadow-2xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-200 text-amber-950 flex items-center justify-center flex-shrink-0">
              <span className="material-symbols-outlined text-[22px]">emergency</span>
            </div>
            <div>
              <span className="text-[10px] font-extrabold uppercase text-amber-800 block">
                Prêt en cours
              </span>
              <p className="text-sm font-extrabold text-slate-900">
                Reste dû : {loan.activeLoan.remainingDue.toLocaleString("fr-FR")} FCFA
              </p>
            </div>
          </div>
          <Link
            href="/loans"
            className="py-1.5 px-3 rounded-xl bg-amber-700 hover:bg-amber-800 text-white font-bold text-xs flex items-center gap-1 active:scale-95 transition-all shadow-xs flex-shrink-0"
          >
            <span>Rembourser</span>
            <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
          </Link>
        </div>
      ) : loan.eligible && loan.maxAllowed >= 1000 ? (
        <div className="p-3.5 rounded-2xl bg-emerald-50/70 border border-emerald-200/80 shadow-2xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-emerald-700 text-[22px]">health_and_safety</span>
            <div>
              <p className="text-xs font-bold text-emerald-950">
                Prêt d&apos;urgence garanti disponible
              </p>
              <p className="text-[11px] text-emerald-700">
                Plafond disponible jusqu&apos;à {loan.maxAllowed.toLocaleString("fr-FR")} FCFA
              </p>
            </div>
          </div>
          <Link
            href="/loans"
            className="py-1.5 px-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs active:scale-95 transition-all flex-shrink-0"
          >
            Vérifier
          </Link>
        </div>
      ) : null}

      {/* ── 8. ACTIVITÉS RÉCENTES (Transactions réelles ou Empty State avec image) ── */}
      <div>
        <div className="flex items-center justify-between mb-2 px-0.5">
          <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
            Activités récentes
          </h2>
          <Link
            href="/wallet"
            className="text-xs font-bold text-emerald-700 hover:text-emerald-800 flex items-center gap-0.5"
          >
            <span>Historique</span>
            <span className="material-symbols-outlined text-[14px]">chevron_right</span>
          </Link>
        </div>

        {recentTransactions.length === 0 ? (
          <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-2xs text-center flex flex-col items-center">
            <div className="relative w-24 h-24 mb-3">
              <Image
                src="/images/empty-wallet.png"
                alt="Aucune opération"
                fill
                sizes="96px"
                className="object-contain"
              />
            </div>
            <h3 className="font-extrabold text-slate-900 text-sm">
              Vos dernières opérations apparaîtront ici
            </h3>
            <p className="text-xs text-slate-500 max-w-xs mt-1">
              Recharges, versements et retraits s&apos;afficheront dès vos premiers mouvements.
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200/80 divide-y divide-slate-100 shadow-2xs overflow-hidden">
            {recentTransactions.map((op) => {
              const isIncome = op.direction === "IN";
              return (
                <div key={op.id} className="p-3.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                        isIncome
                          ? "bg-emerald-100/80 text-emerald-800"
                          : "bg-red-50 text-red-700"
                      }`}
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        {isIncome ? "arrow_downward" : "arrow_upward"}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900 truncate">{op.title}</p>
                      <p className="text-[11px] text-slate-400 truncate">{op.date}</p>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <span
                      className={`text-xs font-extrabold font-numeric-data ${
                        isIncome ? "text-emerald-700" : "text-slate-900"
                      }`}
                    >
                      {op.formattedAmount}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── 9. NOTIFICATIONS & ANNONCES RÉCENTES (Si existantes) ── */}
      {notifications.length > 0 && (
        <div>
          <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 mb-2 px-0.5">
            Annonces & Notifications
          </h2>
          <div className="flex flex-col gap-2">
            {notifications.map((n) => (
              <Link
                key={n.id}
                href={n.link || "/notifications"}
                className="p-3 rounded-2xl bg-white border border-slate-200/80 hover:border-emerald-600/40 active:scale-[0.99] transition-all shadow-2xs flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="material-symbols-outlined text-emerald-700 text-[20px] flex-shrink-0">
                    notifications
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-800 line-clamp-1">{n.message}</p>
                    <p className="text-[10px] text-slate-400">{n.date}</p>
                  </div>
                </div>
                <span className="material-symbols-outlined text-slate-400 text-[18px] flex-shrink-0">
                  chevron_right
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
