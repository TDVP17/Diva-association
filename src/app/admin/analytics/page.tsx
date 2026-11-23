import { redirect } from "next/navigation";
import { getLang } from "@/lib/i18n/get-lang";
import { requirePresident } from "@/lib/require-admin";
import { getRevenueAnalytics } from "@/lib/analytics";
import { formatXAF } from "@/lib/format-currency";

export default async function AdminAnalyticsPage() {
  const president = await requirePresident();
  if (!president) redirect("/admin");
  const lang = await getLang();

  const data = await getRevenueAnalytics();

  return (
    <main className="px-container-padding pt-stack-gap-lg pb-32 max-w-5xl mx-auto w-full flex flex-col gap-8">
      {/* ── Titre de la page ── */}
      <div>
        <h2 className="font-headline-lg-mobile text-headline-lg-mobile md:font-headline-lg md:text-headline-lg text-primary">
          {lang === "fr" ? "Analyse financière & Revenus" : "Revenue & Financial Analytics"}
        </h2>
        <p className="text-on-surface-variant font-body-lg mt-1 text-sm sm:text-base">
          {lang === "fr"
            ? "Suivi en temps réel des flux financiers : cotisations publiques, cotisations privées et solde des portefeuilles."
            : "Real-time tracking of financial flows: public cotisations, private cotisations, and member wallets."}
        </p>
      </div>

      {/* ── SECTION 1 : PORTEFEUILLE DES MEMBRES & FLUX ── */}
      <section className="flex flex-col gap-4">
        <div className="bg-gradient-to-r from-emerald-900 via-[#064e3b] to-emerald-950 text-white rounded-3xl p-6 sm:p-7 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4 border border-emerald-800">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center flex-shrink-0">
              <span className="material-symbols-outlined text-3xl text-emerald-300">account_balance_wallet</span>
            </div>
            <div>
              <p className="text-xs font-semibold text-emerald-200 uppercase tracking-wider">
                {lang === "fr" ? "Solde total disponible dans les portefeuilles" : "Total Available Wallet Balance"}
              </p>
              <p className="text-2xl sm:text-3xl font-extrabold tracking-tight mt-0.5">
                {formatXAF(data.wallet.totalBalance)}
              </p>
              <p className="text-[11px] text-emerald-300/80 mt-0.5">
                {lang === "fr"
                  ? `Fonds actuellement détenus par les membres (${data.wallet.membersWithBalance.length} compte(s) avec solde positif)`
                  : `Funds currently held by members (${data.wallet.membersWithBalance.length} account(s) with positive balance)`}
              </p>
            </div>
          </div>
        </div>

        {/* Sous-cartes des flux de portefeuille */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Cagnottes & Recharges versées sur portefeuilles */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 flex flex-col justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm text-emerald-600">arrow_downward</span>
              {lang === "fr" ? "Crédits portefeuilles (Bouffes / Recharges)" : "Total Credited to Wallets"}
            </span>
            <p className="text-xl sm:text-2xl font-extrabold text-emerald-800 mt-2">
              {formatXAF(data.wallet.totalCredited)}
            </p>
            <span className="text-[10px] text-slate-400 mt-1">
              {lang === "fr" ? "Cagnottes bouffées et recharges versées" : "Pots won and deposits credited"}
            </span>
          </div>

          {/* Retraits vers MOMO / OM */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 flex flex-col justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm text-rose-600">arrow_upward</span>
              {lang === "fr" ? "Retraits vers Orange / MTN Money" : "Withdrawals to Mobile Money"}
            </span>
            <p className="text-xl sm:text-2xl font-extrabold text-rose-700 mt-2">
              {formatXAF(data.wallet.totalWithdrawn)}
            </p>
            <span className="text-[10px] text-slate-400 mt-1">
              {lang === "fr" ? "Retraits effectués par les membres" : "Funds withdrawn to external accounts"}
            </span>
          </div>

          {/* Cotisations payées depuis le portefeuille */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 flex flex-col justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm text-blue-600">sync_alt</span>
              {lang === "fr" ? "Cotisé depuis le portefeuille" : "Contributed from Wallet"}
            </span>
            <p className="text-xl sm:text-2xl font-extrabold text-blue-800 mt-2">
              {formatXAF(data.wallet.totalContributed)}
            </p>
            <span className="text-[10px] text-slate-400 mt-1">
              {lang === "fr" ? "Cotisations réglées avec le solde" : "Contributions paid using wallet balance"}
            </span>
          </div>
        </div>

        {/* Détail des comptes ayant un solde actif */}
        {data.wallet.membersWithBalance.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
            <h4 className="text-xs font-bold text-slate-500 uppercase mb-3">
              {lang === "fr" ? "Membres avec solde disponible sur portefeuille" : "Members with available wallet balance"}
            </h4>
            <div className="flex flex-wrap gap-2">
              {data.wallet.membersWithBalance.map((m) => (
                <div
                  key={m.id}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-950 font-semibold"
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span>{m.name}</span>
                  {m.phone && <span className="text-emerald-700/80 text-[11px]">({m.phone})</span>}
                  <span className="font-extrabold text-emerald-800 ml-1">{formatXAF(m.balance)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── SECTION 2 : COTISATIONS PUBLIQUES ── */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-emerald-600" />
          <h3 className="font-bold text-lg text-slate-900">
            {lang === "fr" ? "Cotisations Publiques (Frais opérateur 3,1%)" : "Public Cotisations (3.1% Operator Fee)"}
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Total argent entré */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 flex flex-col justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase">
              {lang === "fr" ? "Total argent entré" : "Total Money Received"}
            </span>
            <p className="text-xl sm:text-2xl font-extrabold text-emerald-800 mt-2">
              {formatXAF(data.public.totalMoneyIn)}
            </p>
            <span className="text-[10px] text-slate-400 mt-1">
              {lang === "fr" ? "Cotisations versées par les membres" : "Contributions paid by members"}
            </span>
          </div>

          {/* Total argent sorti */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 flex flex-col justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase">
              {lang === "fr" ? "Total argent sorti" : "Total Money Paid Out"}
            </span>
            <p className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-2">
              {formatXAF(data.public.totalMoneyOut)}
            </p>
            <span className="text-[10px] text-slate-400 mt-1">
              {lang === "fr" ? "Cagnottes versées aux bénéficiaires" : "Pots released to beneficiaries"}
            </span>
          </div>

          {/* Frais cotisations entrés */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 flex flex-col justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase">
              {lang === "fr" ? "Total frais entrés" : "Total Service Fees In"}
            </span>
            <p className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-2">
              {formatXAF(data.public.totalFeesIn)}
            </p>
            <span className="text-[10px] text-slate-400 mt-1">
              {lang === "fr" ? "Frais perçus sur les sessions publiques" : "Fees collected on public sessions"}
            </span>
          </div>

          {/* Frais sortis (3,1% opérateur) */}
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 flex flex-col justify-between">
            <span className="text-xs font-bold text-slate-500 uppercase">
              {lang === "fr" ? "Frais sortis (Fapshi 3,1%)" : "Operator Fees Out (3.1%)"}
            </span>
            <p className="text-xl sm:text-2xl font-extrabold text-amber-700 mt-2">
              {formatXAF(data.public.totalFeesOut)}
            </p>
            <span className="text-[10px] text-slate-400 mt-1">
              {lang === "fr" ? "Coût opérateur Orange / MTN" : "Operator processing cost"}
            </span>
          </div>

          {/* Reste Frais Admin */}
          <div className="bg-emerald-50/80 rounded-2xl shadow-sm border border-emerald-200 p-4 flex flex-col justify-between">
            <span className="text-xs font-bold text-emerald-800 uppercase">
              {lang === "fr" ? "Reste Frais Admin" : "Admin Net Fees Rest"}
            </span>
            <p className="text-xl sm:text-2xl font-extrabold text-emerald-900 mt-2">
              {formatXAF(data.public.resteFraisAdmin)}
            </p>
            <span className="text-[10px] text-emerald-700 mt-1">
              {lang === "fr" ? "Marge nette conservée par l'association" : "Net margin retained by DIVA Asso"}
            </span>
          </div>
        </div>
      </section>

      {/* ── SECTION 3 : COTISATIONS PRIVÉES ── */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-indigo-600" />
          <h3 className="font-bold text-lg text-slate-900">
            {lang === "fr" ? "Cotisations Privées (Frais 5,1% · Marge DIVA Asso 2%)" : "Private Cotisations (5.1% Fee · DIVA Asso Margin 2%)"}
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Total argent entré */}
          <div className="bg-white rounded-2xl shadow-sm border border-indigo-100 p-4 flex flex-col justify-between">
            <span className="text-xs font-bold text-indigo-700 uppercase">
              {lang === "fr" ? "Total argent entré" : "Total Money Received"}
            </span>
            <p className="text-xl sm:text-2xl font-extrabold text-indigo-950 mt-2">
              {formatXAF(data.private.totalMoneyIn)}
            </p>
            <span className="text-[10px] text-slate-400 mt-1">
              {lang === "fr" ? "Souscrit à 5,1% de frais" : "Subscribed with 5.1% fee"}
            </span>
          </div>

          {/* Total argent sorti */}
          <div className="bg-white rounded-2xl shadow-sm border border-indigo-100 p-4 flex flex-col justify-between">
            <span className="text-xs font-bold text-indigo-700 uppercase">
              {lang === "fr" ? "Total argent sorti" : "Total Paid to Members"}
            </span>
            <p className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-2">
              {formatXAF(data.private.totalMoneyOut)}
            </p>
            <span className="text-[10px] text-slate-400 mt-1">
              {lang === "fr" ? "En fonction de ce que chacun doit bouffer" : "According to member turns"}
            </span>
          </div>

          {/* Marge DIVA Asso 2% */}
          <div className="bg-indigo-50/70 rounded-2xl shadow-sm border border-indigo-200 p-4 flex flex-col justify-between">
            <span className="text-xs font-extrabold text-indigo-800 uppercase flex items-center gap-1">
              <span className="material-symbols-outlined text-[15px]">savings</span>
              <span>{lang === "fr" ? "Marge DIVA Asso (2%)" : "DIVA Asso Margin (2%)"}</span>
            </span>
            <p className="text-xl sm:text-2xl font-extrabold text-indigo-900 mt-2">
              {formatXAF(data.private.divaMargin2Percent)}
            </p>
            <span className="text-[10px] text-indigo-700 mt-1">
              {lang === "fr" ? "5,1% payé - 3,1% Fapshi = 2% net DIVA Asso" : "5.1% paid - 3.1% gateway = 2% net"}
            </span>
          </div>

          {/* Reste créateur / solde disponible */}
          <div className="bg-white rounded-2xl shadow-sm border border-indigo-100 p-4 flex flex-col justify-between">
            <span className="text-xs font-bold text-indigo-700 uppercase">
              {lang === "fr" ? "Reste créateur" : "Creator Balance"}
            </span>
            <p className="text-xl sm:text-2xl font-extrabold text-emerald-800 mt-2">
              {formatXAF(data.private.adminRest)}
            </p>
            <span className="text-[10px] text-slate-400 mt-1">
              {lang === "fr" ? "Solde non encore décaissé revenant au créateur" : "Remaining available balance due to creator"}
            </span>
          </div>
        </div>
      </section>

      {/* ── SECTION 4 : AMENDES & PAIEMENTS GLOBAUX ── */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
          <p className="text-xs font-bold text-slate-500 uppercase">{lang === "fr" ? "Amendes collectées" : "Fines Collected"}</p>
          <p className="text-xl font-bold text-slate-900 mt-1">{formatXAF(data.totalFines)}</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
          <p className="text-xs font-bold text-slate-500 uppercase">{lang === "fr" ? "Amendes impayées" : "Unpaid Fines"}</p>
          <p className="text-xl font-bold text-red-600 mt-1">{formatXAF(data.totalUnpaidFines)}</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
          <p className="text-xs font-bold text-slate-500 uppercase">{lang === "fr" ? "Paiements réussis" : "Successful Payments"}</p>
          <p className="text-xl font-bold text-emerald-700 mt-1">{data.totalSuccessfulPayments}</p>
        </div>
      </section>

      {/* ── SECTION 5 : TABLEAU DÉTAILLÉ PAR COTISATION ── */}
      <section className="flex flex-col gap-3">
        <h3 className="font-bold text-lg text-slate-900">
          {lang === "fr" ? "Détail par cotisation" : "Per-Cotisation Breakdown"}
        </h3>

        {data.sessions.length === 0 ? (
          <p className="text-xs text-slate-500 italic">
            {lang === "fr" ? "Aucune cotisation enregistrée pour le moment." : "No cotisations recorded yet."}
          </p>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-x-auto">
            <table className="w-full text-left min-w-[760px] text-xs">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="p-3.5 font-bold text-slate-700">{lang === "fr" ? "Cotisation" : "Title"}</th>
                  <th className="p-3.5 font-bold text-slate-700">{lang === "fr" ? "Type" : "Type"}</th>
                  <th className="p-3.5 font-bold text-slate-700">{lang === "fr" ? "Argent entré" : "Money In"}</th>
                  <th className="p-3.5 font-bold text-slate-700">{lang === "fr" ? "Argent sorti" : "Money Out"}</th>
                  <th className="p-3.5 font-bold text-slate-700">{lang === "fr" ? "Frais perçus" : "Fees"}</th>
                  <th className="p-3.5 font-bold text-slate-700">{lang === "fr" ? "Marge DIVA" : "Diva Margin"}</th>
                  <th className="p-3.5 font-bold text-slate-700">{lang === "fr" ? "Amendes" : "Fines"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.sessions.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="p-3.5 font-bold text-slate-900">{s.title}</td>
                    <td className="p-3.5">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          s.isPrivate
                            ? "bg-indigo-100 text-indigo-800 border border-indigo-200"
                            : "bg-emerald-100 text-emerald-800 border border-emerald-200"
                        }`}
                      >
                        {s.isPrivate ? (lang === "fr" ? "Privée (5,1%)" : "Private (5.1%)") : (lang === "fr" ? "Publique (3,1%)" : "Public (3.1%)")}
                      </span>
                    </td>
                    <td className="p-3.5 font-mono font-bold text-emerald-800">{formatXAF(s.moneyIn)}</td>
                    <td className="p-3.5 font-mono text-slate-700">{formatXAF(s.moneyOut)}</td>
                    <td className="p-3.5 font-mono text-slate-700">{formatXAF(s.fees)}</td>
                    <td className="p-3.5 font-mono font-bold text-indigo-700">{formatXAF(s.divaMargin)}</td>
                    <td className="p-3.5 font-mono text-slate-700">{formatXAF(s.fines)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
