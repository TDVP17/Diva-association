"use client";

import { useEffect, useState } from "react";
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
  membershipCount: number;
  memberships: UserMembershipItem[];
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
    <div className="flex flex-col gap-stack-gap-md">
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
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap cursor-pointer ${
            filterTab === "all"
              ? "bg-primary text-on-primary shadow-xs"
              : "bg-surface-variant/40 hover:bg-surface-variant/70 text-on-surface-variant"
          }`}
        >
          {lang === "fr" ? "Tous" : "All"} ({total ?? users?.length ?? 0})
        </button>
        <button
          type="button"
          onClick={() => setFilterTab("pending")}
          className={`px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
            filterTab === "pending"
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
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap cursor-pointer ${
            filterTab === "members"
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
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap cursor-pointer ${
            filterTab === "none"
              ? "bg-slate-700 text-white shadow-xs"
              : "bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200"
          }`}
        >
          <span>{lang === "fr" ? "Sans cotisation" : "No cotisations"}</span>
          <span className="font-bold ml-0.5">({noneCount})</span>
        </button>
      </div>

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
        <div className="bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-outline-variant/30 overflow-hidden divide-y divide-outline-variant/30">
          {displayedUsers.map((u) => (
            <div
              key={u.id}
              className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 bg-surface-container-lowest hover:bg-surface-container-low/40 transition-colors"
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
                  </div>
                  <p className="font-label-sm text-xs text-on-surface-variant truncate mt-0.5">
                    {u.email}
                    {u.phone ? ` · ${u.phone}` : ""}
                  </p>
                  <p className="font-label-sm text-xs text-on-surface-variant truncate mt-0.5">
                    {u.memberCode ? `${u.memberCode} · ` : ""}
                    {u.city ? `${[u.city, u.neighborhood].filter(Boolean).join(", ")} · ` : ""}
                    {t("membershipCountLabel", { count: String(u.membershipCount) })}
                  </p>

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
                            className={`flex items-center justify-between gap-2 p-2 rounded-lg text-xs border ${
                              isPending
                                ? "bg-amber-50/90 border-amber-300 text-amber-950 font-medium"
                                : isApproved
                                  ? "bg-emerald-50/70 border-emerald-200 text-emerald-950"
                                  : "bg-slate-50 border-slate-200 text-slate-700"
                            }`}
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span
                                className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                                  isPending
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
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0 self-end sm:self-center mt-2 sm:mt-0">
                <Link
                  href={`/admin/support?with=${encodeURIComponent(u.id)}&name=${encodeURIComponent(u.name)}`}
                  className="px-2.5 py-1.5 rounded-md border border-primary/30 text-primary hover:bg-primary/10 font-label-sm text-xs font-semibold flex items-center gap-1 transition-colors"
                  title={lang === "fr" ? `Écrire à ${u.name}` : `Message ${u.name}`}
                >
                  <span className="material-symbols-outlined text-[16px]">chat</span>
                  <span>{lang === "fr" ? "Écrire" : "Chat"}</span>
                </Link>

                {u.role !== "ADMIN" && u.role !== "PRESIDENT" && (
                  <button
                    type="button"
                    onClick={async () => {
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
                    }}
                    className={`px-2.5 py-1.5 rounded-md font-label-sm text-xs font-medium border transition-colors cursor-pointer ${
                      u.isBanned
                        ? "border-emerald-300 text-emerald-800 bg-emerald-50 hover:bg-emerald-100"
                        : "border-error/30 text-error bg-error/5 hover:bg-error/15"
                    }`}
                  >
                    {u.isBanned ? (lang === "fr" ? "Débannir" : "Unban") : (lang === "fr" ? "Bannir" : "Ban")}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
