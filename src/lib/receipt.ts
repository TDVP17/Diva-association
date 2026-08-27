import { readFile } from "fs/promises";
import path from "path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { TontineType } from "@/generated/prisma/enums";

const TONTINE_LABELS: Record<TontineType, string> = {
  HEBDO_SUNDAY: "Weekly Tontine (Sunday)",
  MONTHLY_28: "Monthly Tontine (28th)",
  MONTHLY_25: "Monthly Tontine (25th)",
  BIWEEKLY_SUNDAY: "Every 2 Weeks (Sunday)",
  QUARTERLY_25: "Every 3 Months (25th)",
};

const ASSOCIATION_EMAIL = "divaassociation17@gmail.com";

function formatXAF(amount: number): string {
  return `${amount.toLocaleString("en-US")} F`;
}

export interface ReceiptData {
  /// The beneficiary — whose contribution this credits.
  memberName: string;
  /// Who physically paid, only set when it differs from the beneficiary
  /// (admin manual entry or a relative/friend paying via their own code).
  paidByName?: string;
  paymentMethod?: string;
  tontineType: TontineType;
  amount: number;
  fee: number;
  fine: number;
  /// Total payment-gateway processing fee (e.g. Fapshi's combined 3.3%) —
  /// the total only, never the internal gateway/president split.
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
    page.drawText("DIVA Association", { x: left + logoSize + 10, y, size: 20, font: bold, color: primary });
    page.drawText("Payment Receipt", { x: left + logoSize + 10, y: y - 20, size: 12, font, color: muted });
  } catch {
    // Logo optional — the receipt is still valid without it.
    page.drawText("DIVA Association", { x: left, y, size: 20, font: bold, color: primary });
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
  row("Payment method", data.paymentMethod ?? "Mobile Money (Fapshi)");
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

  row("Contribution", formatXAF(data.amount));
  row("Fee", formatXAF(data.fee));
  if (data.fine > 0) row("Late fine", formatXAF(data.fine));
  if (data.paymentFee) row("Payment fee", formatXAF(data.paymentFee));
  y -= 10;
  row("Total Deducted", formatXAF(data.total), { emphasize: true });

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
