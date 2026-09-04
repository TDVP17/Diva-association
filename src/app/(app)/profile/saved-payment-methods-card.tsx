"use client";

import { useEffect, useState } from "react";
import { translate, translateIfKnown, type Lang, type TranslationKey } from "@/lib/i18n/translations";
import { parseJsonOrThrow, friendlyErrorMessage } from "@/lib/api-error";
import { detectMobileMoneyProvider } from "@/lib/mobile-money-provider";
import { LoadingSpinner } from "@/components/loading-spinner";
import type { MobileMoneyProvider } from "@/generated/prisma/enums";

interface SavedMethod {
  id: string;
  provider: MobileMoneyProvider;
  label: string | null;
  phone: string;
  isDefault: boolean;
}

function providerLabelKey(provider: MobileMoneyProvider): TranslationKey {
  return provider === "ORANGE" ? "orangeMoneyLabel" : "mtnMobileMoneyLabel";
}

/**
 * Lets a member maintain several payer numbers (e.g. one Orange, one MTN)
 * and mark one as default — the same list PaymentConfirmDialog offers
 * inline mid-payment, surfaced here as a standalone place to manage them
 * (add/remove/set default) without being in the middle of paying for
 * something. Provider badges are always server-derived; nothing here lets
 * the user claim a number is a network it isn't.
 */
export function SavedPaymentMethodsCard({ lang }: { lang: Lang }) {
  const t = (key: TranslationKey, vars?: Record<string, string>) => translate(lang, key, vars);
  const [methods, setMethods] = useState<SavedMethod[] | null>(null);
  const [newPhone, setNewPhone] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function refresh() {
    fetch("/api/profile/payment-methods")
      .then((res) => (res.ok ? res.json() : { methods: [] }))
      .then((body: { methods: SavedMethod[] }) => setMethods(body.methods))
      .catch(() => setMethods([]));
  }

  useEffect(() => {
    refresh();
  }, []);

  const detectedProvider = newPhone.trim()
    ? detectMobileMoneyProvider(newPhone.replace(/\D/g, "").replace(/^237/, ""))
    : null;

  async function handleAdd() {
    setAdding(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/profile/payment-methods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: newPhone }),
      });
      await parseJsonOrThrow(res, t("somethingWentWrong"));
      setNewPhone("");
      setSuccess(t("payerNumberSaved"));
      refresh();
    } catch (err) {
      setError(friendlyErrorMessage(err, t("somethingWentWrong"), (key, vars) => translateIfKnown(lang, key, vars)));
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id: string) {
    setBusyId(id);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/profile/payment-methods/${id}`, { method: "DELETE" });
      await parseJsonOrThrow(res, t("somethingWentWrong"));
      refresh();
    } catch (err) {
      setError(friendlyErrorMessage(err, t("somethingWentWrong")));
    } finally {
      setBusyId(null);
    }
  }

  async function handleSetDefault(id: string) {
    setBusyId(id);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/profile/payment-methods/${id}/set-default`, { method: "POST" });
      await parseJsonOrThrow(res, t("somethingWentWrong"));
      refresh();
    } catch (err) {
      setError(friendlyErrorMessage(err, t("somethingWentWrong")));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="mb-stack-gap-lg bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant p-4">
      <h2 className="font-title-md text-title-md text-on-surface mb-1">{t("savedPayerNumbersTitle")}</h2>
      <p className="font-label-sm text-label-sm text-on-surface-variant mb-stack-gap-md">
        {t("savedPayerNumbersBody")}
      </p>

      {methods === null ? (
        <LoadingSpinner />
      ) : (
        <>
          {methods.length > 0 && (
            <div className="flex flex-col gap-2 mb-stack-gap-md">
              {methods.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center gap-2 border border-outline-variant rounded-lg px-3 py-2"
                >
                  <span
                    className={`px-1.5 py-0.5 rounded font-label-sm text-[10px] uppercase tracking-wide flex-shrink-0 ${
                      m.provider === "ORANGE" ? "bg-orange-100 text-orange-700" : "bg-yellow-100 text-yellow-800"
                    }`}
                  >
                    {t(providerLabelKey(m.provider))}
                  </span>
                  <span className="font-label-md text-label-md text-on-surface truncate flex-1">
                    {m.label || m.phone}
                  </span>
                  {m.isDefault ? (
                    <span className="font-label-sm text-[11px] text-primary flex-shrink-0">
                      {t("defaultPayerLabel")}
                    </span>
                  ) : (
                    <button
                      onClick={() => handleSetDefault(m.id)}
                      disabled={busyId === m.id}
                      className="font-label-sm text-[11px] text-primary underline flex-shrink-0 disabled:opacity-60"
                    >
                      {t("setAsDefaultAction")}
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(m.id)}
                    disabled={busyId === m.id}
                    aria-label={t("removePayerNumberAction")}
                    className="text-on-surface-variant hover:text-error flex-shrink-0 disabled:opacity-60"
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      {busyId === m.id ? "hourglass_empty" : "delete"}
                    </span>
                  </button>
                </div>
              ))}
            </div>
          )}

          {methods.length < 4 && (
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <input
                  type="tel"
                  inputMode="tel"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder={t("mobileMoneyPhonePlaceholder")}
                  className="flex-1 min-w-0 border border-outline-variant rounded-lg px-3 py-2 font-label-md text-label-md"
                />
                <button
                  onClick={handleAdd}
                  disabled={adding || !newPhone.trim()}
                  className="px-3 py-2 rounded-lg bg-primary text-on-primary font-label-sm text-label-sm hover:opacity-90 active:scale-95 transition-all disabled:opacity-60 flex-shrink-0"
                >
                  {adding ? t("savingEllipsis") : t("addPayerNumberAction")}
                </button>
              </div>
              {detectedProvider && (
                <span
                  className={`self-start px-1.5 py-0.5 rounded font-label-sm text-[10px] uppercase tracking-wide ${
                    detectedProvider === "ORANGE" ? "bg-orange-100 text-orange-700" : "bg-yellow-100 text-yellow-800"
                  }`}
                >
                  {t(providerLabelKey(detectedProvider))}
                </span>
              )}
            </div>
          )}

          {error && <p className="font-label-sm text-label-sm text-error mt-2">{error}</p>}
          {success && <p className="font-label-sm text-label-sm text-primary mt-2">{success}</p>}
        </>
      )}
    </section>
  );
}
