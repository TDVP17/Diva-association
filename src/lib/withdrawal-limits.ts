import { prisma } from "@/lib/prisma";

export const DEFAULT_MIN_WITHDRAWAL_XAF = 1_000;
export const DEFAULT_MAX_WITHDRAWAL_XAF = 500_000;
export const DEFAULT_WITHDRAWAL_APPROVAL_THRESHOLD_XAF = 50_000;
export const DEFAULT_MIN_TOPUP_XAF = 500;
export const DEFAULT_MAX_TOPUP_XAF = 500_000;

export interface GlobalWithdrawalLimits {
  minWithdrawalAmount: number;
  maxWithdrawalAmount: number;
  withdrawalApprovalThreshold: number;
  minTopupAmount: number;
  maxTopupAmount: number;
}

export interface EffectiveWithdrawalLimits {
  minAmount: number;
  maxAmount: number;
  globalMaxAmount: number;
  isCustomMax: boolean;
  withdrawalApprovalThreshold: number;
  minTopupAmount: number;
  maxTopupAmount: number;
}

export async function getGlobalWithdrawalLimits(): Promise<GlobalWithdrawalLimits> {
  try {
    const row = await prisma.appSetting.findUnique({
      where: { id: "singleton" },
      select: {
        minWithdrawalAmount: true,
        maxWithdrawalAmount: true,
        withdrawalApprovalThreshold: true,
        minTopupAmount: true,
        maxTopupAmount: true,
      },
    });
    return {
      minWithdrawalAmount: row ? Number(row.minWithdrawalAmount) : DEFAULT_MIN_WITHDRAWAL_XAF,
      maxWithdrawalAmount: row ? Number(row.maxWithdrawalAmount) : DEFAULT_MAX_WITHDRAWAL_XAF,
      withdrawalApprovalThreshold: row ? Number(row.withdrawalApprovalThreshold) : DEFAULT_WITHDRAWAL_APPROVAL_THRESHOLD_XAF,
      minTopupAmount: row?.minTopupAmount !== undefined && row.minTopupAmount !== null ? Number(row.minTopupAmount) : DEFAULT_MIN_TOPUP_XAF,
      maxTopupAmount: row?.maxTopupAmount !== undefined && row.maxTopupAmount !== null ? Number(row.maxTopupAmount) : DEFAULT_MAX_TOPUP_XAF,
    };
  } catch {
    return {
      minWithdrawalAmount: DEFAULT_MIN_WITHDRAWAL_XAF,
      maxWithdrawalAmount: DEFAULT_MAX_WITHDRAWAL_XAF,
      withdrawalApprovalThreshold: DEFAULT_WITHDRAWAL_APPROVAL_THRESHOLD_XAF,
      minTopupAmount: DEFAULT_MIN_TOPUP_XAF,
      maxTopupAmount: DEFAULT_MAX_TOPUP_XAF,
    };
  }
}

export async function setGlobalWithdrawalLimits(
  minWithdrawalAmount: number,
  maxWithdrawalAmount: number,
  withdrawalApprovalThreshold: number = DEFAULT_WITHDRAWAL_APPROVAL_THRESHOLD_XAF,
  minTopupAmount: number = DEFAULT_MIN_TOPUP_XAF,
  maxTopupAmount: number = DEFAULT_MAX_TOPUP_XAF,
): Promise<GlobalWithdrawalLimits> {
  const saved = await prisma.appSetting.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      minWithdrawalAmount,
      maxWithdrawalAmount,
      withdrawalApprovalThreshold,
      minTopupAmount,
      maxTopupAmount,
    },
    update: {
      minWithdrawalAmount,
      maxWithdrawalAmount,
      withdrawalApprovalThreshold,
      minTopupAmount,
      maxTopupAmount,
    },
    select: {
      minWithdrawalAmount: true,
      maxWithdrawalAmount: true,
      withdrawalApprovalThreshold: true,
      minTopupAmount: true,
      maxTopupAmount: true,
    },
  });
  return {
    minWithdrawalAmount: Number(saved.minWithdrawalAmount),
    maxWithdrawalAmount: Number(saved.maxWithdrawalAmount),
    withdrawalApprovalThreshold: Number(saved.withdrawalApprovalThreshold),
    minTopupAmount: Number(saved.minTopupAmount),
    maxTopupAmount: Number(saved.maxTopupAmount),
  };
}

export async function getEffectiveWithdrawalLimits(
  userId: string,
): Promise<EffectiveWithdrawalLimits> {
  const [global, user] = await Promise.all([
    getGlobalWithdrawalLimits(),
    prisma.user.findUnique({
      where: { id: userId },
      select: { maxWithdrawalAmount: true },
    }),
  ]);

  const customMax =
    user?.maxWithdrawalAmount !== null && user?.maxWithdrawalAmount !== undefined
      ? Number(user.maxWithdrawalAmount)
      : null;

  return {
    minAmount: global.minWithdrawalAmount,
    maxAmount: customMax !== null && customMax > 0 ? customMax : global.maxWithdrawalAmount,
    globalMaxAmount: global.maxWithdrawalAmount,
    isCustomMax: customMax !== null && customMax > 0,
    withdrawalApprovalThreshold: global.withdrawalApprovalThreshold,
    minTopupAmount: global.minTopupAmount,
    maxTopupAmount: global.maxTopupAmount,
  };
}

