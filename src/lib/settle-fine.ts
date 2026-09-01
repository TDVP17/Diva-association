import type { Fine, Membership, MembershipSlot, TontineSession, User } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { sendWhatsAppMessageSafe } from "@/lib/whatsapp/evolution";
import { sendEmailSafe } from "@/lib/email/resend";
import { translate } from "@/lib/i18n/translations";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { formatXAF } from "@/lib/format-currency";

const TONTINE_LABELS: Record<string, string> = {
  HEBDO_SUNDAY: "Weekly Tontine (Sunday)",
  MONTHLY_28: "Monthly Tontine (28th)",
  MONTHLY_25: "Monthly Tontine (25th)",
};

type FineWithSlot = Fine & {
  membershipSlot: MembershipSlot & {
    membership: Membership & { user: User; tontineSession: TontineSession };
  };
};

/**
 * Marks a standalone Fine payment as settled and notifies the member —
 * the Fine equivalent of settleContribution(), for fines paid on their own
 * via /fines rather than bundled into a slot's current-cycle contribution.
 */
export async function settleFine(fine: FineWithSlot): Promise<void> {
  await prisma.fine.update({ where: { id: fine.id }, data: { status: "PAID" } });

  const { user, tontineSession } = fine.membershipSlot.membership;
  const lang = user.preferredLang === "fr" ? "fr" : "en";
  const sessionLabel = tontineSession.title || TONTINE_LABELS[tontineSession.type] || tontineSession.type;
  const amount = Number(fine.amount);

  const message = translate(lang, "finePaidMessage", {
    amount: formatXAF(amount),
    session: sessionLabel,
  });

  await sendWhatsAppMessageSafe(user.phone, message);
  await sendEmailSafe(user.email, translate(lang, "finePaidEmailSubject"), `<p>${message}</p>`);

  await scheduleInAppNotifications({
    tontineSessionId: tontineSession.id,
    type: "PAYMENT_SUCCESS",
    recipients: [
      {
        userId: user.id,
        message,
        messageKey: "paymentSuccessNotifMessage",
        messageVars: { amount: formatXAF(amount), session: sessionLabel },
        actionUrl: "/fines",
      },
    ],
  });
}
