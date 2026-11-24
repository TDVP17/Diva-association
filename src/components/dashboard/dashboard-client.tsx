"use client";

import Link from "next/link";
import Image from "next/image";
import { type Lang } from "@/lib/i18n/translations";
import type { DashboardSummaryData } from "@/lib/dashboard";

export function DashboardClient({
  data,
  lang,
  accessDeniedError = false,
}: {
  data: DashboardSummaryData;
  lang: Lang;
  accessDeniedError?: boolean;
}) {
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
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-extrabold text-[#003528] tracking-tight flex items-center gap-1.5">
            <span>Coucou mon Asso</span>
            <span className="text-xl">🌿</span>
          </h1>
          <p className="text-[11px] font-bold text-[#025b34] mt-0.5">
            Votre espace solidaire &amp; financier sécurisé
          </p>
        </div>

        {/* Badge Étoiles Confiance */}
        <Link
          href="/loans"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#efc25b]/20 border border-[#efc25b] hover:bg-[#efc25b]/30 transition-colors flex-shrink-0 shadow-2xs"
          title="Score de Confiance DIVA Asso"
        >
          <span className="material-symbols-outlined text-[#efc25b] text-[18px]">star</span>
          <span className="text-xs font-black text-[#003528]">{member.stars}/5</span>
        </Link>
      </div>

      {/* ── 2. ACTIONS RAPIDES (Quick Access 4 Grids) ── */}
      <div>
        <h2 className="text-xs font-extrabold uppercase tracking-wider text-[#025b34] mb-2.5 px-0.5 flex items-center gap-1">
          <span className="material-symbols-outlined text-[15px] text-[#efc25b]">bolt</span>
          <span>Actions rapides</span>
        </h2>
        <div className="grid grid-cols-4 gap-2 sm:gap-2.5">
          {/* Action 1: Créer cotisation privée */}
          <Link
            href="/private-tontines"
            className="flex flex-col items-center justify-center p-3 rounded-2xl bg-gradient-to-b from-white to-[#efc25b]/10 border border-[#efc25b]/40 hover:border-[#efc25b] active:scale-95 transition-all text-center group shadow-2xs"
          >
            <div className="w-10 h-10 rounded-xl bg-[#efc25b]/25 text-[#003528] flex items-center justify-center mb-1.5 group-hover:scale-105 transition-transform">
              <span className="material-symbols-outlined text-[20px]">add_moderator</span>
            </div>
            <span className="text-[11px] font-extrabold text-slate-800 line-clamp-1">Créer</span>
            <span className="text-[9px] text-[#025b34] font-semibold">Cotis. privée</span>
          </Link>

          {/* Action 2: Cotiser */}
          <Link
            href="/sessions"
            className="flex flex-col items-center justify-center p-3 rounded-2xl bg-gradient-to-b from-white to-[#025b34]/10 border border-[#025b34]/30 hover:border-[#025b34] active:scale-95 transition-all text-center group shadow-2xs"
          >
            <div className="w-10 h-10 rounded-xl bg-[#025b34] text-white flex items-center justify-center mb-1.5 group-hover:scale-105 transition-transform shadow-xs">
              <span className="material-symbols-outlined text-[20px]">payments</span>
            </div>
            <span className="text-[11px] font-extrabold text-slate-800 line-clamp-1">Cotiser</span>
            <span className="text-[9px] text-[#025b34] font-semibold">Session</span>
          </Link>

          {/* Action 3: Découvrir cotisations publiques */}
          <Link
            href="/sessions"
            className="flex flex-col items-center justify-center p-3 rounded-2xl bg-gradient-to-b from-white to-[#025b34]/5 border border-slate-200 hover:border-[#025b34] active:scale-95 transition-all text-center group shadow-2xs"
          >
            <div className="w-10 h-10 rounded-xl bg-[#003528]/10 text-[#003528] flex items-center justify-center mb-1.5 group-hover:scale-105 transition-transform">
              <span className="material-symbols-outlined text-[20px]">explore</span>
            </div>
            <span className="text-[11px] font-extrabold text-slate-800 line-clamp-1">Découvrir</span>
            <span className="text-[9px] text-slate-500 font-medium">Publiques</span>
          </Link>

          {/* Action 4: Portefeuille */}
          <Link
            href="/wallet"
            className="flex flex-col items-center justify-center p-3 rounded-2xl bg-gradient-to-b from-white to-[#efc25b]/15 border border-[#efc25b]/45 hover:border-[#efc25b] active:scale-95 transition-all text-center group shadow-2xs"
          >
            <div className="w-10 h-10 rounded-xl bg-[#003528] text-[#efc25b] flex items-center justify-center mb-1.5 group-hover:scale-105 transition-transform shadow-xs">
              <span className="material-symbols-outlined text-[20px]">account_balance_wallet</span>
            </div>
            <span className="text-[11px] font-extrabold text-slate-800 line-clamp-1">Portefeuille</span>
            <span className="text-[9px] text-[#025b34] font-bold">Finances</span>
          </Link>
        </div>
      </div>

      {/* ── 3. APERÇU DE L'ACTIVITÉ DU MEMBRE (Statistiques réelles - Liens cliquables) ── */}
      <div className="grid grid-cols-2 gap-2 sm:gap-2.5">
        <Link
          href="/sessions"
          className="p-3.5 rounded-2xl bg-gradient-to-br from-white to-[#025b34]/5 border border-[#025b34]/30 shadow-2xs flex flex-col gap-0.5 hover:border-[#025b34] active:scale-95 transition-all group cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#025b34]">
              Tontines actives
            </span>
            <span className="material-symbols-outlined text-[#025b34] group-hover:translate-x-0.5 text-sm transition-transform">
              arrow_forward
            </span>
          </div>
          <span className="text-xl font-black text-[#003528]">
            {statistics.activeSessionsCount}
          </span>
          <span className="text-[10px] text-[#025b34] font-extrabold">
            {statistics.activeSessionsCount > 0 ? "Inscrit" : "Aucune"}
          </span>
        </Link>

        <Link
          href="/fines"
          className="p-3.5 rounded-2xl bg-gradient-to-br from-white to-amber-50/30 border border-slate-200/90 shadow-2xs flex flex-col gap-0.5 hover:border-amber-400 active:scale-95 transition-all group cursor-pointer"
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Amendes impayées
            </span>
            <span className="material-symbols-outlined text-slate-400 group-hover:text-amber-700 text-sm transition-colors">
              arrow_forward
            </span>
          </div>
          <span
            className={`text-xl font-black ${
              statistics.unpaidFinesCount > 0 ? "text-red-600" : "text-[#025b34]"
            }`}
          >
            {statistics.unpaidFinesCount}
          </span>
          <span className="text-[10px] text-slate-500 font-semibold">
            {statistics.unpaidFinesCount > 0 ? "À régulariser" : "Impeccable ✨"}
          </span>
        </Link>
      </div>

      {/* ── 4. MA PROCHAINE COTISATION (Échéance imminente ou Empty State) ── */}
      <div>
        <div className="flex items-center justify-between mb-2 px-0.5">
          <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-600">
            Ma prochaine cotisation
          </h2>
          {nextContribution && (
            <span
              className={`px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase ${
                nextContribution.isOverdue
                  ? "bg-red-100 text-red-800"
                  : "bg-[#025b34]/10 text-[#025b34] border border-[#025b34]/20"
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
                : "bg-gradient-to-br from-white via-emerald-50/30 to-[#025b34]/5 border-[#025b34]/40"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <h3 className="font-extrabold text-[#003528] text-sm sm:text-base">
                    {nextContribution.sessionTitle}
                  </h3>
                  {nextContribution.isPrivate && (
                    <span className="px-1.5 py-0.5 rounded bg-[#efc25b]/20 text-[#003528] border border-[#efc25b]/60 text-[10px] font-extrabold">
                      Privée
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-600 mt-0.5">
                  Nom : <strong>{nextContribution.beneficiaryName}</strong>
                </p>
                <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[16px] text-[#025b34]">
                    event
                  </span>
                  <span>{nextContribution.formattedDueDate}</span>
                </p>
              </div>

              <div className="text-right flex-shrink-0">
                <span className="text-[10px] font-bold uppercase text-slate-500 block">
                  Montant
                </span>
                <span className="text-base sm:text-lg font-black text-[#025b34]">
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
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-[#025b34] to-[#003528] hover:opacity-95 active:scale-95 text-white font-bold text-xs flex items-center gap-1 transition-all shadow-xs border border-[#efc25b]/30 flex-shrink-0"
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

      {/* ── 5. MES TONTINES (Cards ou Empty State avec image) ── */}
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

      {/* ── 6. RAPPEL PRÊT D'URGENCE (Si actif ou éligible) ── */}
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

      {/* ── 7. ACTIVITÉS RÉCENTES (Transactions réelles ou Empty State avec image) ── */}
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

      {/* ── 8. NOTIFICATIONS & ANNONCES RÉCENTES (Si existantes) ── */}
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
