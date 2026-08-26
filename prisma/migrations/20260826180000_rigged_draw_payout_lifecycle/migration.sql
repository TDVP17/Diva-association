-- CreateEnum
CREATE TYPE "PaymentMethodType" AS ENUM ('MOBILE_MONEY', 'CARD');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('DETAILS_SUBMITTED', 'RELEASED', 'CONFIRMED');

-- DropForeignKey
ALTER TABLE "payouts" DROP CONSTRAINT "payouts_releasedByAdminId_fkey";

-- AlterTable
ALTER TABLE "contributions" ADD COLUMN     "koraReference" TEXT;

-- AlterTable
ALTER TABLE "fines" ADD COLUMN     "fapshiTxRef" TEXT,
ADD COLUMN     "koraReference" TEXT;

-- AlterTable
ALTER TABLE "payouts" ADD COLUMN     "confirmedByAdmin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "detailsSubmittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "memberConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "payoutAccountName" TEXT NOT NULL,
ADD COLUMN     "payoutPhone" TEXT NOT NULL,
ADD COLUMN     "status" "PayoutStatus" NOT NULL DEFAULT 'DETAILS_SUBMITTED',
ALTER COLUMN "pot" DROP NOT NULL,
ALTER COLUMN "deducted" DROP NOT NULL,
ALTER COLUMN "netPayout" DROP NOT NULL,
ALTER COLUMN "releasedByAdminId" DROP NOT NULL,
ALTER COLUMN "releasedAt" DROP NOT NULL,
ALTER COLUMN "releasedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "saved_payment_methods" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "PaymentMethodType" NOT NULL,
    "label" TEXT,
    "phone" TEXT,
    "cardBrand" TEXT,
    "cardLast4" TEXT,
    "koraCardToken" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contributions_koraReference_key" ON "contributions"("koraReference");

-- CreateIndex
CREATE UNIQUE INDEX "fines_fapshiTxRef_key" ON "fines"("fapshiTxRef");

-- CreateIndex
CREATE UNIQUE INDEX "fines_koraReference_key" ON "fines"("koraReference");

-- AddForeignKey
ALTER TABLE "saved_payment_methods" ADD CONSTRAINT "saved_payment_methods_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_releasedByAdminId_fkey" FOREIGN KEY ("releasedByAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

