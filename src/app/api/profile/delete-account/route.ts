import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/audit";

const deleteSchema = z.object({
  confirmation: z.literal("SUPPRIMER"),
});

/**
 * Apple App Store Guideline 5.1.1(v) compliant account deletion endpoint.
 * Safeguards financial integrity: blocks deletion if the user has active unpaid loans,
 * unpaid fines, or a non-zero wallet balance. Preserves immutable legal/audit/KYC rows
 * while deactivating login access and anonymizing personal contact data.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const userId = session.user.id;

  const body = await request.json().catch(() => null);
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Veuillez taper exactement SUPPRIMER pour confirmer la suppression de votre compte." },
      { status: 400 },
    );
  }

  const [user, openLoansCount, unpaidFinesCount] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true, walletBalance: true },
    }),
    prisma.loan.count({
      where: { userId, status: { in: ["ACTIVE", "OVERDUE"] } },
    }),
    prisma.fine.count({
      where: {
        membershipSlot: { membership: { userId } },
        status: { in: ["UNPAID", "FAILED"] },
      },
    }),
  ]);

  if (!user) {
    return NextResponse.json({ error: "Compte introuvable." }, { status: 404 });
  }

  if (user.role === "ADMIN" || user.role === "PRESIDENT") {
    return NextResponse.json(
      { error: "Les comptes administrateurs ne peuvent pas être supprimés depuis cette interface." },
      { status: 403 },
    );
  }

  if (openLoansCount > 0) {
    return NextResponse.json(
      { error: "Impossible de supprimer votre compte : vous avez un prêt d'urgence actif ou en retard non remboursé." },
      { status: 409 },
    );
  }

  if (unpaidFinesCount > 0) {
    return NextResponse.json(
      { error: "Impossible de supprimer votre compte : vous avez encore des amendes impayées." },
      { status: 409 },
    );
  }

  if (Number(user.walletBalance || 0) > 0) {
    return NextResponse.json(
      {
        error: `Veuillez d'abord retirer le solde disponible (${Number(user.walletBalance).toLocaleString("fr-FR")} FCFA) de votre Portefeuille DIVA avant de clôturer votre compte.`,
      },
      { status: 409 },
    );
  }

  const anonymizedEmail = `deleted-${user.id}@closed.divaasso.local`;

  await prisma.$transaction([
    prisma.session.deleteMany({ where: { userId } }),
    prisma.pushSubscription.deleteMany({ where: { userId } }),
    prisma.user.update({
      where: { id: userId },
      data: {
        email: anonymizedEmail,
        phone: null,
        payoutPhone: null,
        isBanned: true,
        bannedAt: new Date(),
        bannedReason: "ACCOUNT_DELETED_BY_USER",
      },
    }),
  ]);

  await logAudit({
    actorId: userId,
    actorRole: session.user.role,
    action: "account_deleted_by_user",
    targetType: "User",
    targetId: userId,
    request,
  });

  return NextResponse.json({
    ok: true,
    message: "Votre compte a été clôturé et désactivé.",
  });
}

