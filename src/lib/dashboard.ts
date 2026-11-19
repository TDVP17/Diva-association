import { prisma } from "@/lib/prisma";
import { formatXAF } from "@/lib/format-currency";
import { getUserWalletData, type WalletOperation } from "@/lib/wallet";
import { getContributionTotal, getSlotNextUnpaidDueDate } from "@/lib/tontine-engine";
import { evaluateUserLoanEligibility } from "@/lib/loans";
import { TONTINE_TYPE_LABELS } from "@/lib/tontine-labels";
import { sessionStatusKey } from "@/lib/session-status-label";
import { translate, type Lang } from "@/lib/i18n/translations";

export interface DashboardUpcomingContribution {
  sessionId: string;
  sessionTitle: string;
  sessionType: string;
  isPrivate: boolean;
  slotId: string;
  beneficiaryName: string;
  amount: number;
  fee: number;
  totalAmount: number;
  formattedAmount: string;
  dueDate: string;
  formattedDueDate: string;
  isOverdue: boolean;
  roundNumber?: number | null;
}

export interface DashboardSessionItem {
  id: string;
  title: string;
  type: string;
  isPrivate: boolean;
  amount: number;
  fee: number;
  totalAmount: number;
  formattedTotal: string;
  status: string;
  effectiveStatus: string;
  statusLabel: string;
  membersCount: number;
  userSlotsCount: number;
  description?: string | null;
}

export interface DashboardSummaryData {
  member: {
    id: string;
    fullName: string;
    firstName: string;
    avatar: string | null;
    email: string;
    phone: string | null;
    stars: number;
  };
  wallet: {
    availableBalance: number;
    formattedBalance: string;
    totalContributed: number;
    formattedTotalContributed: string;
    currency: "XAF";
    feePercentage: number;
    isPrivateMember: boolean;
  };
  statistics: {
    activeSessionsCount: number;
    completedContributionsCount: number;
    unpaidFinesCount: number;
    unpaidFinesAmount: number;
  };
  nextContribution: DashboardUpcomingContribution | null;
  sessions: DashboardSessionItem[];
  recentTransactions: WalletOperation[];
  notifications: {
    id: string;
    type: string;
    message: string;
    date: string;
    link?: string | null;
  }[];
  loan: {
    eligible: boolean;
    stars: number;
    maxAllowed: number;
    activeLoan: {
      id: string;
      remainingDue: number;
      dueDate: string;
      status: string;
    } | null;
    pendingLoan: {
      id: string;
      principal: number;
      totalDue: number;
    } | null;
  };
}

