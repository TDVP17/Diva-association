import { describe, it, expect } from "vitest";
import { PDFDocument, decodePDFRawStream, PDFRawStream, PDFName, PDFArray } from "pdf-lib";
import { generateReceiptPdf } from "@/lib/receipt";
import { formatXAF } from "@/lib/format-currency";

function extractPageDrawnText(doc: PDFDocument): string {
  const page = doc.getPage(0);
  const contentsEntry = page.node.get(PDFName.of("Contents"));
  const refs: unknown[] = [];

  if (contentsEntry instanceof PDFArray) {
    for (let i = 0; i < contentsEntry.size(); i++) {
      refs.push(contentsEntry.get(i));
    }
  } else if (contentsEntry) {
    refs.push(contentsEntry);
  }

  let ops = "";
  for (const ref of refs) {
    const obj = doc.context.lookup(ref as never);
    if (obj instanceof PDFRawStream) {
      const bytes = decodePDFRawStream(obj).decode();
      ops += Buffer.from(bytes).toString("latin1") + "\n";
    }
  }

  const decodedTokens: string[] = [];
  const tokenRegex = /<([0-9A-Fa-f]+)>|\(([^()]*(?:\\.[^()]*)*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRegex.exec(ops)) !== null) {
    if (m[1]) {
      decodedTokens.push(Buffer.from(m[1], "hex").toString("latin1"));
    } else if (m[2]) {
      decodedTokens.push(m[2].replace(/\\([()\\])/g, "$1"));
    }
  }
  return decodedTokens.join("\n");
}

describe("generateReceiptPdf", () => {
  it("generates a single-slot PDF excluding 3.1% operator fees and containing the updated DIVA asso footer", async () => {
    const bytes = await generateReceiptPdf({
      memberName: "Femme Batcham Bertoua — Joël1",
      paymentMethod: "Mobile Money / Orange Money",
      operatorName: "Orange Money",
      tontineType: "HEBDO_SUNDAY",
      sessionLabel: "Chaque dimanche",
      amount: 2500,
      fee: 100,
      fine: 0,
      paymentFee: 81,
      total: 2681,
      transRef: "tx-single-1",
      paidAt: new Date("2026-11-08T12:00:00Z"),
    });

    expect(bytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getHeight()).toBe(620);

    const drawn = extractPageDrawnText(doc);
    expect(drawn).toContain("Merci pour votre contribution chez DIVA asso.");
    expect(drawn).not.toContain("caisse commune");
    expect(drawn).toContain(formatXAF(2600));
    expect(drawn).not.toContain("2681");
    expect(drawn).not.toContain(formatXAF(2681));
    expect(drawn).not.toContain("3,1%");
  });

  it("generates a consolidated multi-name PDF listing all 10 names and expanding page height cleanly", async () => {
    const tenNames = Array.from({ length: 10 }, (_, idx) => `Joël${idx + 1}`);
    const bytes = await generateReceiptPdf({
      memberName: "Femme Batcham Bertoua",
      beneficiaryNames: tenNames,
      paymentMethod: "Mobile Money / Orange Money",
      operatorName: "MTN Mobile Money",
      tontineType: "HEBDO_SUNDAY",
      sessionLabel: "Chaque dimanche",
      amount: 25000,
      fee: 1000,
      fine: 0,
      paymentFee: 806,
      total: 26806,
      transRef: "tx-bulk-10",
      paidAt: new Date("2026-11-08T12:00:00Z"),
    });

    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getHeight()).toBeGreaterThan(620);

    const drawn = extractPageDrawnText(doc);
    expect(drawn).toContain("Noms cotisés (10)");
    for (const name of tenNames) {
      expect(drawn).toContain(name);
    }
    expect(drawn).toContain(formatXAF(26000));
    expect(drawn).not.toContain(formatXAF(26806));
    expect(drawn).toContain("Merci pour votre contribution chez DIVA asso.");
  });
});
