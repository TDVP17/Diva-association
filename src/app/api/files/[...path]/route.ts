import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { readStoredFile } from "@/lib/storage";
import { mimeTypeFor } from "@/lib/mime";
import { isAdminRole } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { generateReceiptPdf } from "@/lib/receipt";
import { TONTINE_TYPE_LABELS } from "@/lib/tontine-labels";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const langParam = new URL(_request.url).searchParams.get("lang");
  const userLang: "fr" | "en" =
    langParam === "en" || langParam === "fr"
      ? langParam
      : (session.user as { preferredLang?: string })?.preferredLang === "en"
        ? "en"
        : "fr";

  const { path: segments } = await params;
  if (!segments || segments.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Flexible routing for bulk receipts:
  // - 1 segment:  /api/files/bulk-{id}(-owner|-payer)?.pdf
  // - 2 segments: /api/files/receipts/bulk-{id}(-owner|-payer)?.pdf
  // - 3 segments: /api/files/receipts/{ownerId}/bulk-{id}(-owner|-payer)?.pdf
  const firstSeg = segments[0] ?? "";
  const lastSeg = segments[segments.length - 1] ?? "";
  const directBulkMatch =
    firstSeg.match(/^bulk-([a-zA-Z0-9_-]+?)(?:-(owner|payer))?\.pdf$/) ||
    lastSeg.match(/^bulk-([a-zA-Z0-9_-]+?)(?:-(owner|payer))?\.pdf$/);

  let category: string;
  let ownerId: string;
  let filename: string;

  if (directBulkMatch) {
    category = "receipts";
    filename = directBulkMatch[0];
    ownerId = segments.length >= 3 ? segments[1] : session.user.id;
  } else {
    if (segments.length < 3) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    category = segments[0];
    ownerId = segments[1];
    filename = segments[2];
  }

  const isOwner = session.user.id === ownerId;
  const isAdmin = isAdminRole(session.user.role);
  const isPublicCategory = category === "avatars";

  // Live consolidated bulk payment receipt:
  // /api/files/receipts/{targetUserId}/bulk-{bulkPaymentId}(-owner|-payer)?.pdf
  const bulkMatch =
    category === "receipts"
      ? filename.match(/^bulk-([a-zA-Z0-9_-]+?)(?:-(owner|payer))?\.pdf$/)
      : null;

  if (bulkMatch) {
    const [, bulkPaymentId, roleHint] = bulkMatch;
    try {
      const bulkPayment = await prisma.bulkPayment.findUnique({
        where: { id: bulkPaymentId },
        include: {
          user: true,
          contributions: {
            include: {
              membershipSlot: {
                include: {
                  membership: {
                    include: { user: true, tontineSession: true },
                  },
                },
              },
              paidByUser: true,
            },
            orderBy: { createdAt: "asc" },
          },
        },
      });

      if (bulkPayment && bulkPayment.contributions.length > 0) {
        const isBulkPayer = bulkPayment.userId === session.user.id;
        const ownsSomeContrib = bulkPayment.contributions.some(
          (c) => c.membershipSlot.membership.userId === session.user.id,
        );
        if (!isAdmin && !isBulkPayer && !ownsSomeContrib) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const scoped =
          roleHint === "owner" || (roleHint !== "payer" && ownerId !== bulkPayment.userId)
            ? bulkPayment.contributions.filter(
                (c) => c.membershipSlot.membership.userId === ownerId,
              )
            : bulkPayment.contributions;

        const targetContribs = scoped.length > 0 ? scoped : bulkPayment.contributions;
        const firstOwner = targetContribs[0].membershipSlot.membership.user;
        const firstSession = targetContribs[0].membershipSlot.membership.tontineSession;

        const distinctSessions = [
          ...new Set(
            targetContribs.map(
              (c) =>
                c.membershipSlot.membership.tontineSession.title ||
                TONTINE_TYPE_LABELS[c.membershipSlot.membership.tontineSession.type] ||
                c.membershipSlot.membership.tontineSession.type,
            ),
          ),
        ];

        const beneficiaryNames = targetContribs.map((c) => {
          const baseName = c.membershipSlot.beneficiaryName;
          if (distinctSessions.length <= 1) return baseName;
          const s = c.membershipSlot.membership.tontineSession;
          const sLabel = s.title || TONTINE_TYPE_LABELS[s.type] || s.type;
          return `${baseName} (${sLabel})`;
        });

        const amount = targetContribs.reduce((sum, c) => sum + Number(c.amountPaid), 0);
        const fee = targetContribs.reduce((sum, c) => sum + Number(c.feePaid), 0);
        const fine = targetContribs.reduce((sum, c) => sum + Number(c.finePaid), 0);
        const totalPaid = amount + fee + fine;

        const isRelative = targetContribs.some(
          (c) => c.paidByUserId && c.paidByUserId !== c.membershipSlot.membership.userId,
        );
        const paidByName = isRelative
          ? targetContribs.find((c) => c.paidByUser)?.paidByUser?.name ?? bulkPayment.user?.name
          : undefined;

        const isBulkFromWallet =
          bulkPayment.payerPhone === "DIVA_WALLET" ||
          (bulkPayment.transId && bulkPayment.transId.includes("WALLET")) ||
          targetContribs.some((c) => c.payerPhone === "DIVA_WALLET");

        const bulkPhone =
          bulkPayment.payerPhone && bulkPayment.payerPhone !== "DIVA_WALLET"
            ? bulkPayment.payerPhone
            : targetContribs.find((c) => c.payerPhone && c.payerPhone !== "DIVA_WALLET")?.payerPhone ||
              bulkPayment.user?.phone ||
              null;

        const bulkPaymentMethod = isBulkFromWallet
          ? (userLang === "fr" ? "Portefeuille DIVA Asso" : "DIVA Asso Wallet")
          : bulkPhone || (userLang === "fr" ? "Mobile Money / Orange Money" : "Mobile Money / Orange Money");

        const pdfBytes = await generateReceiptPdf({
          lang: userLang,
          memberName:
            beneficiaryNames.length === 1
              ? `${firstOwner.name} — ${beneficiaryNames[0]}`
              : firstOwner.name,
          beneficiaryNames: beneficiaryNames.length > 1 ? beneficiaryNames : undefined,
          paidByName,
          paymentMethod: bulkPaymentMethod,
          tontineType: firstSession.type,
          sessionLabel:
            distinctSessions.length === 1
              ? distinctSessions[0]
              : distinctSessions.join(", "),
          amount,
          fee,
          fine,
          total: totalPaid,
          transRef: bulkPayment.transId ?? bulkPayment.id,
          paidAt: targetContribs[0].paidAt ?? targetContribs[0].createdAt,
        });

        const downloadFilename =
          userLang === "fr"
            ? `Recu_DIVA_Paiement_${bulkPayment.transId ?? bulkPaymentId}.pdf`
            : `Receipt_DIVA_Payment_${bulkPayment.transId ?? bulkPaymentId}.pdf`;
        return new NextResponse(new Uint8Array(pdfBytes), {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${downloadFilename}"`,
            "Cache-Control": "private, max-age=0, no-store",
          },
        });
      }
    } catch {
      // Fallback below
    }
  }

  // Live single-contribution receipt (always strictly excludes 3.1% gateway fee):
  if (category === "receipts" && filename.endsWith(".pdf")) {
    const contributionId = filename.replace(/\.pdf$/, "");
    try {
      const contrib = await prisma.contribution.findUnique({
        where: { id: contributionId },
        include: {
          membershipSlot: {
            include: {
              membership: {
                include: { user: true, tontineSession: true },
              },
            },
          },
          paidByUser: true,
        },
      });
      if (contrib) {
        const u = contrib.membershipSlot.membership.user;
        const canAccessContrib =
          isOwner ||
          isAdmin ||
          session.user.id === u.id ||
          (contrib.paidByUserId !== null && contrib.paidByUserId === session.user.id);
        if (!canAccessContrib) {
          return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        const s = contrib.membershipSlot.membership.tontineSession;
        const totalPaid =
          Number(contrib.amountPaid) +
          Number(contrib.feePaid) +
          Number(contrib.finePaid);
        const paidByName =
          contrib.paidByUser && contrib.paidByUser.id !== u.id
            ? contrib.paidByUser.name
            : undefined;

        const isContribFromWallet =
          contrib.payerPhone === "DIVA_WALLET" ||
          Boolean(contrib.fapshiTxRef && contrib.fapshiTxRef.startsWith("wtx_"));

        const contribPhone =
          contrib.payerPhone && contrib.payerPhone !== "DIVA_WALLET"
            ? contrib.payerPhone
            : contrib.paidByUser?.phone || u.phone || null;

        const contribPaymentMethod = isContribFromWallet
          ? (userLang === "fr" ? "Portefeuille DIVA Asso" : "DIVA Asso Wallet")
          : contrib.recordedByAdminId
            ? (userLang === "fr" ? "Enregistré par l'administrateur" : "Recorded by admin")
            : contribPhone || (userLang === "fr" ? "Mobile Money / Orange Money" : "Mobile Money / Orange Money");

        const pdfBytes = await generateReceiptPdf({
          lang: userLang,
          memberName: `${u.name} — ${contrib.membershipSlot.beneficiaryName}`,
          paidByName,
          paymentMethod: contribPaymentMethod,
          tontineType: s.type,
          sessionLabel: s.title || TONTINE_TYPE_LABELS[s.type],
          amount: Number(contrib.amountPaid),
          fee: Number(contrib.feePaid),
          fine: Number(contrib.finePaid),
          total: totalPaid,
          transRef: contrib.fapshiTxRef ?? contrib.id,
          paidAt: contrib.paidAt ?? contrib.createdAt,
        });
        const downloadFilename =
          userLang === "fr"
            ? `Recu_DIVA_Cotisation_${contrib.fapshiTxRef ?? contrib.id}.pdf`
            : `Receipt_DIVA_Contribution_${contrib.fapshiTxRef ?? contrib.id}.pdf`;
        return new NextResponse(new Uint8Array(pdfBytes), {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename="${downloadFilename}"`,
            "Cache-Control": "private, max-age=0, no-store",
          },
        });
      }
    } catch {
      // Fallback to reading file from storage
    }
  }

  if (!isOwner && !isAdmin && !isPublicCategory) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const key = segments.join("/");

  try {
    const data = await readStoredFile(key);
    const mime = mimeTypeFor(key);
    const headers: Record<string, string> = {
      "Content-Type": mime,
      "Cache-Control": "private, max-age=0, no-store",
    };
    if (mime === "application/pdf") {
      headers["Content-Disposition"] = `attachment; filename="${filename || "Document_DIVA.pdf"}"`;
    }
    return new NextResponse(new Uint8Array(data), { headers });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
