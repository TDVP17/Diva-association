import { readFile } from "fs/promises";
import path from "path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { TontineType } from "@/generated/prisma/enums";
import { TONTINE_TYPE_LABELS as TONTINE_LABELS } from "@/lib/tontine-labels";
import { formatXAF } from "@/lib/format-currency";

const ASSOCIATION_EMAIL = "divaassociation17@gmail.com";

function sanitizePdfText(input: string): string {
  // StandardFonts.Helvetica uses WinAnsi encoding; replace non-WinAnsi glyphs (e.g. emojis) safely.
  return input.replace(/[^\x20-\x7E\xA0-\xFF\u2013\u2014\u2018\u2019\u201C\u201D\u2026\u20AC]/g, "").trim();
}

export interface ReceiptData {
  /// The beneficiary — whose contribution this credits (or account owner name when beneficiaryNames is provided).
  memberName: string;
  /// Optional list of contributed slot/beneficiary names for a consolidated multi-slot receipt.
  beneficiaryNames?: string[];
  /// Who physically paid, only set when it differs from the beneficiary
  /// (admin manual entry or a relative/friend paying via their own code).
  paidByName?: string;
  paymentMethod?: string;
  /** @deprecated Excluded from payment receipts per user preference (no 3.1% gateway fee in receipts). */
  operatorName?: string | null;
  tontineType: TontineType;
  /** Optional session title (falls back to TONTINE_LABELS[tontineType]). */
  sessionLabel?: string;
  amount: number;
  fee?: number;
  fine: number;
  /** @deprecated Excluded from payment receipts per user preference (no 3.1% gateway fee in receipts). */
  paymentFee?: number;
  total: number;
  transRef: string;
  paidAt: Date;
}

export async function generateReceiptPdf(data: ReceiptData): Promise<Buffer> {
  const namesList = (data.beneficiaryNames ?? []).filter((n) => n.trim().length > 0);
  const hasMultipleNames = namesList.length > 1;
  const extraNamesHeight = hasMultipleNames ? namesList.length * 16 + 18 : 0;
  const pageHeight = Math.max(620, 560 + extraNamesHeight);

  const doc = await PDFDocument.create();
  const page = doc.addPage([420, pageHeight]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const primary = rgb(0 / 255, 53 / 255, 40 / 255);
  const muted = rgb(0.42, 0.5, 0.46);
  const dark = rgb(0.1, 0.11, 0.11);

  let y = pageHeight - 60;
  const left = 40;
  const right = 420 - left;

  try {
    const logoBytes = await readFile(path.join(process.cwd(), "public", "icons", "icon-512.png"));
    const logoImage = await doc.embedPng(logoBytes);
    const logoSize = 36;
    page.drawImage(logoImage, { x: left, y: y - logoSize + 8, width: logoSize, height: logoSize });
    page.drawText("DIVA Asso.", { x: left + logoSize + 10, y, size: 20, font: bold, color: primary });
    page.drawText("Payment Receipt", { x: left + logoSize + 10, y: y - 20, size: 12, font, color: muted });
  } catch {
    // Logo optional — the receipt is still valid without it.
    page.drawText("DIVA Asso.", { x: left, y, size: 20, font: bold, color: primary });
    page.drawText("Payment Receipt", { x: left, y: y - 20, size: 12, font, color: muted });
  }
  y -= 44;
  page.drawText(ASSOCIATION_EMAIL, { x: left, y, size: 9, font, color: muted });
  y -= 26;

  page.drawLine({
    start: { x: left, y },
    end: { x: right, y },
    thickness: 1,
    color: rgb(0.9, 0.91, 0.91),
  });
  y -= 30;

  const fitValue = (value: string, valueFont: typeof font, valueSize: number, maxWidth: number) => {
    const clean = sanitizePdfText(value);
    if (valueFont.widthOfTextAtSize(clean, valueSize) <= maxWidth) return clean;
    let trimmed = clean;
    while (trimmed.length > 3 && valueFont.widthOfTextAtSize(`${trimmed}...`, valueSize) > maxWidth) {
      trimmed = trimmed.slice(0, -1);
    }
    return `${trimmed}...`;
  };

  const row = (label: string, value: string, opts?: { emphasize?: boolean }) => {
    const safeLabel = sanitizePdfText(label);
    page.drawText(safeLabel, { x: left, y, size: 11, font, color: muted });
    const valueFont = opts?.emphasize ? bold : font;
    const valueSize = opts?.emphasize ? 13 : 11;
    const valueColor = opts?.emphasize ? primary : dark;
    const labelWidth = font.widthOfTextAtSize(safeLabel, 11);
    const maxValWidth = Math.max(110, right - left - labelWidth - 12);
    const safeValue = fitValue(value, valueFont, valueSize, maxValWidth);
    const textWidth = valueFont.widthOfTextAtSize(safeValue, valueSize);
    page.drawText(safeValue, {
      x: right - textWidth,
      y,
      size: valueSize,
      font: valueFont,
      color: valueColor,
    });
    y -= 26;
  };

  if (hasMultipleNames) {
    row("Membre", data.memberName);
    const listLabel = `Noms cotisés (${namesList.length})`;
    page.drawText(listLabel, { x: left, y, size: 11, font, color: muted });
    for (const itemName of namesList) {
      const safeName = fitValue(itemName, bold, 10.5, 220);
      const textWidth = bold.widthOfTextAtSize(safeName, 10.5);
      page.drawText(safeName, {
        x: right - textWidth,
        y,
        size: 10.5,
        font: bold,
        color: dark,
      });
      y -= 16;
    }
    y -= 10;
  } else {
    row("Name", data.memberName);
  }

  if (data.paidByName && data.paidByName !== data.memberName) {
    row("Paid by", data.paidByName);
  }
  row("Tontine", data.sessionLabel || TONTINE_LABELS[data.tontineType]);
  row("Payment method", data.paymentMethod ?? "Mobile Money / Orange Money");
  row("Date", data.paidAt.toLocaleString("en-GB", { timeZone: "Africa/Douala" }));
  row("Transaction Ref", data.transRef);
  row("Status", "Successful");
  y -= 10;

  page.drawLine({
    start: { x: left, y },
    end: { x: right, y },
    thickness: 1,
    color: rgb(0.9, 0.91, 0.91),
  });
  y -= 30;

  row("Cotisation pour le pot", formatXAF(data.amount));
  if (data.fee && data.fee > 0) row("Frais", formatXAF(data.fee));
  if (data.fine > 0) row("Pénalité de retard", formatXAF(data.fine));
  y -= 10;

  // Receipts strictly exclude the 3.1% operator fee
  const netTotal = data.amount + (data.fee || 0) + (data.fine || 0);
  const exactTotal = netTotal > 0 ? netTotal : data.total;
  row("TOTAL PAYÉ", formatXAF(exactTotal), { emphasize: true });

  y -= 30;
  page.drawText("Merci pour votre contribution chez DIVA asso.", {
    x: left,
    y,
    size: 9,
    font,
    color: muted,
  });

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}
