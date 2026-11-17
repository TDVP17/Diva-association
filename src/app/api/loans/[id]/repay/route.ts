import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { repayLoanFromWallet } from "@/lib/loans";
import { InsufficientWalletBalanceError } from "@/lib/wallet-ledger";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { formatXAF } from "@/lib/format-currency";
import { logAudit } from "@/lib/audit";

const repaySchema = z.object({
  amount: z.number().int().min(500).optional(),
});

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

  const body = await request.json().catch(() => ({}));
  const parsed = repaySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Montant invalide." }, { status: 400 });
  }

  try {
    const result = await repayLoanFromWallet(userId, id, parsed.data.amount);

    if (result.fullyRepaid) {
      await scheduleInAppNotifications({
        type: "LOAN_REPAID",
        recipients: [
          {
            userId,
            message: `Félicitations ! Votre prêt d'urgence est intégralement remboursé (${formatXAF(result.paidAmount)}). Vos étoiles de confiance sont conservées !`,
            actionUrl: "/loans",
          },
        ],
      }).catch(() => {});
    }

    await logAudit({
      actorId: userId,
      actorRole: session.user.role,
      action: result.fullyRepaid ? "loan_repaid_full" : "loan_repaid_partial",
      targetType: "Loan",
      targetId: id,
      metadata: {
        paidAmount: result.paidAmount,
        fullyRepaid: result.fullyRepaid,
        reference: result.reference,
      },
      request,
    });

    return NextResponse.json({
      ok: true,
      paidAmount: result.paidAmount,
      fullyRepaid: result.fullyRepaid,
      newBalance: result.newBalance,
      reference: result.reference,
      message: result.fullyRepaid
        ? "Félicitations ! Prêt entièrement remboursé. Votre badge 4 étoiles est conservé !"
        : `Versement de ${formatXAF(result.paidAmount)} enregistré sur votre prêt.`,
    });
  } catch (err) {
    if (err instanceof InsufficientWalletBalanceError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erreur lors du remboursement." },
      { status: 400 },
    );
  }
}
