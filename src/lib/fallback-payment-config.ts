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
    orangeUssdCode: row.orangeUssdCode ?? "",
    orangeBeneficiaryName: row.orangeBeneficiaryName ?? "",
    mtnUssdCode: row.mtnUssdCode ?? "",
    mtnBeneficiaryName: row.mtnBeneficiaryName ?? "",
  };
}

export async function setFallbackPaymentConfig(
  data: FallbackPaymentConfigData,
  adminId: string,
): Promise<FallbackPaymentConfigData> {
  const cleaned: FallbackPaymentConfigData = {
    orangeUssdCode: data.orangeUssdCode.trim(),
    orangeBeneficiaryName: data.orangeBeneficiaryName.trim(),
    mtnUssdCode: data.mtnUssdCode.trim(),
    mtnBeneficiaryName: data.mtnBeneficiaryName.trim(),
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
    orangeUssdCode: saved.orangeUssdCode,
    orangeBeneficiaryName: saved.orangeBeneficiaryName,
    mtnUssdCode: saved.mtnUssdCode,
    mtnBeneficiaryName: saved.mtnBeneficiaryName,
  };
}

