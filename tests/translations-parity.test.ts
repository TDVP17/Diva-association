import { describe, it, expect } from "vitest";
import { translations } from "@/lib/i18n/translations";

describe("EN/FR translation key parity", () => {
  const enKeys = new Set(Object.keys(translations.en));
  const frKeys = new Set(Object.keys(translations.fr));

  it("has no key present in en but missing from fr", () => {
    const missingFromFr = [...enKeys].filter((k) => !frKeys.has(k));
    expect(missingFromFr).toEqual([]);
  });

  it("has no key present in fr but missing from en", () => {
    const missingFromEn = [...frKeys].filter((k) => !enKeys.has(k));
    expect(missingFromEn).toEqual([]);
  });

  it("has no empty-string translation value in either language", () => {
    const isEmpty = (v: string) => v.length === 0;
    const emptyEn = Object.entries(translations.en).filter(([, v]) => isEmpty(v));
    const emptyFr = Object.entries(translations.fr).filter(([, v]) => isEmpty(v));
    expect(emptyEn).toEqual([]);
    expect(emptyFr).toEqual([]);
  });
});
