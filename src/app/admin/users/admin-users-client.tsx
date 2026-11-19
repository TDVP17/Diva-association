"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { translate, type Lang } from "@/lib/i18n/translations";
import { LoadingSpinner } from "@/components/loading-spinner";
import { ROLE_KEY } from "@/lib/role-label";

interface UserMembershipItem {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "BANNED";
  slotCount: number | null;
  joinedAt: string;
  session: {
    id: string;
    title: string;
    status: string;
    amount: number;
  };
}

interface KycData {
  id: string;
  documentType: string;
  status: string;
  documentImageUrl: string | null;
  documentBackImageUrl: string | null;
  selfieImageUrl: string | null;
  referrerName?: string | null;
  referrerPhone?: string | null;
  createdAt: string;
}

interface DisbursementItem {
  id: string;
  provider: "ORANGE" | "MTN";
  phone: string;
  accountName: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  rejectionReason: string | null;
  isDefault: boolean;
}

interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  avatar: string | null;
  role: string;
  memberCode: string | null;
  city: string | null;
  neighborhood: string | null;
  latitude?: number | null;
  longitude?: number | null;
  stars?: number;
  walletBalance?: number;
  maxWithdrawalAmount?: number | null;
  kyc?: KycData | null;
  membershipCount: number;
  memberships: UserMembershipItem[];
  disbursementMethods?: DisbursementItem[];
  isBanned?: boolean;
  bannedAt?: string | null;
  createdAt: string;
}

const ROLE_CLASS: Record<string, string> = {
  MEMBER: "bg-secondary-fixed text-on-secondary-fixed-variant",
  ADMIN: "bg-secondary-container/40 text-on-secondary-container",
  PRESIDENT: "bg-[#d1fae5] text-[#065f46]",
};

type FilterTab = "all" | "pending" | "members" | "none";

