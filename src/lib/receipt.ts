import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { TontineType } from "@/generated/prisma/enums";

const TONTINE_LABELS: Record<TontineType, string> = {
  HEBDO_SUNDAY: "Weekly Tontine (Sunday)",
  MONTHLY_28: "Monthly Tontine (28th)",
  MONTHLY_25: "Monthly Tontine (25th)",
};

function formatXAF(amount: number): string {
  return `${amount.toLocaleString("en-US")} F`;
}

export interface ReceiptData {
  memberName: string;
  tontineType: TontineType;
  amount: number;
  fee: number;
  fine: number;
  total: number;
  transRef: string;
  paidAt: Date;
}

export async function generateReceiptPdf(data: ReceiptData): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([420, 560]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const primary = rgb(0 / 255, 53 / 255, 40 / 255);
  const muted = rgb(0.42, 0.5, 0.46);
  const dark = rgb(0.1, 0.11, 0.11);

  let y = 500;
  const left = 40;

  page.drawText("DIVA Associations", { x: left, y, size: 20, font: bold, color: primary });
  y -= 20;
  page.drawText("Payment Receipt", { x: left, y, size: 12, font, color: muted });
  y -= 40;

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

  row("Member", data.memberName);
  row("Tontine", TONTINE_LABELS[data.tontineType]);
  row("Date", data.paidAt.toLocaleString("en-GB", { timeZone: "Africa/Douala" }));
  row("Transaction Ref", data.transRef);
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
  y -= 10;
  row("Total Paid", formatXAF(data.total), { emphasize: true });

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
