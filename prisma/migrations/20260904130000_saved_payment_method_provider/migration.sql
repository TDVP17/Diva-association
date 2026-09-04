-- CreateEnum
CREATE TYPE "MobileMoneyProvider" AS ENUM ('ORANGE', 'MTN');

-- AlterTable
ALTER TABLE "saved_payment_methods" ADD COLUMN     "provider" "MobileMoneyProvider" NOT NULL,
ALTER COLUMN "type" SET DEFAULT 'MOBILE_MONEY',
ALTER COLUMN "phone" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "saved_payment_methods_userId_phone_key" ON "saved_payment_methods"("userId", "phone");