export function AdminUsersClient({ lang }: { lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [filterTab, setFilterTab] = useState<FilterTab>("all");

  // Menu déroulant actif (id utilisateur)
  const [openMenuUserId, setOpenMenuUserId] = useState<string | null>(null);

  // Modales
  const [selectedMapUser, setSelectedMapUser] = useState<AdminUserRow | null>(null);
  const [selectedKycUser, setSelectedKycUser] = useState<AdminUserRow | null>(null);
  const [editingStarsUser, setEditingStarsUser] = useState<AdminUserRow | null>(null);
  const [starsInput, setStarsInput] = useState<number>(0);
  const [savingStars, setSavingStars] = useState(false);
  const [editingLimitUser, setEditingLimitUser] = useState<AdminUserRow | null>(null);
  const [limitInput, setLimitInput] = useState<string>("");
  const [savingLimit, setSavingLimit] = useState(false);
  const [zoomedImage, setZoomedImage] = useState<{ url: string; title: string } | null>(null);

  // Historique complet multi-années
  const [historyUser, setHistoryUser] = useState<AdminUserRow | null>(null);
  const [historyData, setHistoryData] = useState<{
    user: { walletBalance: number; formattedBalance: string };
    totalContributed: number;
    formattedTotalContributed: string;
    feeInfo?: { percentage: number };
    operations: Array<{
      id: string;
      type: string;
      direction: "IN" | "OUT";
      title: string;
      subtitle: string;
      formattedAmount: string;
      date: string;
    }>;
  } | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  async function handleSaveWithdrawalLimit(customValue: number | null) {
    if (!editingLimitUser) return;
    setSavingLimit(true);
    try {
      const res = await fetch(`/api/admin/users/${editingLimitUser.id}/withdrawal-limit`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxWithdrawalAmount: customValue }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error || "Erreur lors de la mise à jour du plafond.");
        return;
      }
      setUsers((prev) =>
        prev
          ? prev.map((u) =>
              u.id === editingLimitUser.id ? { ...u, maxWithdrawalAmount: customValue } : u,
            )
          : null,
      );
      setEditingLimitUser(null);
    } finally {
      setSavingLimit(false);
    }
  }

  async function openFullHistoryModal(u: AdminUserRow) {
    setHistoryUser(u);
    setLoadingHistory(true);
    try {
      const res = await fetch(`/api/admin/users/${u.id}/wallet-history`);
      const data = await res.json();
      setHistoryData(data);
    } catch {
      alert("Erreur lors du chargement de l'historique.");
    } finally {
      setLoadingHistory(false);
    }
  }

  // Récupération de mot de passe
  const [recoveryResult, setRecoveryResult] = useState<{
    userName: string;
    email: string;
    phone: string | null;
    tempPassword?: string;
    message: string;
  } | null>(null);
  const [resettingUserId, setResettingUserId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Fermer le menu au clic extérieur
  const menuContainerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuContainerRef.current && !menuContainerRef.current.contains(event.target as Node)) {
        setOpenMenuUserId(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function handleResetUserPassword(u: AdminUserRow) {
    const confirmMsg =
      lang === "fr"
        ? `Réinitialiser le mot de passe de ${u.name} ? Un nouveau mot de passe temporaire sera généré et lui sera envoyé par email.`
        : `Reset password for ${u.name}? A new temporary password will be generated and emailed to them.`;
    if (!window.confirm(confirmMsg)) return;

    setResettingUserId(u.id);
    try {
      const res = await fetch(`/api/admin/users/${u.id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Erreur lors de la réinitialisation");
        return;
      }
      setRecoveryResult({
        userName: u.name,
        email: data.email,
        phone: data.phone,
        tempPassword: data.tempPassword,
        message: data.message,
      });
    } catch {
      alert("Erreur de connexion au serveur");
    } finally {
      setResettingUserId(null);
    }
  }

  async function handleBanToggle(u: AdminUserRow) {
    const nextState = !u.isBanned;
    const confirmMsg = nextState
      ? lang === "fr"
        ? `Voulez-vous vraiment bannir ${u.name} ? Cette personne ne pourra plus se connecter à l'application avec son email ou son numéro de téléphone.`
        : `Are you sure you want to ban ${u.name}? They will no longer be able to log in with their email or phone number.`
      : lang === "fr"
        ? `Voulez-vous réactiver / débannir le compte de ${u.name} ?`
        : `Are you sure you want to unban ${u.name}?`;
    if (!window.confirm(confirmMsg)) return;
    try {
      const res = await fetch(`/api/admin/users/${u.id}/ban`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isBanned: nextState }),
      });
      if (res.ok) {
        setUsers((prev) =>
          prev ? prev.map((item) => (item.id === u.id ? { ...item, isBanned: nextState } : item)) : null
        );
      }
    } catch (e) {
      console.error("Ban toggle error:", e);
    }
  }

  async function handleSaveStars() {
    if (!editingStarsUser) return;
    setSavingStars(true);
    try {
      const res = await fetch(`/api/admin/users/${editingStarsUser.id}/stars`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stars: starsInput }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Erreur lors de la mise à jour des étoiles");
        return;
      }
      setUsers((prev) =>
        prev
          ? prev.map((u) => (u.id === editingStarsUser.id ? { ...u, stars: starsInput } : u))
          : null
      );
      setEditingStarsUser(null);
    } catch (e) {
      console.error("Save stars error:", e);
      alert("Erreur de connexion lors de l'enregistrement des étoiles.");
    } finally {
      setSavingStars(false);
    }
  }

  async function handleDecideDisbursement(
    methodId: string,
    userId: string,
    status: "APPROVED" | "REJECTED"
  ) {
    let rejectionReason: string | undefined = undefined;
    if (status === "REJECTED") {
      const reason = window.prompt(
        lang === "fr"
          ? "Motif du refus du numéro de retrait (ex: Nom du titulaire ne correspond pas au profil) :"
          : "Reason for rejection:"
      );
      if (!reason) return;
      rejectionReason = reason;
    }

    try {
      const res = await fetch(`/api/admin/disbursement-methods/${methodId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, rejectionReason }),
      });
      if (res.ok) {
        setUsers((prev) =>
          prev
            ? prev.map((u) => {
              if (u.id !== userId || !u.disbursementMethods) return u;
              return {
                ...u,
                disbursementMethods: u.disbursementMethods.map((m) =>
                  m.id === methodId ? { ...m, status, rejectionReason: rejectionReason || null } : m
                ),
              };
            })
            : null
        );
      } else {
        const data = await res.json().catch(() => null);
        alert(data?.error || "Erreur lors de la mise à jour");
      }
    } catch (e) {
      console.error("Disbursement decide error:", e);
      alert("Erreur de connexion.");
    }
  }

  useEffect(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    const handle = setTimeout(() => {
      fetch(`/api/admin/users?${params.toString()}`)
        .then((r) => r.json())
        .then((b) => {
          setUsers(b.users ?? []);
          setTotal(typeof b.total === "number" ? b.total : null);
        })
        .catch(() => setUsers([]));
    }, 200);
    return () => clearTimeout(handle);
  }, [query]);

  const pendingCount = users ? users.filter((u) => u.memberships?.some((m) => m.status === "PENDING")).length : 0;
  const membersCount = users ? users.filter((u) => u.memberships?.some((m) => m.status === "APPROVED")).length : 0;
  const noneCount = users ? users.filter((u) => !u.memberships || u.memberships.length === 0).length : 0;

  const displayedUsers = users
    ? users.filter((u) => {
      if (filterTab === "pending") return u.memberships?.some((m) => m.status === "PENDING");
      if (filterTab === "members") return u.memberships?.some((m) => m.status === "APPROVED");
      if (filterTab === "none") return !u.memberships || u.memberships.length === 0;
      return true;
    })
    : [];

  return (
    <div className="flex flex-col gap-stack-gap-md" ref={menuContainerRef}>
      {total != null && (
        <p className="font-label-sm text-label-sm text-on-surface-variant">
          {t("totalRegisteredUsers", { count: total.toLocaleString("fr-FR") })}
        </p>
      )}
      <div className="relative">
        <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[20px]">
          search
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchAllUsersPlaceholder")}
          className="w-full bg-white border border-outline-variant rounded-lg pl-10 pr-3 py-2.5 font-body-md text-body-md text-on-surface focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
        />
      </div>

      {/* Onglets de filtrage rapide */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
        <button
          type="button"
          onClick={() => setFilterTab("all")}
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap cursor-pointer ${filterTab === "all"
              ? "bg-primary text-on-primary shadow-xs"
              : "bg-surface-variant/40 hover:bg-surface-variant/70 text-on-surface-variant"
            }`}
        >
          {lang === "fr" ? "Tous" : "All"} ({total ?? users?.length ?? 0})
        </button>
        <button
          type="button"
          onClick={() => setFilterTab("pending")}
          className={`px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${filterTab === "pending"
              ? "bg-amber-600 text-white shadow-xs"
              : "bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200/60"
            }`}
        >
          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          <span>{lang === "fr" ? "Veulent intégrer" : "Want to join"}</span>
          <span className="font-bold ml-0.5">({pendingCount})</span>
        </button>
        <button
          type="button"
          onClick={() => setFilterTab("members")}
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap cursor-pointer ${filterTab === "members"
              ? "bg-emerald-700 text-white shadow-xs"
              : "bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200/60"
            }`}
        >
          <span>{lang === "fr" ? "Membres actifs" : "Active members"}</span>
          <span className="font-bold ml-0.5">({membersCount})</span>
        </button>
        <button
          type="button"
          onClick={() => setFilterTab("none")}
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap cursor-pointer ${filterTab === "none"
              ? "bg-slate-700 text-white shadow-xs"
              : "bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200"
            }`}
        >
          <span>{lang === "fr" ? "Sans cotisation" : "No cotisations"}</span>
          <span className="font-bold ml-0.5">({noneCount})</span>
        </button>
      </div>

      {noneCount > 0 && filterTab === "none" && (
        <div className="p-4 bg-amber-50 border border-amber-300/80 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs animate-in fade-in duration-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 text-amber-800 flex items-center justify-center flex-shrink-0">
              <span className="material-symbols-outlined text-[24px]">campaign</span>
            </div>
            <div>
              <p className="text-sm font-bold text-amber-950">
                {lang === "fr"
                  ? `${noneCount} utilisateur(s) inscrit(s) sans aucune cotisation`
                  : `${noneCount} registered user(s) with 0 cotisations`}
              </p>
              <p className="text-xs text-amber-800/90 mt-0.5">
                {lang === "fr"
                  ? "Envoyez-leur un rappel échelonné par minute pour les inciter à rejoindre une session."
                  : "Send them a staggered reminder per minute to invite them to join a session."}
              </p>
            </div>
          </div>
          <Link
            href="/admin/notifications?target=ORPHAN"
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-amber-700 hover:bg-amber-800 text-white font-label-md text-xs font-bold transition-all shadow-xs flex-shrink-0 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[18px]">send</span>
            <span>{lang === "fr" ? `Relancer ces ${noneCount} membres` : `Remind these ${noneCount} members`}</span>
          </Link>
        </div>
      )}

      {!users ? (
        <LoadingSpinner fullPage />
      ) : displayedUsers.length === 0 ? (
        <p className="font-label-sm text-label-sm text-on-surface-variant">
          {filterTab !== "all"
            ? lang === "fr"
              ? "Aucun utilisateur ne correspond à ce filtre."
              : "No users match this filter."
            : t("noUsersFound")}
        </p>
      ) : (
        <div className="bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-outline-variant/30 overflow-visible divide-y divide-outline-variant/30">
          {displayedUsers.map((u) => {
            const isMenuOpen = openMenuUserId === u.id;
            const currentStars = u.stars ?? 0;

            return (
              <div
                key={u.id}
                className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 bg-surface-container-lowest hover:bg-surface-container-low/40 transition-colors"
              >
                <div className="flex items-start gap-3 min-w-0 flex-1 w-full">
                  <div className="w-10 h-10 rounded-full bg-tertiary-container text-on-tertiary flex items-center justify-center font-label-md text-label-md overflow-hidden flex-shrink-0 mt-0.5">
                    {u.avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={u.avatar} alt={u.name} className="w-full h-full object-cover" />
                    ) : (
                      u.name.slice(0, 2).toUpperCase()
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        href={`/admin/support?with=${encodeURIComponent(u.id)}&name=${encodeURIComponent(u.name)}`}
                        className="font-label-md text-label-md text-on-surface hover:text-primary hover:underline font-semibold truncate flex items-center gap-1 group"
                        title={lang === "fr" ? `Écrire à ${u.name}` : `Message ${u.name}`}
                      >
                        <span>{u.name}</span>
                        <span className="material-symbols-outlined text-[15px] text-primary opacity-60 group-hover:opacity-100 flex-shrink-0">
                          chat
                        </span>
                      </Link>

                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md font-label-sm text-[11px] flex-shrink-0 ${ROLE_CLASS[u.role] ?? ""}`}>
                        {t(ROLE_KEY[u.role] ?? "roleMember")}
                      </span>

                      {u.isBanned && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md font-label-sm text-[11px] bg-error/15 text-error font-bold flex-shrink-0">
                          {lang === "fr" ? "BANNI" : "BANNED"}
                        </span>
                      )}

                      {/* Indicateur 5 Étoiles (Score de réputation / Admissibilité aux prêts) */}
                      <button
                        type="button"
                        onClick={() => {
                          setEditingStarsUser(u);
                          setStarsInput(u.stars ?? 0);
                        }}
                        className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-amber-50 hover:bg-amber-100 border border-amber-200/80 transition-all cursor-pointer group"
                        title={
                          lang === "fr"
                            ? `${currentStars}/5 étoiles - Fiabilité & admissibilité aux prêts. Cliquez pour ajuster.`
                            : `${currentStars}/5 stars - Credit rating for loans. Click to adjust.`
                        }
                      >
                        {[1, 2, 3, 4, 5].map((starIdx) => {
                          const isFilled = starIdx <= currentStars;
                          return (
                            <span
                              key={starIdx}
                              className="material-symbols-outlined text-[14px] transition-transform group-hover:scale-110"
                              style={{
                                color: isFilled ? "#f59e0b" : "#cbd5e1",
                                fontVariationSettings: isFilled ? "'FILL' 1" : "'FILL' 0",
                              }}
                            >
                              star
                            </span>
                          );
                        })}
                        <span className="text-[10px] font-bold text-amber-800 ml-0.5">
                          {currentStars}/5
                        </span>
                      </button>
                    </div>

                    <p className="font-label-sm text-xs text-on-surface-variant truncate mt-0.5">
                      {u.email}
                      {u.phone ? ` · ${u.phone}` : ""}
                    </p>

                    <div className="flex items-center gap-2 flex-wrap font-label-sm text-xs text-on-surface-variant truncate mt-0.5">
                      {u.memberCode ? <span>{u.memberCode} · </span> : null}
                      {u.city ? <span>{[u.city, u.neighborhood].filter(Boolean).join(", ")} · </span> : null}
                      <span>{t("membershipCountLabel", { count: String(u.membershipCount) })}</span>

                      {/* Indicateur présence coordonnées GPS */}
                      {u.latitude && u.longitude ? (
                        <button
                          type="button"
                          onClick={() => setSelectedMapUser(u)}
                          className="inline-flex items-center gap-0.5 text-[11px] text-emerald-700 font-semibold hover:underline bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200/70"
                          title={lang === "fr" ? "Position GPS enregistrée. Cliquez pour voir la carte." : "GPS captured. Click to view on map."}
                        >
                          <span className="material-symbols-outlined text-[12px]">location_on</span>
                          <span>GPS certifié</span>
                        </button>
                      ) : null}

                      {/* Indicateur CNI / Selfie */}
                      {u.kyc?.documentImageUrl || u.kyc?.selfieImageUrl ? (
                        <button
                          type="button"
                          onClick={() => setSelectedKycUser(u)}
                          className="inline-flex items-center gap-0.5 text-[11px] text-indigo-700 font-semibold hover:underline bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200/70"
                          title={lang === "fr" ? "Photo & CNI disponibles. Cliquez pour voir." : "Photo & ID available. Click to view."}
                        >
                          <span className="material-symbols-outlined text-[12px]">badge</span>
                          <span>CNI/Photo</span>
                        </button>
                      ) : null}
                    </div>

                    {/* Cotisations & Demandes d'intégration détaillées */}
                    {u.memberships && u.memberships.length > 0 ? (
                      <div className="mt-2 flex flex-col gap-1.5">
                        {u.memberships.map((m) => {
                          const isPending = m.status === "PENDING";
                          const isApproved = m.status === "APPROVED";
                          const isRejected = m.status === "REJECTED";

                          return (
                            <div
                              key={m.id}
                              className={`flex items-center justify-between gap-2 p-2 rounded-lg text-xs border ${isPending
                                  ? "bg-amber-50/90 border-amber-300 text-amber-950 font-medium"
                                  : isApproved
                                    ? "bg-emerald-50/70 border-emerald-200 text-emerald-950"
                                    : "bg-slate-50 border-slate-200 text-slate-700"
                                }`}
                            >
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span
                                  className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${isPending
                                      ? "bg-amber-500 animate-pulse"
                                      : isApproved
                                        ? "bg-emerald-500"
                                        : "bg-slate-400"
                                    }`}
                                />
                                <span className="font-bold flex-shrink-0">
                                  {isPending
                                    ? lang === "fr" ? "Veut intégrer :" : "Wants to join:"
                                    : isApproved
                                      ? lang === "fr" ? "Inscrit à :" : "Member of:"
                                      : isRejected
                                        ? lang === "fr" ? "Refusé pour :" : "Rejected for:"
                                        : lang === "fr" ? "Banni de :" : "Banned from:"}
                                </span>
                                <span className="truncate font-semibold" title={m.session.title}>
                                  {m.session.title}
                                </span>
                              </div>

                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                {isPending && (
                                  <Link
                                    href="/admin/membership-requests"
                                    className="px-2 py-0.5 rounded bg-amber-600 hover:bg-amber-700 text-white font-semibold text-[11px] transition-colors"
                                  >
                                    {lang === "fr" ? "Traiter" : "Review"}
                                  </Link>
                                )}
                                <Link
                                  href={`/admin/contributions/${m.session.id}`}
                                  className="px-2 py-0.5 rounded border border-current hover:bg-black/5 font-medium text-[11px] transition-colors"
                                >
                                  {lang === "fr" ? "Cotisation" : "View"}
                                </Link>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="font-label-sm text-[11px] text-on-surface-variant/70 italic mt-1.5">
                        {lang === "fr" ? "Aucune demande d'intégration ni cotisation" : "No membership requests or cotisations"}
                      </p>
                    )}

                    {/* Numéros de retrait (Décaissement) enregistrés par le membre */}
                    {u.disbursementMethods && u.disbursementMethods.length > 0 && (
                      <div className="mt-2.5 p-2 rounded-xl bg-slate-50 border border-slate-200/80 flex flex-col gap-1.5">
                        <span className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
                          <span className="material-symbols-outlined text-[14px] text-primary">payments</span>
                          <span>{lang === "fr" ? "Numéros de retrait (Décaissement) :" : "Payout / Disbursement Numbers:"}</span>
                        </span>
                        <div className="flex flex-col gap-1">
                          {u.disbursementMethods.map((dm) => {
                            const isPending = dm.status === "PENDING";
                            const isApproved = dm.status === "APPROVED";
                            return (
                              <div
                                key={dm.id}
                                className="flex items-center justify-between gap-2 p-1.5 bg-white rounded-lg border border-slate-200 text-xs"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span
                                    className={`px-1.5 py-0.2 rounded font-bold text-[10px] uppercase flex-shrink-0 ${dm.provider === "ORANGE" ? "bg-orange-500 text-white" : "bg-yellow-400 text-slate-950"
                                      }`}
                                  >
                                    {dm.provider}
                                  </span>
                                  <span className="font-mono font-bold text-slate-900">{dm.phone}</span>
                                  {dm.accountName && (
                                    <span className="text-slate-600 truncate text-[11px]">· {dm.accountName}</span>
                                  )}
                                  <span
                                    className={`px-1.5 py-0.2 rounded text-[10px] font-bold flex-shrink-0 ${isApproved
                                        ? "bg-emerald-100 text-emerald-800"
                                        : isPending
                                          ? "bg-amber-100 text-amber-900"
                                          : "bg-red-100 text-red-800"
                                      }`}
                                  >
                                    {isApproved
                                      ? (lang === "fr" ? "Validé DIVA" : "Approved")
                                      : isPending
                                        ? (lang === "fr" ? "En attente" : "Pending")
                                        : (lang === "fr" ? "Refusé" : "Rejected")}
                                  </span>
                                </div>

                                {isPending && (
                                  <div className="flex items-center gap-1 flex-shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => handleDecideDisbursement(dm.id, u.id, "APPROVED")}
                                      className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] flex items-center gap-0.5 cursor-pointer"
                                      title={lang === "fr" ? "Valider pour décaissements" : "Approve for payouts"}
                                    >
                                      <span className="material-symbols-outlined text-[12px]">check</span>
                                      <span>{lang === "fr" ? "Valider" : "Approve"}</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDecideDisbursement(dm.id, u.id, "REJECTED")}
                                      className="px-2 py-0.5 rounded bg-red-100 hover:bg-red-200 text-red-800 font-bold text-[10px] flex items-center gap-0.5 cursor-pointer"
                                      title={lang === "fr" ? "Refuser ce numéro" : "Reject"}
                                    >
                                      <span className="material-symbols-outlined text-[12px]">close</span>
                                      <span>{lang === "fr" ? "Refuser" : "Reject"}</span>
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Petit menu d'actions compact devant chaque membre ── */}
                <div className="relative self-end sm:self-center mt-2 sm:mt-0 flex-shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMenuUserId((prev) => (prev === u.id ? null : u.id));
                    }}
                    className={`inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-bold transition-all shadow-2xs cursor-pointer ${isMenuOpen
                        ? "bg-primary text-white border-primary ring-2 ring-primary/20"
                        : "bg-white hover:bg-surface-container text-on-surface border-outline-variant/60"
                      }`}
                    title={lang === "fr" ? "Options du membre" : "Member options"}
                  >
                    <span className="material-symbols-outlined text-[18px]">more_vert</span>
                    <span className="hidden xs:inline">{lang === "fr" ? "Actions" : "Actions"}</span>
                  </button>

                  {/* Dropdown Menu flottant */}
                  {isMenuOpen && (
                    <div
                      className="absolute right-0 top-full mt-1.5 z-40 w-64 bg-white rounded-2xl shadow-xl border border-outline-variant/40 py-2 divide-y divide-outline-variant/20 animate-in fade-in zoom-in-95 duration-150"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="px-3.5 py-2">
                        <p className="text-xs font-bold text-on-surface truncate">{u.name}</p>
                        <p className="text-[11px] text-on-surface-variant truncate">{u.email}</p>
                      </div>

                      <div className="py-1">
                        {/* 1. Écrire au membre */}
                        <Link
                          href={`/admin/support?with=${encodeURIComponent(u.id)}&name=${encodeURIComponent(u.name)}`}
                          onClick={() => setOpenMenuUserId(null)}
                          className="flex items-center gap-2.5 px-3.5 py-2 text-xs font-medium text-on-surface hover:bg-primary/10 hover:text-primary transition-colors"
                        >
                          <span className="material-symbols-outlined text-[18px] text-primary">chat</span>
                          <span>{lang === "fr" ? "Écrire au membre" : "Message member"}</span>
                        </Link>

                        {/* 2. Voir localisation sur la carte */}
                        <button
                          type="button"
                          onClick={() => {
                            setOpenMenuUserId(null);
                            setSelectedMapUser(u);
                          }}
                          className="w-full text-left flex items-center gap-2.5 px-3.5 py-2 text-xs font-medium text-on-surface hover:bg-emerald-50 hover:text-emerald-800 transition-colors cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-[18px] text-emerald-700">location_on</span>
                          <span>{lang === "fr" ? "Voir localisation sur la carte" : "View exact location on map"}</span>
                        </button>

                        {/* 3. Voir photo et CNI */}
                        <button
                          type="button"
                          onClick={() => {
                            setOpenMenuUserId(null);
                            setSelectedKycUser(u);
                          }}
                          className="w-full text-left flex items-center gap-2.5 px-3.5 py-2 text-xs font-medium text-on-surface hover:bg-indigo-50 hover:text-indigo-800 transition-colors cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-[18px] text-indigo-600">badge</span>
                          <span>{lang === "fr" ? "Voir photo et CNI" : "View photo & ID"}</span>
                        </button>

                        {/* 4. Modifier / attribuer les étoiles */}
                        <button
                          type="button"
                          onClick={() => {
                            setOpenMenuUserId(null);
                            setEditingStarsUser(u);
                            setStarsInput(u.stars ?? 0);
                          }}
                          className="w-full text-left flex items-center gap-2.5 px-3.5 py-2 text-xs font-medium text-on-surface hover:bg-amber-50 hover:text-amber-900 transition-colors cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-[18px] text-amber-600" style={{ fontVariationSettings: "'FILL' 1" }}>
                            hotel_class
                          </span>
                          <span className="flex items-center justify-between flex-1">
                            <span>{lang === "fr" ? "Modifier les étoiles" : "Update stars rating"}</span>
                            <span className="font-bold text-amber-700 bg-amber-100 px-1.5 py-0.2 rounded text-[10px]">
                              {currentStars}/5 ★
                            </span>
                          </span>
                        </button>

                        {/* 4b. Historique complet & Portefeuille (Stockage multi-années admin) */}
                        <button
                          type="button"
                          onClick={() => {
                            setOpenMenuUserId(null);
                            openFullHistoryModal(u);
                          }}
                          className="w-full text-left flex items-center gap-2.5 px-3.5 py-2 text-xs font-medium text-on-surface hover:bg-teal-50 hover:text-teal-900 transition-colors cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-[18px] text-teal-700">receipt_long</span>
                          <span>{lang === "fr" ? "Historique complet (Multi-années)" : "Full History (Multi-year)"}</span>
                        </button>

                        {/* 4c. Plafond maximal de retrait personnalisé */}
                        <button
                          type="button"
                          onClick={() => {
                            setOpenMenuUserId(null);
                            setEditingLimitUser(u);
                            setLimitInput(u.maxWithdrawalAmount ? String(u.maxWithdrawalAmount) : "");
                          }}
                          className="w-full text-left flex items-center gap-2.5 px-3.5 py-2 text-xs font-medium text-on-surface hover:bg-emerald-50 hover:text-emerald-900 transition-colors cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-[18px] text-emerald-700">payments</span>
                          <span className="flex items-center justify-between flex-1 gap-1">
                            <span>{lang === "fr" ? "Plafond retrait max" : "Max withdrawal limit"}</span>
                            {u.maxWithdrawalAmount && (
                              <span className="font-bold text-emerald-800 bg-emerald-100 px-1.5 py-0.2 rounded text-[10px]">
                                {u.maxWithdrawalAmount.toLocaleString("fr-FR")} F
                              </span>
                            )}
                          </span>
                        </button>
                      </div>

                      {/* Options administratives sensibles */}
                      {u.role !== "ADMIN" && u.role !== "PRESIDENT" && (
                        <div className="py-1">
                          {/* 5. Récupérer le compte */}
                          <button
                            type="button"
                            onClick={() => {
                              setOpenMenuUserId(null);
                              handleResetUserPassword(u);
                            }}
                            disabled={resettingUserId === u.id}
                            className="w-full text-left flex items-center gap-2.5 px-3.5 py-2 text-xs font-medium text-primary hover:bg-primary/10 transition-colors cursor-pointer disabled:opacity-50"
                          >
                            <span className="material-symbols-outlined text-[18px]">lock_reset</span>
                            <span>
                              {resettingUserId === u.id
                                ? (lang === "fr" ? "Génération..." : "Generating...")
                                : (lang === "fr" ? "Récupérer le compte" : "Reset account password")}
                            </span>
                          </button>

                          {/* 6. Bannir / Débannir */}
                          <button
                            type="button"
                            onClick={() => {
                              setOpenMenuUserId(null);
                              handleBanToggle(u);
                            }}
                            className={`w-full text-left flex items-center gap-2.5 px-3.5 py-2 text-xs font-semibold transition-colors cursor-pointer ${u.isBanned
                                ? "text-emerald-700 hover:bg-emerald-50"
                                : "text-error hover:bg-error/10"
                              }`}
                          >
                            <span className="material-symbols-outlined text-[18px]">
                              {u.isBanned ? "how_to_reg" : "block"}
                            </span>
                            <span>
                              {u.isBanned
                                ? (lang === "fr" ? "Débannir le membre" : "Unban member")
                                : (lang === "fr" ? "Bannir le membre" : "Ban member")}
                            </span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── MODALE 1 : Localisation exacte sur la carte ── */}
      {selectedMapUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-surface-variant flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-outline-variant/40">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
                  <span className="material-symbols-outlined text-2xl">location_on</span>
                </div>
                <div>
                  <h3 className="font-title-sm font-bold text-on-surface">
                    {lang === "fr" ? `Localisation de ${selectedMapUser.name}` : `Location of ${selectedMapUser.name}`}
                  </h3>
                  <p className="text-[11px] text-on-surface-variant">
                    DIVA Asso · Coordonnées de résidence certifiées
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedMapUser(null)}
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-container text-on-surface-variant cursor-pointer"
              >
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>

            <div className="bg-surface-container-low rounded-xl p-3 flex flex-col gap-1.5 text-xs text-on-surface">
              <div className="flex justify-between py-1 border-b border-outline-variant/20">
                <span className="text-on-surface-variant font-medium">{lang === "fr" ? "Ville déclarée :" : "Declared city:"}</span>
                <span className="font-bold">{selectedMapUser.city || (lang === "fr" ? "Non spécifiée" : "Not specified")}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-outline-variant/20">
                <span className="text-on-surface-variant font-medium">{lang === "fr" ? "Quartier de résidence :" : "Neighborhood:"}</span>
                <span className="font-bold">{selectedMapUser.neighborhood || (lang === "fr" ? "Non spécifié" : "Not specified")}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-on-surface-variant font-medium">{lang === "fr" ? "Coordonnées GPS :" : "GPS Coordinates:"}</span>
                <span className="font-mono font-bold text-emerald-800">
                  {selectedMapUser.latitude && selectedMapUser.longitude
                    ? `${selectedMapUser.latitude}, ${selectedMapUser.longitude}`
                    : (lang === "fr" ? "Non activées en direct" : "Not captured live")}
                </span>
              </div>
            </div>

            {selectedMapUser.latitude && selectedMapUser.longitude ? (
              <div className="flex flex-col gap-3">
                <div className="w-full h-56 rounded-xl overflow-hidden border border-outline-variant/40 shadow-inner bg-slate-100 relative">
                  <iframe
                    title="Carte de localisation"
                    width="100%"
                    height="100%"
                    frameBorder="0"
                    scrolling="no"
                    marginHeight={0}
                    marginWidth={0}
                    src={`https://www.openstreetmap.org/export/embed.html?bbox=${selectedMapUser.longitude - 0.008}%2C${selectedMapUser.latitude - 0.008}%2C${selectedMapUser.longitude + 0.008}%2C${selectedMapUser.latitude + 0.008}&layer=mapnik&marker=${selectedMapUser.latitude}%2C${selectedMapUser.longitude}`}
                  />
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <a
                    href={`https://www.google.com/maps?q=${selectedMapUser.latitude},${selectedMapUser.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs shadow-xs transition-colors"
                  >
                    <span className="material-symbols-outlined text-[18px]">map</span>
                    <span>{lang === "fr" ? "Ouvrir sur Google Maps" : "Open in Google Maps"}</span>
                  </a>
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${selectedMapUser.latitude},${selectedMapUser.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border border-emerald-300 text-emerald-800 hover:bg-emerald-50 font-bold text-xs transition-colors"
                  >
                    <span className="material-symbols-outlined text-[18px]">directions</span>
                    <span>{lang === "fr" ? "Itinéraire" : "Get Directions"}</span>
                  </a>
                </div>
              </div>
            ) : (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex flex-col gap-2.5 text-xs text-amber-950">
                <div className="flex items-center gap-2 font-bold text-amber-900">
                  <span className="material-symbols-outlined text-[18px]">info</span>
                  <span>{lang === "fr" ? "Position GPS exacte non partagée" : "Exact GPS position not yet shared"}</span>
                </div>
                <p>
                  {lang === "fr"
                    ? `Le membre n'a pas encore cliqué sur le bouton de partage de localisation GPS automatique. Vous pouvez toutefois rechercher sa ville (${selectedMapUser.city || "Cameroun"}) sur Google Maps :`
                    : `The member hasn't clicked the automatic GPS share button yet. You can still search their declared city (${selectedMapUser.city || "Cameroon"}) on Google Maps:`}
                </p>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([selectedMapUser.neighborhood, selectedMapUser.city, "Cameroun"].filter(Boolean).join(", "))}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-amber-700 hover:bg-amber-800 text-white font-bold text-xs transition-colors w-fit"
                >
                  <span className="material-symbols-outlined text-[16px]">search</span>
                  <span>{lang === "fr" ? "Rechercher la zone sur Google Maps" : "Search area on Google Maps"}</span>
                </a>
              </div>
            )}

            <button
              type="button"
              onClick={() => setSelectedMapUser(null)}
              className="w-full py-2.5 rounded-xl bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-label-md text-xs font-semibold transition-colors cursor-pointer mt-1"
            >
              {lang === "fr" ? "Fermer" : "Close"}
            </button>
          </div>
        </div>
      )}

      {/* ── MODALE 2 : Photo de profil & Pièces d'identité CNI ── */}
      {selectedKycUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-surface-variant flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-outline-variant/40">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-800 flex items-center justify-center">
                  <span className="material-symbols-outlined text-2xl">badge</span>
                </div>
                <div>
                  <h3 className="font-title-sm font-bold text-on-surface">
                    {lang === "fr" ? `Photo & CNI de ${selectedKycUser.name}` : `Photo & ID of ${selectedKycUser.name}`}
                  </h3>
                  <p className="text-[11px] text-on-surface-variant">
                    {lang === "fr"
                      ? "Données d'identification hautement confidentielles conservées de façon permanente"
                      : "Permanent KYC identification records"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedKycUser(null)}
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-container text-on-surface-variant cursor-pointer"
              >
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>

            {/* Note d'information obligatoire */}
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-950 flex items-center gap-2">
              <span className="material-symbols-outlined text-emerald-700 text-[18px]">verified_user</span>
              <span>
                {lang === "fr"
                  ? "Ces pièces justificatives sont protégées et archivées de façon permanente pour la sécurité de DIVA Asso et des cotisations."
                  : "These verification documents are permanently archived and secured in DIVA Asso."}
              </span>
            </div>

            {selectedKycUser.kyc ? (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
                  <span className="font-medium text-on-surface-variant">
                    {lang === "fr" ? "Type de document :" : "Document type:"}{" "}
                    <span className="font-bold text-on-surface">
                      {selectedKycUser.kyc.documentType === "RECEPISSE" ? "Récépissé de CNI" : "CNI (Carte Nationale d'Identité)"}
                    </span>
                  </span>
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${selectedKycUser.kyc.status === "VERIFIED"
                      ? "bg-emerald-100 text-emerald-800"
                      : selectedKycUser.kyc.status === "FAILED"
                        ? "bg-error/15 text-error"
                        : "bg-amber-100 text-amber-900"
                    }`}>
                    {selectedKycUser.kyc.status}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {/* Photo Selfie */}
                  <div className="flex flex-col gap-1.5 p-3 rounded-xl border border-outline-variant/40 bg-surface-container-lowest">
                    <span className="text-xs font-bold text-on-surface flex items-center gap-1">
                      <span className="material-symbols-outlined text-[16px] text-primary">face</span>
                      <span>{lang === "fr" ? "Photo Selfie visage" : "Face Selfie"}</span>
                    </span>
                    {selectedKycUser.kyc.selfieImageUrl || selectedKycUser.avatar ? (
                      <div className="relative group aspect-[4/3] rounded-lg overflow-hidden border border-outline-variant bg-slate-100">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={selectedKycUser.kyc.selfieImageUrl || selectedKycUser.avatar!}
                          alt="Selfie"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        />
                        <button
                          type="button"
                          onClick={() => setZoomedImage({
                            url: selectedKycUser.kyc?.selfieImageUrl || selectedKycUser.avatar!,
                            title: `Selfie - ${selectedKycUser.name}`,
                          })}
                          className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-xs font-bold gap-1 transition-opacity cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-[18px]">zoom_in</span>
                          <span>{lang === "fr" ? "Agrandir" : "Zoom"}</span>
                        </button>
                      </div>
                    ) : (
                      <div className="aspect-[4/3] rounded-lg border border-dashed border-outline-variant flex items-center justify-center text-xs text-on-surface-variant italic">
                        {lang === "fr" ? "Aucun selfie" : "No selfie"}
                      </div>
                    )}
                  </div>

                  {/* CNI Recto */}
                  <div className="flex flex-col gap-1.5 p-3 rounded-xl border border-outline-variant/40 bg-surface-container-lowest">
                    <span className="text-xs font-bold text-on-surface flex items-center gap-1">
                      <span className="material-symbols-outlined text-[16px] text-primary">id_card</span>
                      <span>{lang === "fr" ? "Pièce Recto (Avant)" : "ID Card (Front)"}</span>
                    </span>
                    {selectedKycUser.kyc.documentImageUrl ? (
                      <div className="relative group aspect-[4/3] rounded-lg overflow-hidden border border-outline-variant bg-slate-100">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={selectedKycUser.kyc.documentImageUrl}
                          alt="CNI Recto"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        />
                        <button
                          type="button"
                          onClick={() => setZoomedImage({
                            url: selectedKycUser.kyc!.documentImageUrl!,
                            title: `CNI Recto - ${selectedKycUser.name}`,
                          })}
                          className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-xs font-bold gap-1 transition-opacity cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-[18px]">zoom_in</span>
                          <span>{lang === "fr" ? "Agrandir" : "Zoom"}</span>
                        </button>
                      </div>
                    ) : (
                      <div className="aspect-[4/3] rounded-lg border border-dashed border-outline-variant flex items-center justify-center text-xs text-on-surface-variant italic">
                        {lang === "fr" ? "Aucun document recto" : "No front ID"}
                      </div>
                    )}
                  </div>

                  {/* CNI Verso */}
                  <div className="flex flex-col gap-1.5 p-3 rounded-xl border border-outline-variant/40 bg-surface-container-lowest">
                    <span className="text-xs font-bold text-on-surface flex items-center gap-1">
                      <span className="material-symbols-outlined text-[16px] text-primary">flip</span>
                      <span>{lang === "fr" ? "Pièce Verso (Arrière)" : "ID Card (Back)"}</span>
                    </span>
                    {selectedKycUser.kyc.documentBackImageUrl ? (
                      <div className="relative group aspect-[4/3] rounded-lg overflow-hidden border border-outline-variant bg-slate-100">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={selectedKycUser.kyc.documentBackImageUrl}
                          alt="CNI Verso"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        />
                        <button
                          type="button"
                          onClick={() => setZoomedImage({
                            url: selectedKycUser.kyc!.documentBackImageUrl!,
                            title: `CNI Verso - ${selectedKycUser.name}`,
                          })}
                          className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white text-xs font-bold gap-1 transition-opacity cursor-pointer"
                        >
                          <span className="material-symbols-outlined text-[18px]">zoom_in</span>
                          <span>{lang === "fr" ? "Agrandir" : "Zoom"}</span>
                        </button>
                      </div>
                    ) : (
                      <div className="aspect-[4/3] rounded-lg border border-dashed border-outline-variant flex items-center justify-center text-center p-2 text-[11px] text-on-surface-variant italic">
                        {selectedKycUser.kyc.documentType === "RECEPISSE"
                          ? (lang === "fr" ? "Récépissé : recto uniquement" : "Receipt: 1 side only")
                          : (lang === "fr" ? "Aucun verso fourni" : "No back side")}
                      </div>
                    )}
                  </div>
                </div>

                {/* Parrain / Référent */}
                {(selectedKycUser.kyc.referrerName || selectedKycUser.kyc.referrerPhone) && (
                  <div className="p-3 bg-surface-container-low rounded-xl text-xs flex items-center justify-between flex-wrap gap-2">
                    <span className="font-medium text-on-surface-variant flex items-center gap-1">
                      <span className="material-symbols-outlined text-[16px]">person_pin</span>
                      <span>{lang === "fr" ? "Personne ayant parlé de la tontine :" : "Referred by:"}</span>
                    </span>
                    <span className="font-bold text-on-surface">
                      {selectedKycUser.kyc.referrerName}
                      {selectedKycUser.kyc.referrerPhone ? ` (${selectedKycUser.kyc.referrerPhone})` : ""}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-6 bg-slate-50 border border-slate-200 rounded-xl text-center flex flex-col items-center gap-2">
                <span className="material-symbols-outlined text-slate-400 text-3xl">badge</span>
                <p className="text-xs font-semibold text-slate-700">
                  {lang === "fr"
                    ? "Ce membre n'a pas encore téléversé sa CNI / récépissé ni son selfie."
                    : "No KYC documents or selfie uploaded by this member yet."}
                </p>
                <p className="text-[11px] text-slate-500">
                  {lang === "fr"
                    ? "Les documents sont demandés automatiquement lorsqu'il rejoint une cotisation."
                    : "Documents are requested when the member applies to join a cotisation."}
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={() => setSelectedKycUser(null)}
              className="w-full py-2.5 rounded-xl bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-label-md text-xs font-semibold transition-colors cursor-pointer mt-1"
            >
              {lang === "fr" ? "Fermer" : "Close"}
            </button>
          </div>
        </div>
      )}

      {/* ── Lightbox pour image agrandie ── */}
      {zoomedImage && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setZoomedImage(null)}
        >
          <div className="max-w-4xl max-h-[92vh] flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between text-white text-xs font-bold px-1">
              <span>{zoomedImage.title}</span>
              <button
                type="button"
                onClick={() => setZoomedImage(null)}
                className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/40 flex items-center justify-center text-white cursor-pointer"
              >
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={zoomedImage.url}
              alt={zoomedImage.title}
              className="max-h-[82vh] w-auto object-contain rounded-xl shadow-2xl border border-white/20"
            />
          </div>
        </div>
      )}

      {/* ── MODALE 3 : Modifier / Attribuer les étoiles d'un membre ── */}
      {editingStarsUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-surface-variant flex flex-col gap-4">
            <div className="flex items-center justify-between pb-3 border-b border-outline-variant/40">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-900 flex items-center justify-center">
                  <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                    hotel_class
                  </span>
                </div>
                <div>
                  <h3 className="font-title-sm font-bold text-on-surface">
                    {lang === "fr" ? `Étoiles de ${editingStarsUser.name}` : `Stars of ${editingStarsUser.name}`}
                  </h3>
                  <p className="text-[11px] text-on-surface-variant">
                    DIVA Asso · Score de confiance & crédibilité
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingStarsUser(null)}
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-container text-on-surface-variant cursor-pointer"
              >
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>

            {/* Explication du système d'étoiles pour les prêts */}
            <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-xl text-xs text-amber-950 flex flex-col gap-1.5">
              <p className="font-bold flex items-center gap-1 text-amber-900">
                <span className="material-symbols-outlined text-[16px]">info</span>
                <span>{lang === "fr" ? "Fonctionnement du système d'étoiles :" : "How stars work:"}</span>
              </p>
              <ul className="list-disc list-inside space-y-0.5 text-[11px] text-amber-900/90">
                <li>{lang === "fr" ? "Par défaut, les 5 étoiles sont vides (0 étoile)." : "By default, all 5 stars are empty (0 stars)."}</li>
                <li>
                  {lang === "fr"
                    ? "Pour avoir 1 étoile, le membre doit finir tout un cycle dans une cotisation publique sans jamais avoir eu d'amende."
                    : "To earn 1 star, the member must complete a full cycle in a public cotisation without ever having had a fine."}
                </li>
                <li>
                  {lang === "fr"
                    ? "4 étoiles minimum sont strictement requises pour avoir la possibilité de demander un prêt d'urgence."
                    : "4 stars minimum are strictly required to be eligible to request an emergency loan."}
                </li>
              </ul>
            </div>

            {/* Sélecteur interactif 5 étoiles */}
            <div className="flex flex-col items-center justify-center py-4 bg-surface-container-lowest rounded-xl border border-outline-variant/30 gap-2">
              <p className="text-xs font-bold text-on-surface-variant">
                {lang === "fr" ? "Cliquez sur une étoile pour choisir la note :" : "Click on a star to select rating:"}
              </p>
              <div className="flex items-center gap-1.5">
                {[1, 2, 3, 4, 5].map((starIdx) => {
                  const isFilled = starIdx <= starsInput;
                  return (
                    <button
                      key={starIdx}
                      type="button"
                      onClick={() => setStarsInput(starIdx)}
                      className="p-1 hover:scale-125 transition-transform cursor-pointer"
                      title={`${starIdx} / 5`}
                    >
                      <span
                        className="material-symbols-outlined text-4xl select-none"
                        style={{
                          color: isFilled ? "#f59e0b" : "#cbd5e1",
                          fontVariationSettings: isFilled ? "'FILL' 1" : "'FILL' 0",
                        }}
                      >
                        star
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="font-extrabold text-base text-amber-900">
                {starsInput} / 5 {lang === "fr" ? "étoiles" : "stars"}
              </p>

              {/* Bouton pour remettre à 0 */}
              <button
                type="button"
                onClick={() => setStarsInput(0)}
                className={`text-[11px] font-semibold transition-colors mt-1 px-2.5 py-1 rounded-md cursor-pointer ${starsInput === 0
                    ? "bg-slate-200 text-slate-800 font-bold"
                    : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                  }`}
              >
                {lang === "fr" ? "Remettre à 0 étoile (5 étoiles vides)" : "Reset to 0 stars (5 empty stars)"}
              </button>
            </div>

            {/* Raccourcis de sélection rapide */}
            <div className="flex items-center justify-between gap-1 text-xs">
              {[0, 1, 2, 3, 4, 5].map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setStarsInput(val)}
                  className={`flex-1 py-1 rounded-lg font-bold text-xs transition-colors cursor-pointer border ${starsInput === val
                      ? "bg-amber-600 text-white border-amber-600 shadow-2xs"
                      : "bg-surface-variant/30 text-on-surface-variant border-outline-variant/40 hover:bg-surface-variant/60"
                    }`}
                >
                  {val}★
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingStarsUser(null)}
                className="flex-1 py-2.5 rounded-xl border border-outline-variant text-on-surface-variant font-label-md text-xs font-semibold hover:bg-surface-container transition-colors cursor-pointer"
              >
                {lang === "fr" ? "Annuler" : "Cancel"}
              </button>
              <button
                type="button"
                onClick={handleSaveStars}
                disabled={savingStars}
                className="flex-1 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-on-primary font-label-md text-xs font-bold transition-all shadow-xs cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {savingStars ? (
                  <>
                    <LoadingSpinner />
                    <span>{lang === "fr" ? "Enregistrement..." : "Saving..."}</span>
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[16px]">check</span>
                    <span>{lang === "fr" ? "Enregistrer les étoiles" : "Save Stars"}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MODALE 3B : Plafond maximal de retrait personnalisé ── */}
      {editingLimitUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-surface-variant flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="font-bold text-sm text-slate-900">
                  Plafond de retrait — {editingLimitUser.name}
                </h3>
                <p className="text-[11px] text-slate-500">
                  Laissez vide ou cliquez « Réinitialiser » pour appliquer le plafond global du système.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingLimitUser(null)}
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-slate-100 text-slate-500 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Montant maximum autorisé par retrait (FCFA)
              </label>
              <input
                type="text"
                inputMode="numeric"
                value={limitInput}
                onChange={(e) => setLimitInput(e.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, ""))}
                placeholder="Ex: 1000000 (vide = plafond global)"
                className="w-full border-2 border-emerald-600 rounded-xl px-3.5 py-2.5 text-sm font-bold bg-white"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={savingLimit}
                onClick={() => handleSaveWithdrawalLimit(null)}
                className="px-3 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50 cursor-pointer"
              >
                Réinitialiser (Global)
              </button>
              <button
                type="button"
                disabled={savingLimit || !limitInput.trim() || Number(limitInput) < 500}
                onClick={() => handleSaveWithdrawalLimit(Number(limitInput))}
                className="flex-1 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {savingLimit ? "Enregistrement..." : "Enregistrer ce plafond"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de récupération de compte avec les identifiants générés */}
      {recoveryResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-surface-variant flex flex-col gap-4">
            <div className="flex items-center justify-between pb-2 border-b border-outline-variant/40">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-2xl">verified_user</span>
                <h3 className="font-title-sm font-bold text-on-surface">
                  {lang === "fr" ? "Récupération de compte réussie" : "Account Recovery Successful"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setRecoveryResult(null)}
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-container text-on-surface-variant cursor-pointer"
              >
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>

            <p className="text-xs text-on-surface-variant">
              {lang === "fr"
                ? `Les identifiants pour ${recoveryResult.userName} ont été réinitialisés et envoyés par email à ${recoveryResult.email}. Vous pouvez également lui communiquer directement :`
                : `Credentials for ${recoveryResult.userName} have been reset and sent by email to ${recoveryResult.email}. You can also share them directly:`}
            </p>

            <div className="bg-emerald-50/80 border border-emerald-200 rounded-xl p-4 flex flex-col gap-2.5 text-xs text-emerald-950 font-medium">
              <div>
                <span className="text-emerald-700 font-bold block mb-0.5">
                  {lang === "fr" ? "Identifiant de connexion :" : "Login Identifier:"}
                </span>
                <span className="font-mono text-sm font-bold bg-white px-2 py-1 rounded border border-emerald-200 block truncate">
                  {recoveryResult.email}
                  {recoveryResult.phone ? ` (ou ${recoveryResult.phone})` : ""}
                </span>
              </div>

              {recoveryResult.tempPassword && (
                <div>
                  <span className="text-emerald-700 font-bold block mb-0.5">
                    {lang === "fr" ? "Mot de passe temporaire généré :" : "Temporary Password:"}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-base font-extrabold bg-white px-2.5 py-1 rounded border border-emerald-300 text-primary tracking-wider flex-1 truncate">
                      {recoveryResult.tempPassword}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const text = `Identifiant DIVA : ${recoveryResult.email}\nMot de passe temporaire : ${recoveryResult.tempPassword}\nLien : https://divaasso.com/login`;
                        navigator.clipboard.writeText(text);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-primary text-white font-bold text-xs hover:bg-primary/90 flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <span className="material-symbols-outlined text-[15px]">
                        {copied ? "check" : "content_copy"}
                      </span>
                      <span>{copied ? (lang === "fr" ? "Copié !" : "Copied!") : (lang === "fr" ? "Copier" : "Copy")}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            <p className="text-[11px] text-on-surface-variant/80 italic">
              {lang === "fr"
                ? "Conseillez au membre de modifier son mot de passe depuis son profil après sa connexion."
                : "Advise the member to change their password from their profile after logging in."}
            </p>

            <button
              type="button"
              onClick={() => setRecoveryResult(null)}
              className="w-full py-2.5 rounded-xl bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-label-md text-xs font-semibold transition-colors cursor-pointer"
            >
              {lang === "fr" ? "Fermer" : "Close"}
            </button>
          </div>
        </div>
      )}

      {/* ── MODAL HISTORIQUE COMPLET MULTI-ANNÉES & PORTEFEUILLE (ADMIN) ── */}
      {historyUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-surface rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-outline-variant/30 flex flex-col gap-4 max-h-[90vh] overflow-hidden">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b border-outline-variant/20 pb-3 flex-shrink-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-title-md text-title-md text-on-surface font-bold truncate">
                    {historyUser.name}
                  </h3>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-800">
                    {lang === "fr" ? "Historique Permanent Multi-années" : "Permanent Multi-year History"}
                  </span>
                </div>
                <p className="text-xs text-on-surface-variant mt-0.5 truncate">
                  {historyUser.email} {historyUser.phone ? `· ${historyUser.phone}` : ""} {historyUser.memberCode ? `· ${historyUser.memberCode}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setHistoryUser(null);
                  setHistoryData(null);
                }}
                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface-container text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer flex-shrink-0"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* Overview Badges */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-shrink-0">
              <div className="p-3 bg-emerald-900 text-white rounded-xl shadow-xs">
                <p className="text-[11px] text-emerald-200/90 font-medium">
                  {lang === "fr" ? "Solde portefeuille" : "Wallet Balance"}
                </p>
                <p className="text-lg font-extrabold mt-0.5">
                  {historyData?.user ? historyData.user.formattedBalance : (loadingHistory ? "..." : "0 FCFA")}
                </p>
              </div>

              <div className="p-3 bg-slate-100 rounded-xl border border-slate-200">
                <p className="text-[11px] text-slate-500 font-medium">
                  {lang === "fr" ? "Total cotisé historique" : "Total Contributed"}
                </p>
                <p className="text-lg font-bold text-slate-800 mt-0.5">
                  {historyData?.formattedTotalContributed ?? (loadingHistory ? "..." : "0 FCFA")}
                </p>
              </div>

              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200">
                <p className="text-[11px] text-amber-700 font-medium">
                  {lang === "fr" ? "Taux frais recharge" : "Topup Fee Rate"}
                </p>
                <p className="text-lg font-bold text-amber-900 mt-0.5">
                  {historyData?.feeInfo ? `${historyData.feeInfo.percentage}%` : (loadingHistory ? "..." : "-")}
                </p>
              </div>
            </div>

            {/* Notice Archivage */}
            <div className="p-3 rounded-xl bg-teal-50 border border-teal-200/80 text-[11px] text-teal-950 flex items-start gap-2 flex-shrink-0">
              <span className="material-symbols-outlined text-[18px] text-teal-700 flex-shrink-0 mt-0.5">
                verified_user
              </span>
              <p>
                {lang === "fr"
                  ? "Règle de visibilité : Les membres voient uniquement leurs 3 premières opérations récentes et jusqu'à 30 jours dans leur application. Les opérations plus anciennes sont archivées pour eux, mais conservées ici de manière permanente pour l'administration sur plusieurs années."
                  : "Visibility rule: Members see only recent operations up to 30 days. Older operations are archived for them but permanently preserved here for the admin across multiple years."}
              </p>
            </div>

            {/* Transactions List */}
            <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-2 min-h-[220px]">
              {loadingHistory ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2 text-on-surface-variant">
                  <LoadingSpinner />
                  <p className="text-xs">{lang === "fr" ? "Chargement de tout l'historique..." : "Loading full history..."}</p>
                </div>
              ) : !historyData || historyData.operations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center text-on-surface-variant">
                  <span className="material-symbols-outlined text-[36px] opacity-40">receipt_long</span>
                  <p className="text-xs font-medium mt-1">
                    {lang === "fr" ? "Aucune opération enregistrée pour ce membre." : "No operations recorded for this member."}
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-outline-variant/20 border border-outline-variant/30 rounded-xl overflow-hidden bg-white">
                  {historyData.operations.map((tx) => {
                    const isCredit = tx.direction === "IN";
                    return (
                      <div key={tx.id} className="flex items-center justify-between p-3 gap-3 hover:bg-slate-50 transition-colors">
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${isCredit ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"
                              }`}
                          >
                            <span className="material-symbols-outlined text-[18px]">
                              {isCredit ? "arrow_downward" : "arrow_upward"}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-on-surface truncate">{tx.title}</p>
                            <p className="text-[11px] text-on-surface-variant truncate">
                              {tx.subtitle} · {tx.date}
                            </p>
                          </div>
                        </div>

                        <div className="text-right flex-shrink-0">
                          <p className={`text-xs font-extrabold ${isCredit ? "text-emerald-700" : "text-red-600"}`}>
                            {tx.formattedAmount}
                          </p>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {tx.type}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="pt-2 border-t border-outline-variant/20 flex items-center justify-end flex-shrink-0">
              <button
                type="button"
                onClick={() => {
                  setHistoryUser(null);
                  setHistoryData(null);
                }}
                className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs transition-colors cursor-pointer"
              >
                {lang === "fr" ? "Fermer" : "Close"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
