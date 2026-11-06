import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { readStoredFile } from "@/lib/storage";
import { mimeTypeFor } from "@/lib/mime";
import { isAdminRole } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { generateReceiptPdf } from "@/lib/receipt";

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
  // other category (receipts, etc.) stays owner-or-admin only.
  const [category, ownerId, ...rest] = segments;
  if (!category || !ownerId || rest.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isOwner = session.user.id === ownerId;
  const isAdmin = isAdminRole(session.user.role);
  const isPublicCategory = category === "avatars";
  if (!isOwner && !isAdmin && !isPublicCategory) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const key = segments.join("/");

  // Always generate official contribution receipts live without gateway payment fees
  if (category === "receipts" && rest[0]?.endsWith(".pdf")) {
    const contributionId = rest[0].replace(/\.pdf$/, "");
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
        const s = contrib.membershipSlot.membership.tontineSession;
        const pdfBytes = await generateReceiptPdf({
          memberName: `${u.name} — ${contrib.membershipSlot.beneficiaryName}`,
          paidByName: contrib.paidByUser?.name,
          paymentMethod: contrib.recordedByAdminId ? "Recorded by admin" : "Mobile Money / Orange Money",
          tontineType: s.type,
          amount: Number(contrib.amountPaid),
          fine: Number(contrib.finePaid),
          total: Number(contrib.amountPaid) + Number(contrib.finePaid),
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
