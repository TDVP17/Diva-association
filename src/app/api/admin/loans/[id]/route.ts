import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { computeLoanDueDateAt18h, LOAN_GRACE_DAYS } from "@/lib/loans";
import { creditWalletTx, debitWalletTx } from "@/lib/wallet-ledger";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { sendEmailSafe } from "@/lib/email/resend";
import { renderBrandedEmailHtml } from "@/lib/email/template";
import { formatXAF } from "@/lib/format-currency";
import { logAudit } from "@/lib/audit";

const decideLoanSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT", "CANCEL_REVERT"]),
  reason: z.string().max(300).optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = decideLoanSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Paramètres invalides." }, { status: 400 });
  }

  const loan = await prisma.loan.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true, preferredLang: true, walletBalance: true } },
    },
  });
  if (!loan) {
    return NextResponse.json({ error: "Prêt introuvable." }, { status: 404 });
  }

  const principal = Number(loan.principal);
  const totalDue = Number(loan.totalDue);
  const lang = loan.user.preferredLang === "en" ? "en" : "fr";

  if (parsed.data.decision === "APPROVE") {
    if (loan.status !== "PENDING_ADMIN") {
      return NextResponse.json(
        { error: "Seules les demandes en attente de validation peuvent être approuvées." },
        { status: 409 },
      );
    }

    const now = new Date();
    const dueDate = computeLoanDueDateAt18h(now);
    const graceEndDate = new Date(
      dueDate.getTime() + LOAN_GRACE_DAYS * 24 * 60 * 60 * 1000,
    );

    const ledger = await prisma.$transaction(async (tx) => {
      await tx.loan.update({
        where: { id: loan.id },
        data: {
          status: "ACTIVE",
          approvedByAdminId: admin.user.id,
          approvedAt: now,
          dueDate,
          graceEndDate,
        },
      });

      return creditWalletTx(tx, {
        userId: loan.userId,
        amount: principal,
        fee: 0,
        type: "LOAN_DISBURSEMENT",
        description: `Prêt d'urgence approuvé par DIVA Asso #${loan.id.slice(-6).toUpperCase()}`,
        metadata: { loanId: loan.id, approvedByAdminId: admin.user.id },
      });
    });

    const dueDateLabel = dueDate.toLocaleDateString("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    await scheduleInAppNotifications({
      type: "LOAN_DISBURSED",
      recipients: [
        {
          userId: loan.userId,
          message:
            lang === "fr"
              ? `Votre demande de prêt de ${formatXAF(principal)} a été validée par DIVA Asso ! Votre portefeuille a été crédité. Échéance : ${dueDateLabel} (${formatXAF(totalDue)}).`
              : `Your loan request of ${formatXAF(principal)} has been approved by DIVA Asso! Your wallet has been credited. Due date: ${dueDateLabel} (${formatXAF(totalDue)}).`,
          actionUrl: "/loans",
        },
      ],
    }).catch(() => {});

    if (loan.user.email) {
      const html = renderBrandedEmailHtml({
        title: lang === "fr" ? "Prêt approuvé et crédité" : "Loan Approved & Credited",
        bodyText:
          lang === "fr"
            ? `Salut ${loan.user.name},\n\nVotre demande de prêt de ${formatXAF(principal)} a été approuvée par l'administrateur DIVA Asso et créditée dans votre Portefeuille DIVA Asso.\n\n• Montant emprunté : ${formatXAF(principal)}\n• Total à rembourser : ${formatXAF(totalDue)}\n• Date limite de remboursement : ${dueDateLabel} à 18h00\n• Nouveau solde portefeuille : ${formatXAF(ledger.balanceAfter)}.`
            : `Hello ${loan.user.name},\n\nYour loan request of ${formatXAF(principal)} was approved by DIVA Asso and credited to your DIVA Asso Wallet.\n\n• Principal: ${formatXAF(principal)}\n• Total due: ${formatXAF(totalDue)}\n• Deadline: ${dueDateLabel} at 18:00\n• New balance: ${formatXAF(ledger.balanceAfter)}.`,
        actionUrl: "/loans",
        actionLabel: lang === "fr" ? "Consulter mon prêt" : "View My Loan",
        lang,
      });
      await sendEmailSafe(
        loan.user.email,
        lang === "fr"
          ? `DIVA Asso — Votre prêt de ${formatXAF(principal)} est approuvé !`
          : `DIVA Asso — Your loan of ${formatXAF(principal)} is approved!`,
        html,
      ).catch(() => {});
    }

    await logAudit({
      actorId: admin.user.id,
      actorRole: admin.user.role,
      action: "admin_loan_approved",
      targetType: "Loan",
      targetId: loan.id,
      metadata: { principal, userId: loan.userId, newBalance: ledger.balanceAfter },
      request,
    });

    return NextResponse.json({
      ok: true,
      status: "ACTIVE",
      newBalance: ledger.balanceAfter,
      message: `Prêt de ${formatXAF(principal)} validé et crédité dans le portefeuille de ${loan.user.name}.`,
    });
  }

  if (parsed.data.decision === "REJECT") {
    if (loan.status !== "PENDING_ADMIN") {
      return NextResponse.json(
        { error: "Seules les demandes en attente de validation peuvent être refusées." },
        { status: 409 },
      );
    }

    const reason = parsed.data.reason?.trim() || "Demande non approuvée par l'administrateur DIVA Asso.";
    await prisma.loan.update({
      where: { id: loan.id },
      data: {
        status: "REJECTED",
        rejectionReason: reason,
        approvedByAdminId: admin.user.id,
        approvedAt: new Date(),
      },
    });

    await scheduleInAppNotifications({
      type: "ADMIN_BROADCAST",
      recipients: [
        {
          userId: loan.userId,
          message:
            lang === "fr"
              ? `Votre demande de prêt de ${formatXAF(principal)} n'a pas été approuvée par l'administrateur. Motif : ${reason}`
              : `Your loan request of ${formatXAF(principal)} was declined by the administrator. Reason: ${reason}`,
          actionUrl: "/loans",
        },
      ],
    }).catch(() => {});

    await logAudit({
      actorId: admin.user.id,
      actorRole: admin.user.role,
      action: "admin_loan_rejected",
      targetType: "Loan",
      targetId: loan.id,
      metadata: { principal, reason },
      request,
    });

    return NextResponse.json({ ok: true, status: "REJECTED", message: "Demande de prêt refusée." });
  }

  // CANCEL_REVERT: Admin voids an active loan (e.g. test/error) and reclaims funds from wallet
  if (parsed.data.decision === "CANCEL_REVERT") {
    if (loan.status !== "ACTIVE" && loan.status !== "OVERDUE") {
      return NextResponse.json({ error: "Ce prêt ne peut pas être annulé." }, { status: 409 });
    }
    const reason = parsed.data.reason?.trim() || "Annulé / réinitialisé par l'administrateur";
    const walletAvail = Number(loan.user.walletBalance || 0);
    const reclaimAmount = Math.min(walletAvail, principal);

    await prisma.$transaction(async (tx) => {
      if (reclaimAmount > 0) {
        await debitWalletTx(tx, {
          userId: loan.userId,
          amount: reclaimAmount,
          fee: 0,
          type: "ADMIN_ADJUST",
          description: `Annulation prêt #${loan.id.slice(-6).toUpperCase()} (${reason})`,
          metadata: { loanId: loan.id, adminId: admin.user.id },
        });
      }

      await tx.loan.update({
        where: { id: loan.id },
        data: {
          status: "REJECTED",
          rejectionReason: reason,
          approvedByAdminId: admin.user.id,
          approvedAt: new Date(),
        },
      });
    });

    await logAudit({
      actorId: admin.user.id,
      actorRole: admin.user.role,
      action: "admin_loan_cancelled_reverted",
      targetType: "Loan",
      targetId: loan.id,
      metadata: { principal, reclaimAmount, reason },
      request,
    });

    return NextResponse.json({
      ok: true,
      status: "REJECTED",
      reclaimAmount,
      message: `Prêt annulé (${formatXAF(reclaimAmount)} retirés du portefeuille).`,
    });
  }

  return NextResponse.json({ error: "Décision non reconnue." }, { status: 400 });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await context.params;
  const loan = await prisma.loan.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, walletBalance: true } },
    },
  });
  if (!loan) {
    return NextResponse.json({ error: "Prêt introuvable." }, { status: 404 });
  }

  const principal = Number(loan.principal);
  const walletAvail = Number(loan.user.walletBalance || 0);
  const shouldReclaim = loan.status === "ACTIVE" || loan.status === "OVERDUE";
  const reclaimAmount = shouldReclaim ? Math.min(walletAvail, principal) : 0;

  await prisma.$transaction(async (tx) => {
    if (reclaimAmount > 0) {
      await debitWalletTx(tx, {
        userId: loan.userId,
        amount: reclaimAmount,
        fee: 0,
        type: "ADMIN_ADJUST",
        description: `Suppression prêt #${loan.id.slice(-6).toUpperCase()} par l'administrateur`,
        metadata: { loanId: loan.id, adminId: admin.user.id },
      });
    }
    await tx.loan.delete({ where: { id: loan.id } });
  });

  await logAudit({
    actorId: admin.user.id,
    actorRole: admin.user.role,
    action: "admin_loan_deleted",
    targetType: "Loan",
    targetId: id,
    metadata: { principal, previousStatus: loan.status, reclaimAmount },
    request,
  });

  return NextResponse.json({
    ok: true,
    message:
      reclaimAmount > 0
        ? `Prêt supprimé définitivement et ${formatXAF(reclaimAmount)} retirés du portefeuille.`
        : "Prêt supprimé définitivement.",
  });
}

