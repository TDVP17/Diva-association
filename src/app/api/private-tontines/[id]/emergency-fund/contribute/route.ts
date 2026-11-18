import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { debitWalletTx, InsufficientWalletBalanceError } from "@/lib/wallet-ledger";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { formatXAF } from "@/lib/format-currency";
import { logAudit } from "@/lib/audit";

const contributeSchema = z.object({
  amount: z.number().int().min(100, "Montant invalide").max(10_000_000),
});

/**
 * Allows an approved member of a private cotisation to contribute to its isolated Emergency Fund (Secours)
 * from their DIVA Asso Wallet (0% telecom fees, strictly separate from the main contribution pot!).
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id } = await context.params;

  const body = await request.json().catch(() => null);
  const parsed = contributeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Montant invalide." },
      { status: 400 },
    );
  }

  const tontine = await prisma.tontineSession.findUnique({
    where: { id },
    include: {
      emergencyFund: true,
      memberships: { where: { userId, status: "APPROVED" } },
    },
  });

  if (!tontine || !tontine.isPrivate || tontine.softDeletedAt !== null) {
    return NextResponse.json({ error: "Cotisation privée introuvable." }, { status: 404 });
  }
  if (!tontine.emergencyFund || !tontine.emergencyFund.isActive) {
    return NextResponse.json({ error: "Aucune caisse de secours active pour cette cotisation." }, { status: 404 });
  }
  if (tontine.memberships.length === 0 && tontine.creatorId !== userId) {
    return NextResponse.json({ error: "Seuls les membres validés peuvent contribuer à cette caisse de secours." }, { status: 403 });
  }

  const minAmount = Number(tontine.emergencyFund.minimumAmount);
  if (parsed.data.amount < minAmount) {
    return NextResponse.json(
      { error: `Le montant minimum pour cette caisse de secours est de ${formatXAF(minAmount)}.` },
      { status: 400 },
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const debit = await debitWalletTx(tx, {
        userId,
        amount: parsed.data.amount,
        fee: 0,
        type: "CONTRIBUTION",
        description: `Caisse de secours « ${tontine.emergencyFund!.name} » (${tontine.title})`,
        metadata: {
          privateEmergencyFundId: tontine.emergencyFund!.id,
          tontineSessionId: tontine.id,
          isolatedSecoursFund: true,
        },
      });

      const contribution = await tx.privateEmergencyFundContribution.create({
        data: {
          fundId: tontine.emergencyFund!.id,
          userId,
          amount: parsed.data.amount,
          paymentMethod: "WALLET",
          walletTxRef: debit.reference,
          status: "COMPLETED",
        },
      });

      return { debit, contribution };
    });

    const memberName = session.user.name || "Un membre";
    const recipients: Array<{ userId: string; message: string; actionUrl: string }> = [
      {
        userId,
        message: `Votre contribution de ${formatXAF(parsed.data.amount)} à la caisse de secours « ${tontine.emergencyFund.name} » a bien été enregistrée.`,
        actionUrl: "/private-tontines",
      },
    ];
    if (tontine.creatorId && tontine.creatorId !== userId) {
      recipients.push({
        userId: tontine.creatorId,
        message: `${memberName} a versé ${formatXAF(parsed.data.amount)} dans la caisse de secours « ${tontine.emergencyFund.name} » (${tontine.title}).`,
        actionUrl: "/private-tontines",
      });
    }

    await scheduleInAppNotifications({
      tontineSessionId: tontine.id,
      type: "PAYMENT_SUCCESS",
      recipients,
    }).catch(() => {});

    await logAudit({
      actorId: userId,
      actorRole: session.user.role,
      action: "private_emergency_fund_contributed",
      targetType: "PrivateEmergencyFundContribution",
      targetId: result.contribution.id,
      tontineSessionId: tontine.id,
      metadata: { amount: parsed.data.amount, fundId: tontine.emergencyFund.id },
      request,
    });

    return NextResponse.json({
      ok: true,
      newBalance: result.debit.balanceAfter,
      reference: result.debit.reference,
      message: `Contribution de ${formatXAF(parsed.data.amount)} enregistrée dans la caisse de secours !`,
    });
  } catch (err) {
    if (err instanceof InsufficientWalletBalanceError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[emergency-fund/contribute] error:", err);
    return NextResponse.json({ error: "Erreur lors de la contribution à la caisse de secours." }, { status: 500 });
  }
}

