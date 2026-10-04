import { readFile } from "fs/promises";
import path from "path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { formatXAF } from "@/lib/format-currency";

const ASSOCIATION_EMAIL = "divaassociation17@gmail.com";

export interface PayoutReceiptData {
  payoutId: string;
  memberName: string;
  beneficiaryName: string;
  sessionTitle: string;
  officialPosition: number | null;
  totalPositions?: number | null;
  pot: number;
  deductedContributions?: number;
  deductedFines?: number;
  deducted: number;
  netPayout: number;
  payoutPhone: string;
  payoutAccountName: string;
  fapshiTransId?: string | null;
  releasedAt: Date;
  status?: string;
}

export async function generatePayoutReceiptPdf(data: PayoutReceiptData): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([460, 680]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const primary = rgb(0 / 255, 53 / 255, 40 / 255); // #003528
  const emeraldAccent = rgb(5 / 255, 150 / 255, 105 / 255); // #059669
  const muted = rgb(0.42, 0.5, 0.46);
  const dark = rgb(0.1, 0.11, 0.11);
  const lineGray = rgb(0.88, 0.9, 0.89);

  let y = 620;
  const left = 40;
  const right = 460 - left;

  // Header with Logo
  try {
    const logoBytes = await readFile(path.join(process.cwd(), "public", "icons", "icon-512.png"));
    const logoImage = await doc.embedPng(logoBytes);
    const logoSize = 42;
    page.drawImage(logoImage, { x: left, y: y - logoSize + 10, width: logoSize, height: logoSize });
    page.drawText("DIVA Asso.", { x: left + logoSize + 12, y, size: 20, font: bold, color: primary });
    page.drawText("Reçu Officiel de Versement — Gain de Tontine", {
      x: left + logoSize + 12,
      y: y - 18,
      size: 11,
      font: bold,
      color: emeraldAccent,
    });
  } catch {
    page.drawText("DIVA Asso.", { x: left, y, size: 20, font: bold, color: primary });
    page.drawText("Reçu Officiel de Versement — Gain de Tontine", {
      x: left,
      y: y - 18,
      size: 11,
      font: bold,
      color: emeraldAccent,
    });
  }

  y -= 44;
  page.drawText(`Contact : ${ASSOCIATION_EMAIL}  |  Plateforme sécurisée de tontine`, {
    x: left,
    y,
    size: 8.5,
    font,
    color: muted,
  });

  y -= 20;
  page.drawLine({
    start: { x: left, y },
    end: { x: right, y },
    thickness: 1.5,
    color: primary,
  });
  y -= 25;

  const row = (label: string, value: string, opts?: { emphasize?: boolean; highlightColor?: typeof primary }) => {
    page.drawText(label, { x: left, y, size: 10.5, font, color: muted });
    const valueFont = opts?.emphasize ? bold : font;
    const valueSize = opts?.emphasize ? 12 : 10.5;
    const valueColor = opts?.highlightColor ?? (opts?.emphasize ? primary : dark);
    const textWidth = valueFont.widthOfTextAtSize(value, valueSize);
    page.drawText(value, {
      x: right - textWidth,
      y,
      size: valueSize,
      font: valueFont,
      color: valueColor,
    });
    y -= 24;
  };

  // Section 1: Informations Bénéficiaire & Cotisation
  page.drawText("DÉTAILS DU BÉNÉFICIAIRE & DE LA COTISATION", {
    x: left,
    y,
    size: 9.5,
    font: bold,
    color: primary,
  });
  y -= 18;

  row("Cotisation", data.sessionTitle);
  row("Membre titulaire", data.memberName);
  row("Nom de la part / créneau", data.beneficiaryName);

  const positionLabel = data.officialPosition
    ? data.totalPositions
      ? `Tour N° ${data.officialPosition} sur ${data.totalPositions}`
      : `Tour N° ${data.officialPosition}`
    : "Non attribué";
  row("Ordre / Position de bouffe", positionLabel);

  const dateStr = data.releasedAt.toLocaleDateString("fr-FR", {
    timeZone: "Africa/Douala",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const timeStr = data.releasedAt.toLocaleTimeString("fr-FR", {
    timeZone: "Africa/Douala",
    hour: "2-digit",
    minute: "2-digit",
  });
  row("Date & heure du virement", `${dateStr} à ${timeStr}`);

  y -= 6;
  page.drawLine({
    start: { x: left, y },
    end: { x: right, y },
    thickness: 1,
    color: lineGray,
  });
  y -= 20;

  // Section 2: Destination du virement
  page.drawText("COORDONNÉES DE RÉCEPTION", {
    x: left,
    y,
    size: 9.5,
    font: bold,
    color: primary,
  });
  y -= 18;

  row("Numéro Mobile Money / Orange Money crédité", `+237 ${data.payoutPhone}`);
  row("Titulaire du compte", data.payoutAccountName);
  if (data.fapshiTransId) {
    row("Référence de transaction (Fapshi)", data.fapshiTransId);
  }
  row("Statut du versement", data.status ?? "Confirmé & Validé", {
    emphasize: true,
    highlightColor: emeraldAccent,
  });

  y -= 6;
  page.drawLine({
    start: { x: left, y },
    end: { x: right, y },
    thickness: 1,
    color: lineGray,
  });
  y -= 20;

  // Section 3: Décompte Financier
  page.drawText("DÉCOMPTE FINANCIER", {
    x: left,
    y,
    size: 9.5,
    font: bold,
    color: primary,
  });
  y -= 18;

  row("Cagnotte brute (Pot total)", formatXAF(data.pot));

  if (data.deductedContributions && data.deductedContributions > 0) {
    row("Cotisation(s) propre(s) déduite(s)", `- ${formatXAF(data.deductedContributions)}`);
  }
  if (data.deductedFines && data.deductedFines > 0) {
    row("Amende(s) en retard déduite(s)", `- ${formatXAF(data.deductedFines)}`);
  } else if (data.deducted > 0 && !data.deductedContributions) {
    row("Total déductions (amendes / cotisations)", `- ${formatXAF(data.deducted)}`);
  }

  y -= 8;
  // Box for Net Payout
  page.drawRectangle({
    x: left,
    y: y - 26,
    width: right - left,
    height: 38,
    color: rgb(240 / 255, 253 / 255, 244 / 255), // light emerald
    borderColor: emeraldAccent,
    borderWidth: 1,
  });

  page.drawText("NET VIRÉ AU BÉNÉFICIAIRE :", {
    x: left + 12,
    y: y - 13,
    size: 11,
    font: bold,
    color: primary,
  });
  const netText = formatXAF(data.netPayout);
  const netWidth = bold.widthOfTextAtSize(netText, 14);
  page.drawText(netText, {
    x: right - 12 - netWidth,
    y: y - 13,
    size: 14,
    font: bold,
    color: emeraldAccent,
  });

  y -= 50;

  // Footer / Verification notice
  page.drawText("Ce document certifie la libération intégrale de la cagnotte pour ce tour de table.", {
    x: left,
    y,
    size: 8.5,
    font,
    color: muted,
  });
  y -= 14;
  page.drawText("Document généré électroniquement par DIVA Asso. — Fait foi d'attestation de gain.", {
    x: left,
    y,
    size: 8,
    font,
    color: muted,
  });

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}
