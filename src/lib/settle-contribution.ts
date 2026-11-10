import crypto from "node:crypto";
import type { Contribution, Membership, MembershipSlot, TontineSession, User } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { generateReceiptPdf } from "@/lib/receipt";
import { saveFile } from "@/lib/storage";
import { sendEmailSafe } from "@/lib/email/resend";
import { renderBrandedEmailHtml } from "@/lib/email/template";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { formatXAF } from "@/lib/format-currency";
import { translate, type Lang } from "@/lib/i18n/translations";
import { TONTINE_TYPE_LABELS } from "@/lib/tontine-labels";

export type ContributionWithSlot = Contribution & {
  membershipSlot: MembershipSlot & {
    membership: Membership & { user: User; tontineSession: TontineSession };
  };
  paidByUser: User | null;
};

export interface PaymentSuccessEmailItem {
  beneficiaryName: string;
  sessionLabel?: string;
  amount?: number;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatSessionSummary(labels: string[], lang: Lang): string {
  const unique = [...new Set(labels.filter(Boolean))];
  if (unique.length === 0) return "DIVA Asso";
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]}, ${unique[1]}`;
  return lang === "en" ? `${unique.length} tontines` : `${unique.length} cotisations`;
}

/**
 * Marks a Contribution PAID, settles this same slot's own unpaid Fine for
 * the same cycle, generates+stores the receipt, and notifies the owning
 * member — strictly WITHOUT 3.1% gateway fees in receipts/emails.
 */
export async function settleContribution(
  contribution: ContributionWithSlot,
  options: { paidAt: Date; origin: string; skipEmail?: boolean; skipNotification?: boolean },
): Promise<void> {
  const { membership } = contribution.membershipSlot;
  const { user, tontineSession } = membership;

  const isRelativePayer = Boolean(contribution.paidByUser && contribution.paidByUser.id !== user.id);
  const paidByName = isRelativePayer ? contribution.paidByUser?.name : undefined;

  const totalPaid =
    Number(contribution.amountPaid) +
    Number(contribution.feePaid) +
    Number(contribution.finePaid);

  const sessionLabel = tontineSession.title || TONTINE_TYPE_LABELS[tontineSession.type];

  const receiptBytes = await generateReceiptPdf({
    memberName: `${user.name} — ${contribution.membershipSlot.beneficiaryName}`,
    paidByName,
    paymentMethod: contribution.recordedByAdminId ? "Recorded by admin" : "Mobile Money / Orange Money",
    tontineType: tontineSession.type,
    sessionLabel,
    amount: Number(contribution.amountPaid),
    fee: Number(contribution.feePaid),
    fine: Number(contribution.finePaid),
    total: totalPaid,
    transRef: contribution.fapshiTxRef ?? contribution.id,
    paidAt: options.paidAt,
  });
  const receiptKey = `receipts/${user.id}/${contribution.id}.pdf`;
  await saveFile(receiptKey, receiptBytes);

  await prisma.$transaction([
    prisma.contribution.update({
      where: { id: contribution.id },
      data: { status: "PAID", paidAt: options.paidAt, receiptPdfUrl: receiptKey },
    }),
    ...(Number(contribution.finePaid) > 0
      ? [
          prisma.fine.updateMany({
            where: {
              membershipSlotId: contribution.membershipSlotId,
              dueDate: contribution.dueDate,
              status: "UNPAID",
            },
            data: { status: "PAID" },
          }),
        ]
      : []),
  ]);

  const receiptUrl = `${options.origin}/api/files/${receiptKey}`;
  const recipientLang: Lang = user.preferredLang === "en" ? "en" : "fr";

  if (!options.skipEmail) {
    await sendEmailSafe(
      user.email,
      translate(recipientLang, "paymentReceivedEmailSubject", { session: sessionLabel }),
      paymentSuccessEmailHtml(recipientLang, {
        recipientName: user.name,
        beneficiaryName: contribution.membershipSlot.beneficiaryName,
        paidByName,
        sessionLabel,
        amount: totalPaid,
        transRef: contribution.fapshiTxRef ?? contribution.id,
        receiptUrl,
      }),
    );
  }

  if (!options.skipNotification) {
    await scheduleInAppNotifications({
      tontineSessionId: membership.tontineSessionId,
      type: "PAYMENT_SUCCESS",
      recipients: [
        {
          userId: user.id,
          message: `Your payment of ${formatXAF(totalPaid)} for ${sessionLabel} was received. Thank you!`,
          messageKey: "paymentSuccessNotifMessage",
          messageVars: { amount: formatXAF(totalPaid), session: sessionLabel },
          actionUrl: `/sessions/${membership.tontineSessionId}`,
        },
      ],
    });
  }

  // Seul le payeur est notifié (les autres membres ne reçoivent pas de notification lors d'une cotisation).

  // When ALL members have contributed for this cycle, if the designated beneficiary
  // has already drawn their lucky ball, alert them to submit their payout details.
  try {
    if (prisma.membershipSlot?.findFirst) {
      const designatedSlot = await prisma.membershipSlot.findFirst({
        where: {
          membership: { tontineSessionId: membership.tontineSessionId, status: "APPROVED" },
          officialPosition: { not: null },
          ballDrawn: { not: null },
          payouts: { none: {} },
        },
        include: {
          membership: { include: { user: true } },
        },
        orderBy: { officialPosition: "asc" },
      });

      if (designatedSlot) {
        const allApprovedSlots = await prisma.membershipSlot.findMany({
          where: { membership: { tontineSessionId: membership.tontineSessionId, status: "APPROVED" } },
          select: { id: true },
        });
        const totalRequired = allApprovedSlots.length;
        const paidCount = await prisma.contribution.count({
          where: {
            membershipSlotId: { in: allApprovedSlots.map((s) => s.id) },
            dueDate: contribution.dueDate,
            status: "PAID",
          },
        });

        if (totalRequired > 0 && paidCount >= totalRequired) {
          const alreadyAlerted = await prisma.notification.findFirst({
            where: {
              userId: designatedSlot.membership.userId,
              tontineSessionId: membership.tontineSessionId,
              type: "PAYOUT_TURN",
              createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
            },
          });

          if (!alreadyAlerted) {
            const benUser = designatedSlot.membership.user;
            const benLang: Lang = benUser.preferredLang === "en" ? "en" : "fr";
            const benRawName = benUser.name.trim();
            const benFirstName = benRawName.split(/\s+/)[0] || benRawName;
            const alertMsg =
              benLang === "fr"
                ? `Salut, ${benFirstName} 👋 ! C'est à votre tour de bouffer la cagnotte de ${sessionLabel} ! 🎉 Tous les membres ont cotisé : veuillez fournir obligatoirement vos deux numéros (un MTN et un Orange) avec les noms de chaque compte pour que DIVA Asso effectue votre virement.`
                : `Hello, ${benFirstName} 👋! It's your turn to receive the ${sessionLabel} payout! 🎉 All members have contributed: please provide BOTH your MTN Mobile Money and Orange Money numbers with their respective account names so DIVA Asso can process your transfer.`;

            await scheduleInAppNotifications({
              tontineSessionId: membership.tontineSessionId,
              type: "PAYOUT_TURN",
              recipients: [
                {
                  userId: benUser.id,
                  message: alertMsg,
                  messageKey: "payoutTurnNotifMessage",
                  messageVars: { name: benFirstName, cotisation: sessionLabel },
                  actionUrl: `/sessions/${membership.tontineSessionId}`,
                },
              ],
            });
          }
        }
      }
    }
  } catch (err) {
    console.error("[settleContribution] 100% milestone alert failed:", err);
  }

  // The payer gets their own confirmation too, when they aren't the
  // beneficiary themselves (relative/friend paying via their own code) —
  // in their OWN preferredLang, not the beneficiary's.
  if (contribution.paidByUser && contribution.paidByUser.id !== user.id) {
    const payerLang: Lang = contribution.paidByUser.preferredLang === "en" ? "en" : "fr";
    const beneficiaryLabel = `${user.name} (${contribution.membershipSlot.beneficiaryName})`;

    if (!options.skipNotification) {
      // In-app & push notification to the relative's phone
      await scheduleInAppNotifications({
        tontineSessionId: membership.tontineSessionId,
        type: "PAYMENT_SUCCESS",
        recipients: [
          {
            userId: contribution.paidByUser.id,
            message:
              payerLang === "en"
                ? `Your contribution of ${formatXAF(totalPaid)} for ${beneficiaryLabel} in ${sessionLabel} was successful! Receipt is available.`
                : `Votre cotisation de ${formatXAF(totalPaid)} pour ${beneficiaryLabel} dans ${sessionLabel} a été validée avec succès ! Votre reçu est disponible.`,
            messageKey: "relativePaymentSuccessNotif",
            messageVars: {
              amount: formatXAF(totalPaid),
              beneficiary: beneficiaryLabel,
              session: sessionLabel,
            },
            actionUrl: "/history",
          },
        ],
      });
    }

    if (!options.skipEmail) {
      await sendEmailSafe(
        contribution.paidByUser.email,
        translate(payerLang, "paymentSentEmailSubject", { session: sessionLabel }),
        paymentSuccessEmailHtml(payerLang, {
          recipientName: contribution.paidByUser.name,
          beneficiaryName: contribution.membershipSlot.beneficiaryName,
          paidByName: contribution.paidByUser.name,
          sessionLabel,
          amount: totalPaid,
          transRef: contribution.fapshiTxRef ?? contribution.id,
          receiptUrl,
          isPayerCopy: true,
        }),
      );
    }
  }
}

