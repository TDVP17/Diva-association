import { readFile } from "fs/promises";
import path from "path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { TontineType } from "@/generated/prisma/enums";
import { TONTINE_TYPE_LABELS as TONTINE_LABELS } from "@/lib/tontine-labels";
import { formatXAF } from "@/lib/format-currency";

const ASSOCIATION_EMAIL = "divaassociation17@gmail.com";

export interface ReceiptData {
  /// The beneficiary — whose contribution this credits.
  memberName: string;
  /// Who physically paid, only set when it differs from the beneficiary
  /// (admin manual entry or a relative/friend paying via their own code).
  paidByName?: string;
  paymentMethod?: string;
  operatorName?: string | null;
  tontineType: TontineType;
  amount: number;
  fee?: number;
  fine: number;
  /// Total payment-gateway / operator processing fee (3.1%)
  paymentFee?: number;
  total: number;
  transRef: string;
  paidAt: Date;
}

export async function generateReceiptPdf(data: ReceiptData): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([420, 620]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const primary = rgb(0 / 255, 53 / 255, 40 / 255);
  const muted = rgb(0.42, 0.5, 0.46);
  const dark = rgb(0.1, 0.11, 0.11);

  let y = 560;
  const left = 40;

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
    end: { x: 420 - left, y },
    thickness: 1,
    color: rgb(0.9, 0.91, 0.91),
  });
  y -= 30;

  const row = (label: string, value: string, opts?: { emphasize?: boolean }) => {
    page.drawText(label, { x: left, y, size: 11, font, color: muted });
    const valueFont = opts?.emphasize ? bold : font;
    const valueSize = opts?.emphasize ? 13 : 11;
    const valueColor = opts?.emphasize ? primary : dark;
    const textWidth = valueFont.widthOfTextAtSize(value, valueSize);
    page.drawText(value, {
      x: 420 - left - textWidth,
      y,
      size: valueSize,
      font: valueFont,
      color: valueColor,
    });
    y -= 26;
  };

  row("Name", data.memberName);
  if (data.paidByName && data.paidByName !== data.memberName) {
    row("Paid by", data.paidByName);
  }
  row("Tontine", TONTINE_LABELS[data.tontineType]);
  row("Payment method", data.paymentMethod ?? "Mobile Money / Orange Money");
  row("Date", data.paidAt.toLocaleString("en-GB", { timeZone: "Africa/Douala" }));
  row("Transaction Ref", data.transRef);
  row("Status", "Successful");
  y -= 10;

  page.drawLine({
    start: { x: left, y },
    end: { x: 420 - left, y },
    thickness: 1,
    color: rgb(0.9, 0.91, 0.91),
  });
  y -= 30;

  row("Cotisation pour le pot", formatXAF(data.amount));
  if (data.fee && data.fee > 0) row("Frais Diva Asso", formatXAF(data.fee));
  if (data.fine > 0) row("Pénalité de retard", formatXAF(data.fine));
  if (data.paymentFee && data.paymentFee > 0) {
    const opLabel = data.operatorName ? `Frais ${data.operatorName}` : "Frais opérateur (3,1%)";
    row(opLabel, formatXAF(data.paymentFee));
  }
  y -= 10;
  const exactTotal =
    data.total > 0
      ? data.total
      : data.amount + (data.fee || 0) + (data.fine || 0) + (data.paymentFee || 0);
  row("TOTAL PAYÉ", formatXAF(exactTotal), { emphasize: true });

  y -= 30;
  page.drawText("Thank you for your contribution to the community fund.", {
    x: left,
    y,
    size: 9,
    font,
    color: muted,
  });

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}
