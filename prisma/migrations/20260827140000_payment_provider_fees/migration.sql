-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('FAPSHI', 'KORAPAY');

-- AlterTable
ALTER TABLE "contributions" ADD COLUMN     "paymentProvider" "PaymentProvider",
ADD COLUMN     "presidentFeeShareAmount" DECIMAL(12,2),
ADD COLUMN     "providerFeeAmount" DECIMAL(12,2),
ADD COLUMN     "providerShareAmount" DECIMAL(12,2);

