import { prisma } from "@/lib/prisma";
import {
  EMPTY_FALLBACK_PAYMENT_CONFIG,
  type FallbackPaymentConfigData,
} from "@/lib/fallback-ussd";

const SINGLETON_ID = "singleton";

export async function getFallbackPaymentConfig(): Promise<FallbackPaymentConfigData> {
  const row = await prisma.fallbackPaymentConfig.findUnique({
    where: { id: SINGLETON_ID },
  });
  if (!row) return { ...EMPTY_FALLBACK_PAYMENT_CONFIG };
  return {
    isEnabled: row.isEnabled ?? true,
    orangeUssdCode: row.orangeUssdCode ?? "",
    orangeBeneficiaryName: row.orangeBeneficiaryName ?? "",
    mtnUssdCode: row.mtnUssdCode ?? "",
    mtnBeneficiaryName: row.mtnBeneficiaryName ?? "",
    isOrangeSuspended: row.isOrangeSuspended ?? false,
    orangeSuspendedReason: row.orangeSuspendedReason ?? "",
    isMtnSuspended: row.isMtnSuspended ?? false,
    mtnSuspendedReason: row.mtnSuspendedReason ?? "",
  };
}

export async function setFallbackPaymentConfig(
  data: Partial<FallbackPaymentConfigData>,
  adminId: string,
): Promise<FallbackPaymentConfigData> {
  const isEnabled = data.isEnabled ?? true;
  const cleaned = {
    isEnabled,
    orangeUssdCode: (data.orangeUssdCode ?? "").trim(),
    orangeBeneficiaryName: (data.orangeBeneficiaryName ?? "").trim(),
    mtnUssdCode: (data.mtnUssdCode ?? "").trim(),
    mtnBeneficiaryName: (data.mtnBeneficiaryName ?? "").trim(),
    isOrangeSuspended: Boolean(data.isOrangeSuspended),
    orangeSuspendedReason: (data.orangeSuspendedReason ?? "").trim(),
    isMtnSuspended: Boolean(data.isMtnSuspended),
    mtnSuspendedReason: (data.mtnSuspendedReason ?? "").trim(),
  };

  const saved = await prisma.fallbackPaymentConfig.upsert({
    where: { id: SINGLETON_ID },
    create: {
      id: SINGLETON_ID,
      ...cleaned,
      updatedByAdminId: adminId,
    },
    update: {
      ...cleaned,
      updatedByAdminId: adminId,
    },
  });

  return {
    isEnabled: saved.isEnabled,
    orangeUssdCode: saved.orangeUssdCode,
    orangeBeneficiaryName: saved.orangeBeneficiaryName,
    mtnUssdCode: saved.mtnUssdCode,
    mtnBeneficiaryName: saved.mtnBeneficiaryName,
    isOrangeSuspended: saved.isOrangeSuspended,
    orangeSuspendedReason: saved.orangeSuspendedReason,
    isMtnSuspended: saved.isMtnSuspended,
    mtnSuspendedReason: saved.mtnSuspendedReason,
  };
}