/**
 * Settles a batch of contributions (bulk Fapshi payment or multi-proof admin approval)
 * and sends ONE SINGLE consolidated email receipt + ONE in-app notification per distinct
 * account owner (and per relative payer if any), citing all paid slot names cleanly aligned
 * and strictly excluding 3.1% operator fees.
 */
export async function settleContributionsBatch(
  contributions: ContributionWithSlot[],
  options: {
    paidAt: Date;
    origin: string;
    transRefOverride?: string;
    bulkPaymentId?: string;
  },
): Promise<void> {
  if (contributions.length === 0) return;
  if (contributions.length === 1) {
    const single = contributions[0];
    const singleWithRef = options.transRefOverride
      ? { ...single, fapshiTxRef: single.fapshiTxRef ?? options.transRefOverride }
      : single;
    await settleContribution(singleWithRef, { paidAt: options.paidAt, origin: options.origin });
    return;
  }

  for (const contribution of contributions) {
    await settleContribution(contribution, {
      paidAt: options.paidAt,
      origin: options.origin,
      skipEmail: true,
      skipNotification: true,
    });
  }

  // 1. Consolidate per account owner
  const byOwner = new Map<string, ContributionWithSlot[]>();
  for (const c of contributions) {
    const ownerId = c.membershipSlot.membership.userId;
    const list = byOwner.get(ownerId) ?? [];
    list.push(c);
    byOwner.set(ownerId, list);
  }

  for (const [ownerId, ownerContribs] of byOwner.entries()) {
    const owner = ownerContribs[0].membershipSlot.membership.user;
    const ownerLang: Lang = owner.preferredLang === "en" ? "en" : "fr";

    const items: PaymentSuccessEmailItem[] = ownerContribs.map((c) => {
      const s = c.membershipSlot.membership.tontineSession;
      return {
        beneficiaryName: c.membershipSlot.beneficiaryName,
        sessionLabel: s.title || TONTINE_TYPE_LABELS[s.type],
        amount: Number(c.amountPaid || 0) + Number(c.feePaid || 0) + Number(c.finePaid || 0),
      };
    });

    const sumAmount = ownerContribs.reduce((sum, c) => sum + Number(c.amountPaid || 0), 0);
    const sumFee = ownerContribs.reduce((sum, c) => sum + Number(c.feePaid || 0), 0);
    const sumFine = ownerContribs.reduce((sum, c) => sum + Number(c.finePaid || 0), 0);
    const ownerNetTotal = sumAmount + sumFee + sumFine;

    const distinctSessions = [...new Set(items.map((i) => i.sessionLabel!).filter(Boolean))];
    const sessionSummary = formatSessionSummary(distinctSessions, ownerLang);

    const relativePayerNames = [
      ...new Set(
        ownerContribs
          .filter((c) => c.paidByUser && c.paidByUser.id !== ownerId)
          .map((c) => c.paidByUser!.name),
      ),
    ];
    const paidByName = relativePayerNames.length > 0 ? relativePayerNames.join(", ") : undefined;
    const transRef =
      options.transRefOverride ??
      ownerContribs[0].fapshiTxRef ??
      ownerContribs[0].id;

    let receiptUrl: string;
    if (ownerContribs.length === 1) {
      receiptUrl = `${options.origin}/api/files/receipts/${owner.id}/${ownerContribs[0].id}.pdf`;
    } else if (options.bulkPaymentId) {
      receiptUrl = `${options.origin}/api/files/receipts/${owner.id}/bulk-${options.bulkPaymentId}-owner.pdf`;
    } else {
      const digest = crypto
        .createHash("sha256")
        .update(ownerContribs.map((c) => c.id).sort().join(","))
        .digest("hex")
        .slice(0, 12);
      const batchKey = `receipts/${owner.id}/batch-${digest}.pdf`;
      const beneficiaryNamesForPdf =
        distinctSessions.length > 1
          ? items.map((i) => `${i.beneficiaryName} (${i.sessionLabel})`)
          : items.map((i) => i.beneficiaryName);
      const batchPdf = await generateReceiptPdf({
        memberName: owner.name,
        beneficiaryNames: beneficiaryNamesForPdf,
        paidByName,
        paymentMethod: ownerContribs.some((c) => c.recordedByAdminId)
          ? "Recorded by admin"
          : "Mobile Money / Orange Money",
        tontineType: ownerContribs[0].membershipSlot.membership.tontineSession.type,
        sessionLabel: distinctSessions.join(", "),
        amount: sumAmount,
        fee: sumFee,
        fine: sumFine,
        total: ownerNetTotal,
        transRef,
        paidAt: options.paidAt,
      });
      await saveFile(batchKey, batchPdf);
      receiptUrl = `${options.origin}/api/files/${batchKey}`;
    }

    await sendEmailSafe(
      owner.email,
      translate(ownerLang, "paymentReceivedEmailSubject", { session: sessionSummary }),
      paymentSuccessEmailHtml(ownerLang, {
        recipientName: owner.name,
        beneficiaryName: items[0].beneficiaryName,
        items,
        paidByName,
        sessionLabel: sessionSummary,
        amount: ownerNetTotal,
        transRef,
        receiptUrl,
      }),
    );

    const singleSessionId =
      distinctSessions.length === 1
        ? ownerContribs[0].membershipSlot.membership.tontineSessionId
        : undefined;
    const namesInline = items.map((i) => i.beneficiaryName).join(", ");
    await scheduleInAppNotifications({
      ...(singleSessionId ? { tontineSessionId: singleSessionId } : {}),
      type: "PAYMENT_SUCCESS",
      recipients: [
        {
          userId: owner.id,
          message:
            ownerLang === "en"
              ? `Your payment of ${formatXAF(ownerNetTotal)} for ${items.length} names (${namesInline}) was received. Thank you!`
              : `Votre paiement de ${formatXAF(ownerNetTotal)} pour ${items.length} noms (${namesInline}) a été reçu. Merci ! ✅🎉`,
          actionUrl: singleSessionId ? `/sessions/${singleSessionId}` : "/history",
        },
      ],
    });
  }

  // 2. Consolidate per distinct relative payer (when paid for someone else)
  const byRelativePayer = new Map<string, ContributionWithSlot[]>();
  for (const c of contributions) {
    const ownerId = c.membershipSlot.membership.userId;
    if (c.paidByUser && c.paidByUser.id !== ownerId) {
      const list = byRelativePayer.get(c.paidByUser.id) ?? [];
      list.push(c);
      byRelativePayer.set(c.paidByUser.id, list);
    }
  }

  for (const [, payerContribs] of byRelativePayer.entries()) {
    const payer = payerContribs[0].paidByUser!;
    const payerLang: Lang = payer.preferredLang === "en" ? "en" : "fr";

    const distinctOwnerIds = [
      ...new Set(payerContribs.map((c) => c.membershipSlot.membership.userId)),
    ];
    const items: PaymentSuccessEmailItem[] = payerContribs.map((c) => {
      const s = c.membershipSlot.membership.tontineSession;
      const o = c.membershipSlot.membership.user;
      const baseName =
        distinctOwnerIds.length > 1
          ? `${o.name} — ${c.membershipSlot.beneficiaryName}`
          : c.membershipSlot.beneficiaryName;
      return {
        beneficiaryName: baseName,
        sessionLabel: s.title || TONTINE_TYPE_LABELS[s.type],
        amount: Number(c.amountPaid || 0) + Number(c.feePaid || 0) + Number(c.finePaid || 0),
      };
    });

    const sumAmount = payerContribs.reduce((sum, c) => sum + Number(c.amountPaid || 0), 0);
    const sumFee = payerContribs.reduce((sum, c) => sum + Number(c.feePaid || 0), 0);
    const sumFine = payerContribs.reduce((sum, c) => sum + Number(c.finePaid || 0), 0);
    const payerNetTotal = sumAmount + sumFee + sumFine;

    const distinctSessions = [...new Set(items.map((i) => i.sessionLabel!).filter(Boolean))];
    const sessionSummary = formatSessionSummary(distinctSessions, payerLang);
    const transRef =
      options.transRefOverride ??
      payerContribs[0].fapshiTxRef ??
      payerContribs[0].id;

    let payerReceiptUrl: string;
    if (payerContribs.length === 1) {
      const soleOwnerId = payerContribs[0].membershipSlot.membership.userId;
      payerReceiptUrl = `${options.origin}/api/files/receipts/${soleOwnerId}/${payerContribs[0].id}.pdf`;
    } else if (options.bulkPaymentId) {
      payerReceiptUrl = `${options.origin}/api/files/receipts/${payer.id}/bulk-${options.bulkPaymentId}-payer.pdf`;
    } else {
      const digest = crypto
        .createHash("sha256")
        .update(payerContribs.map((c) => c.id).sort().join(","))
        .digest("hex")
        .slice(0, 12);
      const batchKey = `receipts/${payer.id}/batch-${digest}.pdf`;
      const beneficiaryNamesForPdf =
        distinctSessions.length > 1
          ? items.map((i) => `${i.beneficiaryName} (${i.sessionLabel})`)
          : items.map((i) => i.beneficiaryName);
      const batchPdf = await generateReceiptPdf({
        memberName: payerContribs[0].membershipSlot.membership.user.name,
        beneficiaryNames: beneficiaryNamesForPdf,
        paidByName: payer.name,
        paymentMethod: "Mobile Money / Orange Money",
        tontineType: payerContribs[0].membershipSlot.membership.tontineSession.type,
        sessionLabel: distinctSessions.join(", "),
        amount: sumAmount,
        fee: sumFee,
        fine: sumFine,
        total: payerNetTotal,
        transRef,
        paidAt: options.paidAt,
      });
      await saveFile(batchKey, batchPdf);
      payerReceiptUrl = `${options.origin}/api/files/${batchKey}`;
    }

    await sendEmailSafe(
      payer.email,
      translate(payerLang, "paymentSentEmailSubject", { session: sessionSummary }),
      paymentSuccessEmailHtml(payerLang, {
        recipientName: payer.name,
        beneficiaryName: items[0].beneficiaryName,
        items,
        paidByName: payer.name,
        sessionLabel: sessionSummary,
        amount: payerNetTotal,
        transRef,
        receiptUrl: payerReceiptUrl,
        isPayerCopy: true,
      }),
    );

    const namesInline = items.map((i) => i.beneficiaryName).join(", ");
    await scheduleInAppNotifications({
      type: "PAYMENT_SUCCESS",
      recipients: [
        {
          userId: payer.id,
          message:
            payerLang === "en"
              ? `Your combined contribution of ${formatXAF(payerNetTotal)} for ${items.length} names (${namesInline}) was successful! Receipt is available in your history.`
              : `Votre cotisation de ${formatXAF(payerNetTotal)} pour ${items.length} noms (${namesInline}) a été validée avec succès ! Votre reçu est disponible.`,
          actionUrl: "/history",
        },
      ],
    });
  }
}

