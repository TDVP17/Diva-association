/**
 * Canonical XAF/FCFA amount formatter -- "2 500 FCFA" (no-break space
 * thousands separator, "FCFA" suffix), matching fr-FR's own ICU currency
 * data for XAF. Used everywhere an amount is shown, in both languages --
 * FCFA doesn't translate, and this fixed layout reads naturally in English
 * too, so the locale here is intentionally always "fr-FR" regardless of
 * the active UI language.
 *
 * fr-FR's ICU data separates groups with U+202F (narrow no-break space),
 * which pdf-lib's WinAnsi-encoded standard fonts (used for receipt PDFs,
 * see src/lib/receipt.ts) cannot render -- it throws rather than
 * substituting a fallback glyph. Normalized to U+00A0 (regular no-break
 * space) instead, which is both WinAnsi-safe and visually identical, so
 * this one function stays safe to call from every context (web + PDF)
 * without needing a separate PDF-specific variant.
 */
const NARROW_NO_BREAK_SPACE = " ";
const NO_BREAK_SPACE = " ";

export function formatXAF(amount: number): string {
  const formatted = new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "XAF",
    maximumFractionDigits: 0,
  }).format(amount);
  return formatted.split(NARROW_NO_BREAK_SPACE).join(NO_BREAK_SPACE);
}
