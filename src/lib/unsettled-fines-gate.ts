import { prisma } from "@/lib/prisma";

export interface FinesGateResult {
  canJoin: boolean;
  unpaidFinesCount: number;
  totalUnpaidAmount: number;
  blockingSessions: string[];
  error?: string;
}

/**
 * Checks whether a user has unpaid fines from ended or other cotisations.
 *
 * Règle association : "Les amendes ne sont pas obligées d'être payées à l'instant,
 * c'est à la fin de la cotisation que si quelqu'un n'a pas toujours payé ses amendes
 * il ne peut pas intégrer dans une autre cotisation sans avoir finalisé."
 *
 * S'il reste des amendes impayées (UNPAID ou FAILED), l'utilisateur est bloqué pour
 * intégrer toute nouvelle cotisation tant qu'il n'a pas régularisé ses amendes.
 */
export async function checkUserFinesForJoining(
  userId: string,
  targetSessionId?: string,
): Promise<FinesGateResult> {
  if (!prisma?.fine?.findMany || typeof prisma.fine.findMany !== "function") {
    return {
      canJoin: true,
      unpaidFinesCount: 0,
      totalUnpaidAmount: 0,
      blockingSessions: [],
    };
  }

  const unpaidFines = await prisma.fine.findMany({
    where: {
      membershipSlot: {
        membership: {
          userId,
        },
      },
      status: { in: ["UNPAID", "FAILED"] },
    },
    include: {
      membershipSlot: {
        include: {
          membership: {
            include: {
              tontineSession: {
                select: {
                  id: true,
                  title: true,
                  type: true,
                  status: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const blockingFines = unpaidFines.filter((f) => {
    const session = f.membershipSlot.membership.tontineSession;
    if (targetSessionId && session.id === targetSessionId) {
      return false;
    }
    return true;
  });

  if (blockingFines.length === 0) {
    return {
      canJoin: true,
      unpaidFinesCount: 0,
      totalUnpaidAmount: 0,
      blockingSessions: [],
    };
  }

  const totalUnpaidAmount = blockingFines.reduce((sum, f) => sum + Number(f.amount), 0);
  const sessionTitles = Array.from(
    new Set(
      blockingFines.map((f) => {
        const s = f.membershipSlot.membership.tontineSession;
        return s.title || s.type;
      }),
    ),
  );

  return {
    canJoin: false,
    unpaidFinesCount: blockingFines.length,
    totalUnpaidAmount,
    blockingSessions: sessionTitles,
    error: `Vous avez des amendes impayées (${totalUnpaidAmount.toLocaleString()} FCFA). Vous devez impérativement finaliser et régulariser vos amendes avant de pouvoir intégrer une nouvelle cotisation.`,
  };
}
