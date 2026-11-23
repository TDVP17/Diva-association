import { prisma } from "@/lib/prisma";
import { computePayoutPreview } from "@/lib/payout-preview";
import { creditWalletTx } from "@/lib/wallet-ledger";
import { deductActiveLoansFromPayoutTx } from "@/lib/loans";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { formatXAF } from "@/lib/format-currency";
import { sendEmailSafe } from "@/lib/email/resend";
import { renderBrandedEmailHtml } from "@/lib/email/template";

export async function executeWalletPayoutForSlot(params: {
  tontineSessionId: string;
  membershipSlotId: string;
  dueDate: Date;
  adminId?: string;
}): Promise<{
  ok: boolean;
  payoutId?: string;
  netPayout?: number;
  alreadyPaid?: boolean;
  error?: string;
}> {
  const { tontineSessionId, membershipSlotId, dueDate, adminId } = params;

  // 1. Verify slot
  const slot = await prisma.membershipSlot.findUnique({
    where: { id: membershipSlotId },
    include: {
      membership: {
        include: {
          user: true,
          tontineSession: true,
        },
      },
    },
  });

  if (!slot || slot.membership.tontineSessionId !== tontineSessionId) {
    return { ok: false, error: "Slot introuvable dans cette cotisation" };
  }

  const session = slot.membership.tontineSession;
  const user = slot.membership.user;

  // 2. Check if already confirmed
  const existingPayout = await prisma.payout.findFirst({
    where: {
      tontineSessionId,
      membershipSlotId,
      dueDate,
    },
  });

  if (
    existingPayout &&
    (existingPayout.status === "CONFIRMED" ||
      existingPayout.status === "RELEASED" ||
      Boolean(existingPayout.releasedAt))
  ) {
    return {
      ok: true,
      alreadyPaid: true,
      payoutId: existingPayout.id,
      netPayout: Number(existingPayout.netPayout),
    };
  }

  // 3. Compute pot preview
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const preview = await computePayoutPreview(session, slot as any, dueDate);
  let finalNetPayout = preview.netPayout;
  let finalDeducted = preview.deducted;

  // 4. Atomic transaction: create/update Payout, deduct loans, credit wallet
  const payout = await prisma.$transaction(async (tx) => {
    const p = existingPayout
      ? await tx.payout.update({
          where: { id: existingPayout.id },
          data: {
            payoutPhone: "DIVA_WALLET",
            payoutAccountName: user.name,
            status: "CONFIRMED",
            pot: preview.pot,
            deducted: preview.deducted,
            netPayout: preview.netPayout,
            releasedByAdminId: adminId ?? null,
            releasedAt: new Date(),
            memberConfirmedAt: new Date(),
            confirmedByAdmin: true,
          },
        })
      : await tx.payout.create({
          data: {
            tontineSessionId,
            membershipSlotId,
            dueDate,
            payoutPhone: "DIVA_WALLET",
            payoutAccountName: user.name,
            status: "CONFIRMED",
            pot: preview.pot,
            deducted: preview.deducted,
            netPayout: preview.netPayout,
            releasedByAdminId: adminId ?? null,
            releasedAt: new Date(),
            memberConfirmedAt: new Date(),
            confirmedByAdmin: true,
          },
        });

    const loanRes = await deductActiveLoansFromPayoutTx(tx, {
      userId: user.id,
      payoutId: p.id,
      availableNetPayout: preview.netPayout,
    });
    finalNetPayout = loanRes.remainingNetPayout;
    finalDeducted = preview.deducted + loanRes.totalLoanDeducted;

    if (loanRes.totalLoanDeducted > 0) {
      await tx.payout.update({
        where: { id: p.id },
        data: { deducted: finalDeducted, netPayout: finalNetPayout },
      });
    }

    if (finalNetPayout > 0) {
      await creditWalletTx(tx, {
        userId: user.id,
        amount: finalNetPayout,
        fee: 0,
        type: "PAYOUT",
        description: `Bouffe créditée sur compte principal (${session.title || session.type} · ${slot.beneficiaryName})`,
        metadata: { payoutId: p.id, pot: preview.pot, deducted: finalDeducted },
      });
    }

    if (preview.toDeductFineIds.length > 0) {
      await tx.fine.updateMany({
        where: { id: { in: preview.toDeductFineIds } },
        data: { status: "DEDUCTED" },
      });
    }

    if (preview.toDeductContributions.length > 0) {
      for (const item of preview.toDeductContributions) {
        await tx.contribution.upsert({
          where: {
            membershipSlotId_dueDate: {
              membershipSlotId: item.slotId,
              dueDate,
            },
          },
          create: {
            membershipSlotId: item.slotId,
            dueDate,
            amountPaid: item.amount,
            feePaid: item.fee,
            finePaid: 0,
            status: "PAID",
            paidAt: new Date(),
            recordedByAdminId: adminId ?? null,
            paidByUserId: user.id,
          },
          update: {
            amountPaid: item.amount,
            feePaid: item.fee,
            status: "PAID",
            paidAt: new Date(),
            recordedByAdminId: adminId ?? null,
            failureReason: null,
          },
        });
      }
    }

    return p;
  });

  // 5. Send notifications
  const notifMsg = `Félicitations ${user.name} ! 🎉 Votre Portefeuille DIVA Asso a été rechargé de ${formatXAF(finalNetPayout)} pour votre bouffe de ${slot.beneficiaryName} (« ${session.title || session.type} »). Vous pouvez retirer votre argent à tout moment, ou laisser une partie pour cotiser automatiquement sans payer de frais Orange ou MTN.`;

  await scheduleInAppNotifications({
    tontineSessionId,
    type: "PAYMENT_SUCCESS",
    recipients: [
      {
        userId: user.id,
        message: notifMsg,
        actionUrl: "/wallet",
      },
    ],
  }).catch(console.error);

  if (user.email) {
    const emailTitle = `🎉 Votre cagnotte de ${formatXAF(finalNetPayout)} est disponible sur votre Portefeuille DIVA Asso !`;
    const html = renderBrandedEmailHtml({
      title: emailTitle,
      bodyText: notifMsg,
      actionUrl: "/wallet",
      actionLabel: "Voir mon Portefeuille",
      recipientName: user.name,
      lang: user.preferredLang === "en" ? "en" : "fr",
    });
    await sendEmailSafe(user.email, emailTitle, html).catch(console.error);
  }

  return { ok: true, payoutId: payout.id, netPayout: finalNetPayout };
}

