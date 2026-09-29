"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { translate, type Lang } from "@/lib/i18n/translations";
import { LoadingSpinner } from "@/components/loading-spinner";
import { ROLE_KEY } from "@/lib/role-label";

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
  isBanned?: boolean;
  bannedAt?: string | null;
  createdAt: string;
}

const ROLE_CLASS: Record<string, string> = {
  MEMBER: "bg-secondary-fixed text-on-secondary-fixed-variant",
  ADMIN: "bg-secondary-container/40 text-on-secondary-container",
  PRESIDENT: "bg-[#d1fae5] text-[#065f46]",
};

export function AdminUsersClient({ lang }: { lang: Lang }) {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [query, setQuery] = useState("");

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

      {!users ? (
        <LoadingSpinner fullPage />
      ) : users.length === 0 ? (
        <p className="font-label-sm text-label-sm text-on-surface-variant">{t("noUsersFound")}</p>
      ) : (
        <div className="bg-surface rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-outline-variant/30 overflow-hidden">
          {users.map((u, i) => (
            <div
              key={u.id}
              className={`flex items-center gap-3 p-3 bg-surface-container-lowest ${i < users.length - 1 ? "border-b border-outline-variant/30" : ""}`}
            >
              <div className="w-10 h-10 rounded-full bg-tertiary-container text-on-tertiary flex items-center justify-center font-label-md text-label-md overflow-hidden flex-shrink-0">
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
                <p className="font-label-sm text-label-sm text-on-surface-variant truncate">
                  {u.email}
                  {u.phone ? ` · ${u.phone}` : ""}
                </p>
                <p className="font-label-sm text-label-sm text-on-surface-variant truncate">
                  {u.memberCode ? `${u.memberCode} · ` : ""}
                  {t("membershipCountLabel", { count: String(u.membershipCount) })}
                  {u.city ? ` · ${[u.city, u.neighborhood].filter(Boolean).join(", ")}` : ""}
                </p>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
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
                    className={`px-2.5 py-1.5 rounded-md font-label-sm text-xs font-medium border transition-colors ${
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
