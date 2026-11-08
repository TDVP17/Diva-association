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

  const { path: segments } = await params;
  // Every stored file lives under {category}/{ownerId}/{filename}. Avatars
  // are shown to other members throughout the app (chat, session rosters,
  // admin queues), so any authenticated user may read those back; every
  // other category (receipts, etc.) stays owner/payer-or-admin only.
  const [category, ownerId, ...rest] = segments;
  if (!category || !ownerId || rest.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isOwner = session.user.id === ownerId;
  const isAdmin = isAdminRole(session.user.role);
  const isPublicCategory = category === "avatars";
  const filename = rest[0] ?? "";

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

        const pdfBytes = await generateReceiptPdf({
          memberName:
            beneficiaryNames.length === 1
              ? `${firstOwner.name} — ${beneficiaryNames[0]}`
              : firstOwner.name,
          beneficiaryNames: beneficiaryNames.length > 1 ? beneficiaryNames : undefined,
          paidByName,
          paymentMethod: "Mobile Money / Orange Money",
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

        return new NextResponse(new Uint8Array(pdfBytes), {
          headers: {
            "Content-Type": "application/pdf",
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

        const pdfBytes = await generateReceiptPdf({
          memberName: `${u.name} — ${contrib.membershipSlot.beneficiaryName}`,
          paidByName,
          paymentMethod: contrib.recordedByAdminId ? "Recorded by admin" : "Mobile Money / Orange Money",
          tontineType: s.type,
          sessionLabel: s.title || TONTINE_TYPE_LABELS[s.type],
          amount: Number(contrib.amountPaid),
          fee: Number(contrib.feePaid),
          fine: Number(contrib.finePaid),
          total: totalPaid,
          transRef: contrib.fapshiTxRef ?? contrib.id,
          paidAt: contrib.paidAt ?? contrib.createdAt,
        });
        return new NextResponse(new Uint8Array(pdfBytes), {
          headers: {
            "Content-Type": "application/pdf",
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
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": mimeTypeFor(key),
        "Cache-Control": "private, max-age=0, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
