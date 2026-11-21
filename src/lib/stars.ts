import { prisma } from "@/lib/prisma";
import { Role } from "@/generated/prisma/client";
import { logAudit } from "@/lib/audit";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { sendEmailSafe } from "@/lib/email/resend";
import { renderBrandedEmailHtml } from "@/lib/email/template";

export const MIN_STARS_FOR_LOAN = 4;
export const MAX_STARS = 5;

/**
 * Award +1 star (max 5) to members of a PUBLIC tontine session who completed
 * the entire cotisation cycle without having received any fines.
 *
 * Strict business rule:
 * - Only PUBLIC cotisations can award stars (private cotisations are strictly excluded).
 * - Member must finish the entire cycle.
 * - Member must have NEVER had any fines (totalFines === 0).
 * - 4 stars minimum are required for loan eligibility.
 *
 * Called automatically when a public tontine session is marked CLOSED.
 */
export async function awardStarsForCompletedSession(
  sessionId: string,
  adminUser?: { id: string; role: Role },
  request?: Request
) {
  const session = await prisma.tontineSession.findUnique({
    where: { id: sessionId },
    include: {
      memberships: {
        where: { status: "APPROVED" },
        include: {
          user: { select: { id: true, name: true, email: true, preferredLang: true, stars: true } },
          slots: {
            include: {
              fines: { select: { id: true } },
              contributions: {
                where: { status: "PAID" },
                select: { id: true },
              },
            },
          },
        },
      },
    },
  });

  if (!session) return { updatedCount: 0, rewardedUsers: [] };

  // Strict isolation: ONLY public DIVA Asso sessions can award stars!
  if (session.isPrivate) {
    return {
      updatedCount: 0,
      rewardedUsers: [],
      reason: "Les cotisations privées ne délivrent pas d'étoiles de confiance pour les prêts.",
    };
  }

  const rewardedUsers: Array<{ id: string; name: string; oldStars: number; newStars: number }> = [];

  for (const m of session.memberships) {
    const totalFines = m.slots.reduce((acc, slot) => acc + (slot.fines?.length || 0), 0);
    // If the member had strictly 0 fines during the entire public session:
    if (totalFines === 0 && m.slots.length > 0) {
      const currentStars = m.user.stars ?? 0;
      if (currentStars < MAX_STARS) {
        const nextStars = currentStars + 1;
        await prisma.user.update({
          where: { id: m.user.id },
          data: { stars: nextStars },
        });

        rewardedUsers.push({
          id: m.user.id,
          name: m.user.name,
          oldStars: currentStars,
          newStars: nextStars,
        });

        // Notifications in-app & Email
        const unlockedLoan = nextStars >= MIN_STARS_FOR_LOAN && currentStars < MIN_STARS_FOR_LOAN;
        const starMessage = unlockedLoan
          ? `⭐ Félicitations ! Vous avez terminé le cycle de cotisation publique « ${session.title} » sans aucune amende. Vous atteignez ${nextStars}/5 étoiles et débloquez l'accès aux Prêts d'Urgence Garantis !`
          : `⭐ Félicitations ! Vous avez terminé le cycle de cotisation publique « ${session.title} » sans aucune amende (+1 étoile attribuée : ${nextStars}/5).`;

        await scheduleInAppNotifications({
          type: "ADMIN_BROADCAST",
          recipients: [
            {
              userId: m.user.id,
              message: starMessage,
              actionUrl: unlockedLoan ? "/loans" : "/wallet",
            },
          ],
        }).catch(() => {});

        if (m.user.email) {
          const emailSubject = unlockedLoan
            ? "⭐ Félicitations ! Vous avez débloqué l'accès aux Prêts d'Urgence DIVA Asso ! 🎉"
            : "⭐ +1 Étoile de confiance remportée sur DIVA Asso ! 👏";

          const bodyText = [
            `🎉 Félicitations ! Vous avez complété avec succès l'ensemble du cycle de la cotisation « ${session.title} » sans jamais recevoir la moindre amende 👏.`,
            `⭐ Votre score de confiance a été revalorisé : ${currentStars}/5 ➜ ${nextStars}/5 étoiles ✨.`,
            unlockedLoan
              ? `🚀 Vous avez atteint le palier clé de 4 étoiles ! Vous pouvez désormais solliciter des prêts d'urgence garantis par DIVA Asso en toute sérénité 🛡️.`
              : `💪 Continuez sur cette belle lancée : dès 4 étoiles, vous serez immédiatement éligible aux prêts d'urgence sécurisés DIVA Asso 🌿.`,
          ].join("\n\n");

          const emailHtml = renderBrandedEmailHtml({
            title: emailSubject,
            recipientName: m.user.name,
            bodyText,
            actionLabel: unlockedLoan ? "Découvrir mes prêts disponibles" : "Voir mon portefeuille",
            actionUrl: unlockedLoan ? "/loans" : "/wallet",
            lang: m.user.preferredLang === "en" ? "en" : "fr",
          });

          await sendEmailSafe(m.user.email, emailSubject, emailHtml).catch(() => {});
        }

        if (adminUser) {
          await logAudit({
            actorId: adminUser.id,
            actorRole: adminUser.role,
            action: "user_stars_awarded_cycle_completed",
            targetType: "User",
            targetId: m.user.id,
            tontineSessionId: sessionId,
            metadata: {
              sessionTitle: session.title,
              oldStars: currentStars,
              newStars: nextStars,
              unlockedLoan,
              reason: "Cotisation publique terminée avec succès sans aucune amende",
            },
            request,
          });
        }
      }
    }
  }

  return { updatedCount: rewardedUsers.length, rewardedUsers };
}
