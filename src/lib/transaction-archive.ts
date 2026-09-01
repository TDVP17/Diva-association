import { readFile } from "fs/promises";
import path from "path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { prisma } from "@/lib/prisma";
import { formatXAF } from "@/lib/format-currency";

/**
 * Every calendar year (UTC) with any Contribution/Fine history for this
 * user, strictly before the current year (i.e. fully elapsed), that has no
 * TransactionArchive row yet. A year with zero transactions is never
 * archived — nothing to snapshot.
 */
export async function findYearsNeedingArchive(userId: string): Promise<number[]> {
  const currentYear = new Date().getUTCFullYear();

  const [contributions, fines, archives] = await Promise.all([
    prisma.contribution.findMany({
      where: { membershipSlot: { membership: { userId } } },
      select: { dueDate: true },
    }),
    prisma.fine.findMany({
      where: { membershipSlot: { membership: { userId } } },
      select: { dueDate: true },
    }),
    prisma.transactionArchive.findMany({ where: { userId }, select: { periodStart: true } }),
  ]);

  const archivedYears = new Set(archives.map((a) => a.periodStart.getUTCFullYear()));
  const candidateYears = new Set<number>();
  for (const c of contributions) {
    const y = c.dueDate.getUTCFullYear();
    if (y < currentYear) candidateYears.add(y);
  }
  for (const f of fines) {
    const y = f.dueDate.getUTCFullYear();
    if (y < currentYear) candidateYears.add(y);
  }

  return [...candidateYears].filter((y) => !archivedYears.has(y)).sort((a, b) => a - b);
}

interface ArchiveRow {
  date: Date;
  label: string;
  amount: number;
  status: string;
}

const PAGE_SIZE: [number, number] = [420, 620];
const LEFT = 40;
const RIGHT = 420 - 40;
const ROW_HEIGHT = 20;
const BOTTOM_MARGIN = 50;

function drawHeader(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  colors: { primary: ReturnType<typeof rgb>; muted: ReturnType<typeof rgb> },
  memberName: string,
  year: number,
  logoImage: Awaited<ReturnType<PDFDocument["embedPng"]>> | null,
): number {
  let y = 560;
  if (logoImage) {
    const logoSize = 32;
    page.drawImage(logoImage, { x: LEFT, y: y - logoSize + 6, width: logoSize, height: logoSize });
    page.drawText("DIVA Association", { x: LEFT + logoSize + 10, y, size: 16, font: bold, color: colors.primary });
    page.drawText(`Transaction Archive — ${year}`, {
      x: LEFT + logoSize + 10,
      y: y - 16,
      size: 10,
      font,
      color: colors.muted,
    });
  } else {
    page.drawText("DIVA Association", { x: LEFT, y, size: 16, font: bold, color: colors.primary });
    page.drawText(`Transaction Archive — ${year}`, { x: LEFT, y: y - 16, size: 10, font, color: colors.muted });
  }
  y -= 40;
  page.drawText(`Member: ${memberName}`, { x: LEFT, y, size: 10, font, color: colors.muted });
  y -= 14;
  page.drawText(`Archive period: 01/01/${year} → 31/12/${year}`, { x: LEFT, y, size: 10, font, color: colors.muted });
  y -= 14;
  page.drawText(`Archived on: ${new Date().toLocaleDateString("en-GB")}`, { x: LEFT, y, size: 10, font, color: colors.muted });
  y -= 24;
  page.drawLine({ start: { x: LEFT, y }, end: { x: RIGHT, y }, thickness: 1, color: rgb(0.9, 0.91, 0.91) });
  return y - 20;
}

export async function generateArchivePdf(memberName: string, year: number, rows: ArchiveRow[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const colors = { primary: rgb(0 / 255, 53 / 255, 40 / 255), muted: rgb(0.42, 0.5, 0.46) };
  const dark = rgb(0.1, 0.11, 0.11);

  let logoImage: Awaited<ReturnType<PDFDocument["embedPng"]>> | null = null;
  try {
    const logoBytes = await readFile(path.join(process.cwd(), "public", "icons", "icon-512.png"));
    logoImage = await doc.embedPng(logoBytes);
  } catch {
    // Logo optional — the archive is still valid without it.
  }

  let page = doc.addPage(PAGE_SIZE);
  let y = drawHeader(page, font, bold, colors, memberName, year, logoImage);

  let totalAmount = 0;
  for (const row of rows) {
    if (y < BOTTOM_MARGIN) {
      page = doc.addPage(PAGE_SIZE);
      y = drawHeader(page, font, bold, colors, memberName, year, logoImage);
    }
    const dateStr = row.date.toLocaleDateString("en-GB", { timeZone: "Africa/Douala" });
    page.drawText(dateStr, { x: LEFT, y, size: 9, font, color: dark });
    page.drawText(row.label, { x: LEFT + 70, y, size: 9, font, color: dark });
    page.drawText(row.status, { x: LEFT + 260, y, size: 9, font, color: colors.muted });
    const amountStr = formatXAF(row.amount);
    const amountWidth = font.widthOfTextAtSize(amountStr, 9);
    page.drawText(amountStr, { x: RIGHT - amountWidth, y, size: 9, font, color: dark });
    y -= ROW_HEIGHT;
    totalAmount += row.amount;
  }

  if (y < BOTTOM_MARGIN) {
    page = doc.addPage(PAGE_SIZE);
    y = drawHeader(page, font, bold, colors, memberName, year, logoImage);
  }
  y -= 6;
  page.drawLine({ start: { x: LEFT, y }, end: { x: RIGHT, y }, thickness: 1, color: rgb(0.9, 0.91, 0.91) });
  y -= 20;
  const totalStr = formatXAF(totalAmount);
  const totalWidth = bold.widthOfTextAtSize(totalStr, 11);
  page.drawText("Total for the year", { x: LEFT, y, size: 11, font: bold, color: colors.primary });
  page.drawText(totalStr, { x: RIGHT - totalWidth, y, size: 11, font: bold, color: colors.primary });

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}
