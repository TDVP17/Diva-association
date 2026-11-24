"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Lang } from "@/lib/i18n/translations";

interface SearchItem {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  icon: string;
  category: string;
  keywords: string[];
}

export function QuickSearch({
  lang,
  className = "",
  dark = false,
}: {
  lang: Lang;
  className?: string;
  dark?: boolean;
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const items: SearchItem[] = [
    {
      id: "dashboard",
      title: lang === "fr" ? "Accueil / Tableau de bord" : "Dashboard / Home",
      subtitle: lang === "fr" ? "Vue d'ensemble de vos finances et cotisations" : "Overview of finances and cotisations",
      href: "/dashboard",
      icon: "dashboard",
      category: lang === "fr" ? "Navigation" : "Navigation",
      keywords: ["accueil", "tableau", "bord", "home", "dashboard", "général", "coucou mon asso"],
    },
    {
      id: "wallet",
      title: lang === "fr" ? "Mon Portefeuille DIVA Asso" : "DIVA Asso Wallet",
      subtitle: lang === "fr" ? "Consulter solde, recharges et historiques" : "Check balance, top-ups and ledger",
      href: "/wallet",
      icon: "account_balance_wallet",
      category: lang === "fr" ? "Finances" : "Finances",
      keywords: ["portefeuille", "solde", "argent", "finance", "wallet", "dépôt", "recharge"],
    },
    {
      id: "withdraw",
      title: lang === "fr" ? "Effectuer un retrait" : "Withdraw Funds",
      subtitle: lang === "fr" ? "Transférer vers MTN MoMo ou Orange Money (0% frais)" : "Transfer to MTN MoMo or Orange Money (0% fees)",
      href: "/wallet",
      icon: "payments",
      category: lang === "fr" ? "Finances" : "Finances",
      keywords: ["retrait", "retirer", "décaissement", "momo", "orange money", "virement", "cash out"],
    },
    {
      id: "sessions",
      title: lang === "fr" ? "Mes Cotisations" : "My Cotisations",
      subtitle: lang === "fr" ? "Voir mes sessions, dates de bouffe et cotiser" : "View sessions, payout dates and contribute",
      href: "/sessions",
      icon: "groups",
      category: lang === "fr" ? "Cotisations" : "Cotisations",
      keywords: ["cotisation", "cotiser", "tontine", "session", "tour", "bouffe", "noms", "places"],
    },
    {
      id: "private-tontines",
      title: lang === "fr" ? "Créer une Cotisation Privée" : "Create Private Cotisation",
      subtitle: lang === "fr" ? "Lancer une tontine familiale, amicale ou d'entreprise" : "Launch family, friends or workplace tontine",
      href: "/private-tontines",
      icon: "add_circle_outline",
      category: lang === "fr" ? "Cotisations" : "Cotisations",
      keywords: ["créer", "création", "tontine privée", "groupe privé", "lancer", "nouvelle cotisation"],
    },
    {
      id: "global-payment",
      title: lang === "fr" ? "Paiement Groupé (Tout cotiser)" : "Bulk Contribution Payment",
      subtitle: lang === "fr" ? "Régler plusieurs noms ou cotisations en une seule fois" : "Pay multiple slots at once",
      href: "/global-payment",
      icon: "receipt_long",
      category: lang === "fr" ? "Paiements" : "Payments",
      keywords: ["paiement groupé", "payer tout", "bulk", "tous mes noms", "global"],
    },
    {
      id: "contribute-for-relative",
      title: lang === "fr" ? "Cotiser pour un proche" : "Pay for a Relative",
      subtitle: lang === "fr" ? "Payer la cotisation d'un membre avec son code" : "Pay a member's slot using their code",
      href: "/contribute-for-relative",
      icon: "volunteer_activism",
      category: lang === "fr" ? "Paiements" : "Payments",
      keywords: ["proche", "ami", "famille", "payer pour un autre", "relative", "code membre"],
    },
    {
      id: "loans",
      title: lang === "fr" ? "Prêt d'Urgence Garanti" : "Guaranteed Emergency Loan",
      subtitle: lang === "fr" ? "Obtenir un prêt instantané ou rembourser votre encours" : "Get emergency loan or repay active loan",
      href: "/loans",
      icon: "emergency",
      category: lang === "fr" ? "Crédit" : "Credit",
      keywords: ["prêt", "emprunter", "urgence", "crédit", "avance", "rembourser prêt", "remboursement"],
    },
    {
      id: "fines",
      title: lang === "fr" ? "Mes Amendes & Retards" : "Fines & Penalties",
      subtitle: lang === "fr" ? "Consulter et régulariser vos amendes de retard" : "Check and settle overdue fines",
      href: "/fines",
      icon: "warning",
      category: lang === "fr" ? "Cotisations" : "Cotisations",
      keywords: ["amende", "pénalité", "retard", "payer amende", "sanction"],
    },
    {
      id: "history",
      title: lang === "fr" ? "Historique des Transactions & Reçus" : "Transaction History & Receipts",
      subtitle: lang === "fr" ? "Télécharger vos reçus PDF et justificatifs" : "Download PDF receipts and proofs",
      href: "/history",
      icon: "history",
      category: lang === "fr" ? "Documents" : "Documents",
      keywords: ["historique", "reçu", "pdf", "télécharger", "preuve", "transactions", "justificatif"],
    },
    {
      id: "profile",
      title: lang === "fr" ? "Mon Profil & Numéros de Retrait" : "My Profile & Payout Numbers",
      subtitle: lang === "fr" ? "Gérer mes numéros validés, code PIN et sécurité" : "Manage approved numbers, PIN and security",
      href: "/profile",
      icon: "person",
      category: lang === "fr" ? "Paramètres" : "Settings",
      keywords: ["profil", "compte", "mot de passe", "nom", "téléphone", "numéro de retrait", "whitelist", "pin"],
    },
    {
      id: "chat",
      title: lang === "fr" ? "Assistance & Support en Direct" : "Live Support & Help",
      subtitle: lang === "fr" ? "Discuter directement avec l'équipe DIVA Asso" : "Chat with DIVA Asso team",
      href: "/chat",
      icon: "support_agent",
      category: lang === "fr" ? "Support" : "Support",
      keywords: ["support", "aide", "contact", "chat", "assistance", "service client", "message"],
    },
  ];

  // Filter items according to search query
  const cleanQuery = query.trim().toLowerCase();
  const filtered = cleanQuery
    ? items.filter((item) => {
        const inTitle = item.title.toLowerCase().includes(cleanQuery);
        const inSubtitle = item.subtitle.toLowerCase().includes(cleanQuery);
        const inKeywords = item.keywords.some((k) => k.toLowerCase().includes(cleanQuery));
        return inTitle || inSubtitle || inKeywords;
      })
    : items;

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Keyboard shortcut Ctrl+K / Cmd+K
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      } else if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery("");
    }
  }, [isOpen]);

  function handleSelect(href: string) {
    setIsOpen(false);
    router.push(href);
  }

  function handleInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % filtered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
    } else if (e.key === "Enter" && filtered[selectedIndex]) {
      e.preventDefault();
      handleSelect(filtered[selectedIndex].href);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        aria-label={lang === "fr" ? "Rechercher un menu ou un service" : "Search menus or services"}
        className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
          dark
            ? "text-white/80 hover:text-white hover:bg-white/10"
            : "text-on-surface-variant hover:text-primary hover:bg-surface-container"
        } ${className}`}
        title="Rechercher (Ctrl+K)"
      >
        <span className="material-symbols-outlined text-[20px]">search</span>
      </button>

      {/* Modal Dialog */}
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setIsOpen(false)}
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-xs pt-16 sm:pt-24 px-4 animate-in fade-in duration-150"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[80vh] animate-in zoom-in-95 duration-150"
          >
            {/* Search Input Bar */}
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-200 bg-slate-50/70">
              <span className="material-symbols-outlined text-[22px] text-[#025b34]">search</span>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder={
                  lang === "fr"
                    ? "Rechercher un menu, une action, un service..."
                    : "Search menu, action or service..."
                }
                className="w-full bg-transparent text-sm font-semibold text-slate-900 placeholder:text-slate-400 focus:outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="w-6 h-6 rounded-full hover:bg-slate-200 flex items-center justify-center text-slate-500"
                >
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
              )}
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 hidden sm:inline-block">
                ESC
              </span>
            </div>

            {/* Suggestions / Results */}
            <div className="flex-1 overflow-y-auto p-2 divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <div className="py-10 text-center text-slate-400 text-xs">
                  <span className="material-symbols-outlined text-3xl mb-1 text-slate-300 block">search_off</span>
                  {lang === "fr"
                    ? "Aucun résultat trouvé pour cette recherche."
                    : "No matching results found."}
                </div>
              ) : (
                filtered.map((item, index) => {
                  const isSelected = index === selectedIndex;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSelect(item.href)}
                      onMouseEnter={() => setSelectedIndex(index)}
                      className={`w-full flex items-center justify-between p-2.5 rounded-xl transition-all cursor-pointer text-left ${
                        isSelected
                          ? "bg-[#025b34]/10 border-l-4 border-[#025b34] text-slate-900"
                          : "hover:bg-slate-50 text-slate-700"
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
                            isSelected ? "bg-[#025b34] text-white" : "bg-slate-100 text-[#025b34]"
                          }`}
                        >
                          <span className="material-symbols-outlined text-[20px]">{item.icon}</span>
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs sm:text-sm font-extrabold truncate text-slate-900">
                            {item.title}
                          </p>
                          <p className="text-[11px] text-slate-500 truncate">{item.subtitle}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                          {item.category}
                        </span>
                        <span className="material-symbols-outlined text-[18px] text-slate-400">chevron_right</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Footer with hint */}
            <div className="px-4 py-2 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-[11px] text-slate-500">
              <span className="flex items-center gap-1 font-medium">
                <span className="material-symbols-outlined text-[14px] text-[#efc25b]">bolt</span>
                <span>{lang === "fr" ? "Accès rapide aux menus clés" : "Quick access to key menus"}</span>
              </span>
              <span className="text-[10px] text-slate-400">
                {lang === "fr" ? "Entrée pour ouvrir" : "Enter to open"}
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