export async function getDashboardData(userId: string, lang: Lang = "fr"): Promise<DashboardSummaryData> {
  const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string>) => translate(lang, key, vars);

  // 1. Fetch user base & permissions
  const [user, walletData, memberships, completedContributionsCount, unpaidFinesAggregate, loanEligibility, activeLoan, pendingLoan, unreadNotifs] =
    await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          avatar: true,
          image: true,
          stars: true,
          walletBalance: true,
        },
      }),
      getUserWalletData(userId),
      prisma.membership.findMany({
        where: {
          userId,
          status: "APPROVED",
          tontineSession: { status: { not: "CLOSED" } },
        },
        include: {
          tontineSession: {
            include: {
              memberships: {
                where: { status: "APPROVED" },
                select: {
                  slots: {
                    select: {
                      id: true,
                      officialPosition: true,
                      ballDrawn: true,
                      beneficiaryName: true,
                    },
                  },
                },
              },
            },
          },
          slots: {
            include: {
              contributions: {
                where: { status: "PAID" },
                select: { dueDate: true, amountPaid: true },
              },
            },
          },
        },
        orderBy: { joinedAt: "asc" },
      }),
      prisma.contribution.count({
        where: {
          status: "PAID",
          membershipSlot: { membership: { userId } },
        },
      }),
      prisma.fine.aggregate({
        where: {
          membershipSlot: { membership: { userId } },
          status: "UNPAID",
        },
        _count: { id: true },
        _sum: { amount: true },
      }),
      evaluateUserLoanEligibility(userId).catch(() => null),
      prisma.loan.findFirst({
        where: { userId, status: { in: ["ACTIVE", "OVERDUE"] } },
        select: { id: true, totalDue: true, totalPaid: true, dueDate: true, status: true },
      }),
      prisma.loan.findFirst({
        where: { userId, status: "PENDING_ADMIN" },
        select: { id: true, principal: true, totalDue: true },
      }),
      prisma.notification.findMany({
        where: { userId, channel: "IN_APP", readAt: null },
        orderBy: { createdAt: "desc" },
        take: 3,
        select: { id: true, type: true, message: true, createdAt: true, tontineSessionId: true },
      }),
    ]);

  if (!user) {
    throw new Error("Membre introuvable");
  }

  const fullName = user.name?.trim() || "Membre";
  const firstName = fullName.split(" ")[0] || fullName;
  const userAvatar = user.avatar ?? user.image ?? null;

  // 2. Identify earliest upcoming contribution across all slots of the user
  const now = new Date();
  const upcomingCandidates: DashboardUpcomingContribution[] = [];

  for (const m of memberships) {
    const session = m.tontineSession;
    if (session.status !== "ACTIVE" && session.status !== "DRAWING") continue;

    const allSessionSlots = session.memberships?.flatMap((mem) => mem.slots) ?? [];
    const maxPos = allSessionSlots.reduce((max, s) => Math.max(max, s.officialPosition ?? 0), 0);
    const { amount, fee } = getContributionTotal({
      amount: Number(session.amount),
      fee: Number(session.fee),
    });
    const totalAmount = amount + fee;

    for (const slot of m.slots) {
      if (session.status === "ACTIVE" && slot.officialPosition !== null) {
        const unpaidInfo = getSlotNextUnpaidDueDate({
          type: session.type,
          startDate: session.startDate,
          maxPosition: maxPos > 0 ? maxPos : allSessionSlots.length,
          paidDueDates: slot.contributions.map((c) => c.dueDate),
        });

        if (unpaidInfo.dueDate && !unpaidInfo.isAllPaid) {
          const dueDateTime = unpaidInfo.dueDate.getTime();
          const isOverdue = dueDateTime < now.getTime();
          upcomingCandidates.push({
            sessionId: session.id,
            sessionTitle: session.title || TONTINE_TYPE_LABELS[session.type] || "Cotisation",
            sessionType: session.type,
            isPrivate: session.isPrivate,
            slotId: slot.id,
            beneficiaryName: slot.beneficiaryName,
            amount,
            fee,
            totalAmount,
            formattedAmount: formatXAF(totalAmount),
            dueDate: unpaidInfo.dueDate.toISOString(),
            formattedDueDate: unpaidInfo.dueDate.toLocaleDateString("fr-FR", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
              timeZone: "Africa/Douala",
            }),
            isOverdue,
            roundNumber: unpaidInfo.round,
          });
        }
      }
    }
  }

  // Sort upcoming contributions: overdue first, then earliest deadline
  upcomingCandidates.sort((a, b) => {
    if (a.isOverdue && !b.isOverdue) return -1;
    if (!a.isOverdue && b.isOverdue) return 1;
    return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
  });

  const nextContribution = upcomingCandidates[0] || null;

  // 3. Format user's relevant sessions (up to 4)
  const sessions: DashboardSessionItem[] = memberships.slice(0, 4).map((m) => {
    const session = m.tontineSession;
    const allSlots = session.memberships?.flatMap((mem) => mem.slots) ?? [];
    const isDrawDone =
      session.status === "ACTIVE" ||
      (allSlots.length > 0 && allSlots.every((s) => s.officialPosition !== null));
    const effectiveStatus = isDrawDone ? "ACTIVE" : session.status;
    const { amount, fee } = getContributionTotal({
      amount: Number(session.amount),
      fee: Number(session.fee),
    });
    const totalAmount = amount + fee;

    return {
      id: session.id,
      title: session.title || TONTINE_TYPE_LABELS[session.type] || "Cotisation",
      type: session.type,
      isPrivate: session.isPrivate,
      amount,
      fee,
      totalAmount,
      formattedTotal: formatXAF(totalAmount),
      status: session.status,
      effectiveStatus,
      statusLabel: t(sessionStatusKey(effectiveStatus)),
      membersCount: allSlots.length,
      userSlotsCount: m.slots.length,
      description: session.description,
    };
  });

  // 4. Format loan summary
  const activeLoanRemaining = activeLoan ? Math.max(0, Number(activeLoan.totalDue) - Number(activeLoan.totalPaid)) : 0;

  return {
    member: {
      id: user.id,
      fullName,
      firstName,
      avatar: userAvatar,
      email: user.email,
      phone: user.phone,
      stars: user.stars ?? 0,
    },
    wallet: {
      availableBalance: walletData.user.walletBalance,
      formattedBalance: formatXAF(walletData.user.walletBalance),
      totalContributed: walletData.totalContributed,
      formattedTotalContributed: formatXAF(walletData.totalContributed),
      currency: "XAF",
      feePercentage: walletData.feeInfo.percentage,
      isPrivateMember: walletData.feeInfo.isPrivateMember,
    },
    statistics: {
      activeSessionsCount: memberships.length,
      completedContributionsCount,
      unpaidFinesCount: unpaidFinesAggregate._count.id ?? 0,
      unpaidFinesAmount: Number(unpaidFinesAggregate._sum.amount ?? 0),
    },
    nextContribution,
    sessions,
    recentTransactions: walletData.operations.slice(0, 5),
    notifications: unreadNotifs.map((n) => ({
      id: n.id,
      type: n.type,
      message: n.message,
      date: n.createdAt.toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Africa/Douala",
      }),
      link: n.tontineSessionId ? `/sessions/${n.tontineSessionId}` : "/notifications",
    })),
    loan: {
      eligible: Boolean(loanEligibility?.eligible),
      stars: user.stars ?? 0,
      maxAllowed: loanEligibility?.eligible ? loanEligibility.collateral.maxLoanAmount : 0,
      activeLoan: activeLoan
        ? {
            id: activeLoan.id,
            remainingDue: activeLoanRemaining,
            dueDate: activeLoan.dueDate.toISOString(),
            status: activeLoan.status,
          }
        : null,
      pendingLoan: pendingLoan
        ? {
            id: pendingLoan.id,
            principal: Number(pendingLoan.principal),
            totalDue: Number(pendingLoan.totalDue),
          }
        : null,
    },
  };
}