export function paymentSuccessEmailHtml(
  lang: Lang,
  data: {
    recipientName: string;
    beneficiaryName: string;
    beneficiaryNames?: string[];
    items?: PaymentSuccessEmailItem[];
    paidByName?: string;
    sessionLabel: string;
    amount: number;
    transRef: string;
    receiptUrl: string;
    isPayerCopy?: boolean;
  },
): string {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);

  const rawItems: PaymentSuccessEmailItem[] =
    data.items && data.items.length > 0
      ? data.items
      : data.beneficiaryNames && data.beneficiaryNames.length > 0
        ? data.beneficiaryNames.map((name) => ({ beneficiaryName: name }))
        : [{ beneficiaryName: data.beneficiaryName }];

  const distinctSessions = [...new Set(rawItems.map((i) => i.sessionLabel).filter(Boolean))];
  const showSessionInline = distinctSessions.length > 1;

  const namesHtml =
    rawItems.length === 1
      ? escapeHtml(rawItems[0].beneficiaryName)
      : rawItems
          .map(
            (item) =>
              `<div style="padding: 3px 0; line-height: 1.4; display: flex; justify-content: space-between; gap: 12px; text-align: left;"><span>• ${escapeHtml(item.beneficiaryName)}${
                showSessionInline && item.sessionLabel
                  ? ` <span style="font-weight: 400; color: #64748b; font-size: 12px;">(${escapeHtml(item.sessionLabel)})</span>`
                  : ""
              }</span>${
                item.amount !== undefined ? `<strong style="color: #003528; text-align: right; white-space: nowrap;">${formatXAF(item.amount)}</strong>` : ""
              }</div>`,
          )
          .join("");

  const forLabelText =
    rawItems.length > 1
      ? `${t("contributedForLabel")} (${rawItems.length})`
      : t("contributedForLabel");

  const tdLabelStyle = "padding: 6px 12px 6px 0; color: #64748b; white-space: nowrap; vertical-align: top;";
  const tdValStyle = "padding: 6px 0; font-weight: 600; text-align: right; vertical-align: top;";

  const paidByLine = data.paidByName
    ? `<tr><td style="${tdLabelStyle}"><strong>${t("paidByLabel")} :</strong></td><td style="${tdValStyle}">${escapeHtml(data.paidByName)}</td></tr>`
    : "";

  const subjectKey = data.isPayerCopy ? "paymentSentEmailSubject" : "paymentReceivedEmailSubject";

  const bodyHtml = `
    <p style="margin-top: 0;">${t("paymentReceivedEmailGreeting", { name: escapeHtml(data.recipientName) })}</p>
    <p>${t("paymentReceivedEmailIntro")}</p>
    
    <table width="100%" style="margin: 18px 0; border-collapse: collapse; font-size: 14px;">
      <tr>
        <td style="${tdLabelStyle}"><strong>${forLabelText} :</strong></td>
        <td style="${tdValStyle}">${namesHtml}</td>
      </tr>
      ${paidByLine}
      <tr>
        <td style="${tdLabelStyle}"><strong>${t("contributionLabel")} :</strong></td>
        <td style="${tdValStyle}">${escapeHtml(data.sessionLabel)}</td>
      </tr>
      <tr>
        <td style="${tdLabelStyle}"><strong>${t("amountLabel")} :</strong></td>
        <td style="padding: 6px 0; font-weight: 700; color: #003528; text-align: right; vertical-align: top; font-size: 16px;">${formatXAF(data.amount)}</td>
      </tr>
      <tr>
        <td style="${tdLabelStyle}"><strong>${t("transactionIdLabel")} :</strong></td>
        <td style="padding: 6px 0; font-family: monospace; text-align: right; vertical-align: top; font-size: 13px; word-break: break-all;">${escapeHtml(data.transRef)}</td>
      </tr>
    </table>

    <p style="margin-bottom: 0;">${t("thankYouContributionLine")}</p>
  `;

  return renderBrandedEmailHtml({
    title: t(subjectKey, { session: data.sessionLabel }),
    bodyHtml,
    actionUrl: data.receiptUrl,
    actionLabel: t("downloadReceiptPdf"),
    lang,
  });
}
