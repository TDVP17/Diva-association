import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getNextDueDate, getContributionTotal } from "@/lib/tontine-engine";
import { debitWalletTx, InsufficientWalletBalanceError } from "@/lib/wallet-ledger";
import { creditLateBeneficiaryWithHalfFine } from "@/lib/settle-fine";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { sendEmailSafe } from "@/lib/email/resend";
import { renderBrandedEmailHtml } from "@/lib/email/template";
import { formatXAF } from "@/lib/format-currency";
import { logAudit } from "@/lib/audit";

const payContributionSchema = z.object({
  membershipSlotId: z.string().min(1).optional(),
  membershipSlotIds: z.array(z.string().min(1)).min(1).optional(),
  fineId: z.string().min(1).optional(),
  dueDate: z.string().optional(),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const userId = session.user.id;

  const body = await request.json().catch(() => null);
  const parsed = payContributionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Paramètres de paiement invalides." }, { status: 400 });
  }

  const { membershipSlotId, membershipSlotIds, fineId, dueDate: dueDateStr } = parsed.data;
  const payer = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, phone: true, walletBalance: true, preferredLang: true },
  });
  if (!payer) {
    return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });
  }

  // Case A: Paying a Fine via DIVA Wallet (0% telecom fee)
  if (fineId) {
    const fine = await prisma.fine.findUnique({
      where: { id: fineId },
      include: {
        membershipSlot: {
          include: {
            membership: {
              include: { tontineSession: true, user: true },
            },
          },
        },
      },
    });
    if (!fine) {
      return NextResponse.json({ error: "Amende introuvable." }, { status: 404 });
    }
    if (fine.status === "PAID" || fine.status === "DEDUCTED") {
      return NextResponse.json({ error: "Cette amende est déjà réglée." }, { status: 409 });
    }

    const fineAmount = Number(fine.amount);

    try {
      const ledger = await prisma.$transaction(async (tx) => {
        const debit = await debitWalletTx(tx, {
          userId,
          amount: fineAmount,
          fee: 0,
          type: "FINE",
          description: `Règlement amende (0% frais télécom) · ${fine.membershipSlot.beneficiaryName}`,
          metadata: { fineId: fine.id, membershipSlotId: fine.membershipSlotId },
        });

        await tx.fine.update({
          where: { id: fine.id },
          data: {
            status: "PAID",
            payerPhone: "DIVA_WALLET",
            failureReason: null,
          },
        });

        return debit;
      });

      // Trigger 50% late beneficiary compensation in wallet
      await creditLateBeneficiaryWithHalfFine({
        tontineSessionId: fine.membershipSlot.membership.tontineSessionId,
        dueDate: fine.dueDate,
        fineAmount,
        finePayerName: payer.name,
        sessionTitle:
          fine.membershipSlot.membership.tontineSession.title ||
          fine.membershipSlot.membership.tontineSession.type,
      }).catch((err) =>
        console.error("[wallet/pay-contribution] 50% fine compensation error:", err),
      );

      await logAudit({
        actorId: userId,
        actorRole: session.user.role,
        action: "fine_paid_via_wallet",
        targetType: "Fine",
        targetId: fine.id,
        tontineSessionId: fine.membershipSlot.membership.tontineSessionId,
        metadata: { amount: fineAmount, reference: ledger.reference },
        request,
      });

      return NextResponse.json({
        ok: true,
        status: "SUCCESSFUL",
        reference: ledger.reference,
        totalPaid: fineAmount,
        newBalance: ledger.balanceAfter,
        message: "Amende réglée instantanément via votre Portefeuille DIVA (0 % de frais opérateur) !",
      });
    } catch (err) {
      if (err instanceof InsufficientWalletBalanceError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
  }

  // Case B: Paying 1 or N Contribution slots via DIVA Wallet (0% telecom fee)
  const slotIds = membershipSlotIds ?? (membershipSlotId ? [membershipSlotId] : []);
  if (slotIds.length === 0) {
    return NextResponse.json({ error: "Aucun nom sélectionné pour la cotisation." }, { status: 400 });
  }

  const slots = await prisma.membershipSlot.findMany({
    where: { id: { in: slotIds } },
    include: {
      membership: {
        include: {
          tontineSession: true,
          user: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });

  if (slots.length !== slotIds.length) {
    return NextResponse.json({ error: "Un ou plusieurs noms sélectionnés sont introuvables." }, { status: 404 });
  }

  const itemsToPay: Array<{
    slot: (typeof slots)[number];
    dueDate: Date;
    amount: number;
    fee: number;
    fineAmount: number;
    fineIds: string[];
    total: number;
  }> = [];

  for (const slot of slots) {
    const tontine = slot.membership.tontineSession;
    if (tontine.isPaused || tontine.status === "CLOSED") {
      return NextResponse.json(
        { error: `La cotisation « ${tontine.title || tontine.type} » n'accepte pas de paiements actuellement.` },
        { status: 400 },
      );
    }

    const cycleDate = dueDateStr ? new Date(dueDateStr) : getNextDueDate(tontine.type, new Date());
    if (Number.isNaN(cycleDate.getTime())) {
      return NextResponse.json({ error: "Date d'échéance invalide." }, { status: 400 });
    }

    const existingPaid = await prisma.contribution.findUnique({
      where: {
        membershipSlotId_dueDate: {
          membershipSlotId: slot.id,
          dueDate: cycleDate,
        },
      },
      select: { status: true },
    });
    if (existingPaid?.status === "PAID") {
      return NextResponse.json(
        { error: `Le nom « ${slot.beneficiaryName} » est déjà coché / payé pour cette échéance.` },
        { status: 409 },
      );
    }

    const { amount, fee } = getContributionTotal({
      amount: Number(tontine.amount),
      fee: Number(tontine.fee),
    });

    // Include any unpaid fines on this slot for the same cycle
    const unpaidFines = await prisma.fine.findMany({
      where: {
        membershipSlotId: slot.id,
        status: { in: ["UNPAID", "FAILED"] },
      },
      select: { id: true, amount: true },
    });
    const fineAmount = unpaidFines.reduce((sum, f) => sum + Number(f.amount), 0);

    itemsToPay.push({
      slot,
      dueDate: cycleDate,
      amount,
      fee,
      fineAmount,
      fineIds: unpaidFines.map((f) => f.id),
      total: amount + fee + fineAmount,
    });
  }

  const grandTotal = itemsToPay.reduce((sum, item) => sum + item.total, 0);

  try {
    const ledger = await prisma.$transaction(async (tx) => {
      const namesLabel = itemsToPay.map((i) => i.slot.beneficiaryName).join(", ");
      const debit = await debitWalletTx(tx, {
        userId,
        amount: grandTotal,
        fee: 0, // 0% Fapshi/Mobile Money telecom fee!
        type: "CONTRIBUTION",
        description: `Cotisation Portefeuille (0% frais télécom) · ${namesLabel}`,
        metadata: {
          slotIds,
          itemCount: itemsToPay.length,
        },
      });

      const now = new Date();
      for (const item of itemsToPay) {
        const isRelative = item.slot.membership.userId !== userId;
        await tx.contribution.upsert({
          where: {
            membershipSlotId_dueDate: {
              membershipSlotId: item.slot.id,
              dueDate: item.dueDate,
            },
          },
          create: {
            membershipSlotId: item.slot.id,
            dueDate: item.dueDate,
            amountPaid: item.amount,
            feePaid: item.fee,
            finePaid: item.fineAmount,
            status: "PAID",
            paidAt: now,
            payerPhone: "DIVA_WALLET",
            paidByUserId: isRelative ? userId : null,
            providerFeeAmount: 0,
            providerShareAmount: 0,
            presidentFeeShareAmount: 0,
            failureReason: null,
          },
          update: {
            amountPaid: item.amount,
            feePaid: item.fee,
            finePaid: item.fineAmount,
            status: "PAID",
            paidAt: now,
            payerPhone: "DIVA_WALLET",
            paidByUserId: isRelative ? userId : null,
            providerFeeAmount: 0,
            providerShareAmount: 0,
            presidentFeeShareAmount: 0,
            failureReason: null,
          },
        });

        if (item.fineIds.length > 0) {
          await tx.fine.updateMany({
            where: { id: { in: item.fineIds } },
            data: { status: "PAID", payerPhone: "DIVA_WALLET", failureReason: null },
          });
        }
      }

      return debit;
    });

    // Credit 50% of any paid fines to late beneficiary
    for (const item of itemsToPay) {
      if (item.fineAmount > 0) {
        await creditLateBeneficiaryWithHalfFine({
          tontineSessionId: item.slot.membership.tontineSessionId,
          dueDate: item.dueDate,
          fineAmount: item.fineAmount,
          finePayerName: payer.name,
          sessionTitle:
            item.slot.membership.tontineSession.title ||
            item.slot.membership.tontineSession.type,
        }).catch(() => {});
      }
    }

    // Immediate in-app notification & email confirmation
    const payerDisplay = payer.phone ? `${payer.name} (${payer.phone})` : payer.name;
    const namesSummary = itemsToPay.map((i) => i.slot.beneficiaryName).join(", ");
    const lang = payer.preferredLang === "en" ? "en" : "fr";

    await scheduleInAppNotifications({
      tontineSessionId: itemsToPay[0].slot.membership.tontineSessionId,
      type: "PAYMENT_SUCCESS",
      recipients: [
        {
          userId,
          message:
            lang === "fr"
              ? `Cotisation payée instantanément via votre Portefeuille DIVA (0% frais télécom) pour : ${namesSummary} — Total : ${formatXAF(grandTotal)}.`
              : `Contribution paid instantly via your DIVA Wallet (0% telecom fee) for: ${namesSummary} — Total: ${formatXAF(grandTotal)}.`,
          actionUrl: `/sessions/${itemsToPay[0].slot.membership.tontineSessionId}`,
        },
      ],
    }).catch(() => {});

    if (payer.email) {
      const html = renderBrandedEmailHtml({
        title: lang === "fr" ? "Paiement via Portefeuille confirmé ✅" : "Wallet Payment Confirmed ✅",
        bodyText:
          lang === "fr"
            ? `Bonjour ${payerDisplay},\n\nVotre cotisation pour ${namesSummary} d'un montant de ${formatXAF(grandTotal)} a été réglée instantanément depuis votre Portefeuille DIVA Asso (0% de frais opérateur).\nRéférence : ${ledger.reference}\nNouveau solde portefeuille : ${formatXAF(ledger.balanceAfter)}.`
            : `Hello ${payerDisplay},\n\nYour contribution for ${namesSummary} of ${formatXAF(grandTotal)} was paid instantly from your DIVA Asso Wallet (0% operator fee).\nReference: ${ledger.reference}\nNew wallet balance: ${formatXAF(ledger.balanceAfter)}.`,
        actionUrl: `/wallet`,
        actionLabel: lang === "fr" ? "Voir mon portefeuille" : "View My Wallet",
        lang,
      });
      await sendEmailSafe(
        payer.email,
        lang === "fr"
          ? `DIVA Asso — Cotisation Portefeuille confirmée (${formatXAF(grandTotal)})`
          : `DIVA Asso — Wallet Payment Confirmed (${formatXAF(grandTotal)})`,
        html,
      ).catch(() => {});
    }

    await logAudit({
      actorId: userId,
      actorRole: session.user.role,
      action: "contribution_paid_via_wallet",
      targetType: "Contribution",
      targetId: slotIds[0],
      tontineSessionId: itemsToPay[0].slot.membership.tontineSessionId,
      metadata: {
        slotIds,
        grandTotal,
        reference: ledger.reference,
        balanceAfter: ledger.balanceAfter,
      },
      request,
    });

    return NextResponse.json({
      ok: true,
      status: "SUCCESSFUL",
      reference: ledger.reference,
      totalPaid: grandTotal,
      newBalance: ledger.balanceAfter,
      message: "Cotisation payée instantanément via votre Portefeuille DIVA (0 % frais télécom) !",
    });
  } catch (err) {
    if (err instanceof InsufficientWalletBalanceError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[api/wallet/pay-contribution] error:", err);
    return NextResponse.json({ error: "Erreur lors du paiement par portefeuille." }, { status: 500 });
  }
}
