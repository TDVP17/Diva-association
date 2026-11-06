"use client";

import { useState, useEffect } from "react";
import { type Lang } from "@/lib/i18n/translations";

interface SecurityLog {
  id: string;
  type: string;
  emailEssaye: string | null;
  ip: string | null;
  userAgent: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

interface AppSetting {
  id: string;
  isLocked: boolean;
  lockedAt: string | null;
  lockedBy: string | null;
  lockReason: string | null;
}

interface SecurityStats {
  recent24hFailures: number;
  blockedCount: number;
  isLocked: boolean;
}

const EVENT_TYPE_BADGES: Record<string, { label: string; color: string; icon: string }> = {
  login_failed: { label: "Échec connexion", color: "bg-amber-100 text-amber-800 border-amber-300", icon: "lock_open" },
  admin_attempt: { label: "Cible Admin", color: "bg-orange-100 text-orange-800 border-orange-300", icon: "shield_person" },
  injection_attempt: { label: "Injection SQL bloquée", color: "bg-red-100 text-red-800 border-red-300 font-bold", icon: "security" },
  unauthorized_session_access: { label: "Cotisation d'autrui", color: "bg-purple-100 text-purple-800 border-purple-300", icon: "no_accounts" },
  unauthorized_api_access: { label: "API non autorisée", color: "bg-purple-100 text-purple-800 border-purple-300", icon: "api" },
  unauthorized_payment_attempt: { label: "Paiement frauduleux", color: "bg-rose-100 text-rose-800 border-rose-300", icon: "credit_card_off" },
  admin_alert_sent: { label: "Alerte Email envoyée", color: "bg-blue-100 text-blue-800 border-blue-300", icon: "mark_email_read" },
  ip_blocked: { label: "IP Bloquée (30 min)", color: "bg-red-200 text-red-900 border-red-400 font-bold", icon: "block" },
  emergency_lock_activated: { label: "Panique : Verrouillé", color: "bg-red-600 text-white border-red-700 font-bold", icon: "lock" },
  emergency_lock_deactivated: { label: "Déverrouillé", color: "bg-emerald-100 text-emerald-800 border-emerald-300", icon: "lock_open" },
};

export function SecurityDashboardClient({ lang }: { lang: Lang }) {
  const [logs, setLogs] = useState<SecurityLog[]>([]);
  const [appSetting, setAppSetting] = useState<AppSetting>({
    id: "singleton",
    isLocked: false,
    lockedAt: null,
    lockedBy: null,
    lockReason: null,
  });
  const [stats, setStats] = useState<SecurityStats>({
    recent24hFailures: 0,
    blockedCount: 0,
    isLocked: false,
  });
  const [loading, setLoading] = useState(true);
  const [locking, setLocking] = useState(false);
  const [filterType, setFilterType] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [lockModalOpen, setLockModalOpen] = useState(false);
  const [lockReasonInput, setLockReasonInput] = useState("");

  const fetchData = async () => {
    try {
      const params = new URLSearchParams();
      if (filterType !== "all") params.set("type", filterType);
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      params.set("limit", "100");

      const res = await fetch(`/api/admin/security?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
        setAppSetting(data.appSetting || { id: "singleton", isLocked: false, lockedAt: null, lockedBy: null, lockReason: null });
        setStats(data.stats || { recent24hFailures: 0, blockedCount: 0, isLocked: false });
      }
    } catch (e) {
      console.error("Fetch security data error:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [filterType]);

  const handleToggleLock = async (targetLockedState: boolean, reason?: string) => {
    setLocking(true);
    try {
      const res = await fetch("/api/admin/security/lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isLocked: targetLockedState, reason }),
      });
      if (res.ok) {
        setLockModalOpen(false);
        setLockReasonInput("");
        await fetchData();
        alert(
          targetLockedState
            ? "🔒 L'APPLICATION A ÉTÉ VERROUILLÉE AVEC SUCCÈS.\nUn email de confirmation a été envoyé à l'administrateur."
            : "🔓 L'APPLICATION A ÉTÉ DÉVERROUILLÉE.\nLa plateforme et les paiements sont de nouveau accessibles."
        );
      } else {
        alert("Une erreur est survenue lors de l'opération.");
      }
    } catch (e) {
      console.error("Lock toggle error:", e);
      alert("Erreur réseau.");
    } finally {
      setLocking(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. SECTION BOUTON PANIQUE */}
      <div
        className={`rounded-2xl p-6 border-2 transition-all shadow-md ${
          appSetting.isLocked
            ? "bg-red-50 border-red-500 animate-pulse-subtle"
            : "bg-white border-slate-200"
        }`}
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <span className={`material-symbols-outlined text-[28px] ${appSetting.isLocked ? "text-red-600" : "text-slate-700"}`}>
                {appSetting.isLocked ? "lock" : "lock_open"}
              </span>
              <h2 className="text-xl font-bold text-slate-900">
                {appSetting.isLocked
                  ? "🔒 APPLICATION ACTUELLEMENT VERROUILLÉE"
                  : "🛡️ Bouton Panique — Verrouillage d'Urgence"}
              </h2>
            </div>
            <p className="text-sm text-slate-600 max-w-2xl leading-relaxed">
              {appSetting.isLocked ? (
                <>
                  L'application a été verrouillée le{" "}
                  <strong>
                    {appSetting.lockedAt
                      ? new Date(appSetting.lockedAt).toLocaleString("fr-FR", { timeZone: "Africa/Douala" })
                      : "récemment"}
                  </strong>{" "}
                  par <strong>{appSetting.lockedBy || "l'administrateur"}</strong>.
                  {appSetting.lockReason && (
                    <span className="block mt-1 text-red-800 font-medium">Motif : {appSetting.lockReason}</span>
                  )}
                  <span className="block mt-1 text-slate-700 font-semibold">
                    Tous les membres sont redirigés vers la page de maintenance et aucun paiement ne peut passer.
                  </span>
                </>
              ) : (
                "En cas d'attaque ou d'incident critique, verrouillez instantanément l'ensemble de l'application. Tous les paiements seront immédiatement bloqués côté serveur et les membres verront une page de maintenance."
              )}
            </p>
          </div>

          <div className="flex-shrink-0">
            {appSetting.isLocked ? (
              <button
                type="button"
                onClick={() => handleToggleLock(false)}
                disabled={locking}
                className="w-full md:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-base shadow-lg transition-all cursor-pointer"
              >
                <span className="material-symbols-outlined text-[22px]">lock_open</span>
                <span>{locking ? "Déverrouillage..." : "🔓 DÉVERROUILLER L'APPLICATION"}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setLockModalOpen(true)}
                disabled={locking}
                className="w-full md:w-auto inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-red-600 hover:bg-red-700 active:scale-95 text-white font-bold text-base shadow-lg transition-all cursor-pointer"
              >
                <span className="material-symbols-outlined text-[22px]">lock</span>
                <span>{locking ? "Verrouillage..." : "🔒 VERROUILLER TOUTE L'APPLICATION"}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* MODAL DE CONFIRMATION DU VERROUILLAGE */}
      {lockModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-red-200 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 text-red-600">
              <span className="material-symbols-outlined text-[32px]">warning</span>
              <h3 className="text-lg font-bold text-slate-900">Confirmer le verrouillage total ?</h3>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">
              Cette action est immédiate :
              <br />• Tous les paiements seront <strong>rejetés à 100%</strong> côté serveur.
              <br />• Tous les membres verront la page de verrouillage.
              <br />• Seul un administrateur connecté pourra déverrouiller.
              <br />• Un email d'audit sera envoyé à <strong>divaasso17@gmail.com</strong>.
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Motif du verrouillage (facultatif) :
              </label>
              <input
                type="text"
                value={lockReasonInput}
                onChange={(e) => setLockReasonInput(e.target.value)}
                placeholder="Ex: Maintenance de sécurité, attaque suspecte..."
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-red-500"
              />
            </div>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setLockModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 font-semibold text-sm hover:bg-slate-50 transition-colors"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => handleToggleLock(true, lockReasonInput)}
                disabled={locking}
                className="px-5 py-2 rounded-lg bg-red-600 text-white font-bold text-sm hover:bg-red-700 transition-colors shadow-md flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-[18px]">lock</span>
                <span>{locking ? "Verrouillage..." : "Oui, Verrouiller Maintenant"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. STATISTIQUES DE SÉCURITÉ */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-xs flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-[24px]">lock_reset</span>
          </div>
          <div>
            <p className="text-xs text-slate-500 font-medium">Échecs connexion (24h)</p>
            <p className="text-xl font-bold text-slate-900">{stats.recent24hFailures}</p>
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-xs flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-red-100 text-red-700 flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-[24px]">block</span>
          </div>
          <div>
            <p className="text-xs text-slate-500 font-medium">IP bloquées temporairement</p>
            <p className="text-xl font-bold text-slate-900">{stats.blockedCount}</p>
          </div>
        </div>

        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-xs flex items-center gap-3.5">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${appSetting.isLocked ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"}`}>
            <span className="material-symbols-outlined text-[24px]">{appSetting.isLocked ? "lock" : "verified_user"}</span>
          </div>
          <div>
            <p className="text-xs text-slate-500 font-medium">Statut de la plateforme</p>
            <p className={`text-sm font-bold ${appSetting.isLocked ? "text-red-700" : "text-emerald-700"}`}>
              {appSetting.isLocked ? "VERROUILLÉE" : "100% OPÉRATIONNELLE"}
            </p>
          </div>
        </div>
      </div>

      {/* 3. TABLEAU DES LOGS DE SÉCURITÉ */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[24px]">policy</span>
            <h3 className="font-bold text-lg text-slate-900">Journaux de Sécurité (Audit en temps réel)</h3>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-1.5 text-xs font-semibold bg-white text-slate-700"
            >
              <option value="all">Tous les événements</option>
              <option value="login_failed">Échecs de connexion</option>
              <option value="admin_attempt">Tentatives accès admin</option>
              <option value="injection_attempt">Injections SQL neutralisées</option>
              <option value="ip_blocked">IP Bloquées (Anti-Brute-Force)</option>
              <option value="admin_alert_sent">Alertes email envoyées</option>
              <option value="unauthorized_session_access">Tentatives accès cotisation autrui</option>
              <option value="unauthorized_payment_attempt">Tentatives paiement autrui</option>
              <option value="emergency_lock_activated">Verrouillage Panique activé</option>
              <option value="emergency_lock_deactivated">Déverrouillage</option>
            </select>

            <input
              type="text"
              placeholder="Rechercher IP, email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && fetchData()}
              className="border border-slate-300 rounded-lg px-3 py-1.5 text-xs bg-white text-slate-700 w-44"
            />

            <button
              type="button"
              onClick={fetchData}
              className="p-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 transition-colors"
              title="Actualiser"
            >
              <span className="material-symbols-outlined text-[18px]">refresh</span>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-500 text-sm">Chargement des journaux de sécurité...</div>
        ) : logs.length === 0 ? (
          <div className="p-12 text-center text-slate-500 text-sm">
            Aucun événement de sécurité enregistré pour ces critères.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase text-[11px]">
                <tr>
                  <th className="p-3">Type</th>
                  <th className="p-3">Cible / Email</th>
                  <th className="p-3">Adresse IP</th>
                  <th className="p-3">Date & Heure (Cameroun)</th>
                  <th className="p-3">Navigateur / User-Agent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.map((log) => {
                  const badge = EVENT_TYPE_BADGES[log.type] || {
                    label: log.type,
                    color: "bg-slate-100 text-slate-800 border-slate-300",
                    icon: "info",
                  };
                  const dateStr = new Date(log.createdAt).toLocaleString("fr-FR", {
                    timeZone: "Africa/Douala",
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  });
                  return (
                    <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="p-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] border ${badge.color}`}
                        >
                          <span className="material-symbols-outlined text-[14px]">{badge.icon}</span>
                          <span>{badge.label}</span>
                        </span>
                      </td>
                      <td className="p-3 font-medium text-slate-900">
                        {log.emailEssaye ? (
                          <span className="font-mono">{log.emailEssaye}</span>
                        ) : (
                          <span className="text-slate-400 italic">—</span>
                        )}
                      </td>
                      <td className="p-3">
                        <span className="font-mono text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded">
                          {log.ip || "127.0.0.1"}
                        </span>
                      </td>
                      <td className="p-3 whitespace-nowrap text-slate-600">{dateStr}</td>
                      <td className="p-3 text-slate-500 max-w-xs truncate" title={log.userAgent || ""}>
                        {log.userAgent || "Inconnu"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
