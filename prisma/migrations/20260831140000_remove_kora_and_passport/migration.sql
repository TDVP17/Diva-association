-- AlterEnum
BEGIN;
CREATE TYPE "KycDocumentType_new" AS ENUM ('CNI');
ALTER TABLE "kyc_verifications" ALTER COLUMN "documentType" TYPE "KycDocumentType_new" USING ("documentType"::text::"KycDocumentType_new");
ALTER TYPE "KycDocumentType" RENAME TO "KycDocumentType_old";
ALTER TYPE "KycDocumentType_new" RENAME TO "KycDocumentType";
DROP TYPE "public"."KycDocumentType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "PaymentMethodType_new" AS ENUM ('MOBILE_MONEY');
ALTER TABLE "saved_payment_methods" ALTER COLUMN "type" TYPE "PaymentMethodType_new" USING ("type"::text::"PaymentMethodType_new");
ALTER TYPE "PaymentMethodType" RENAME TO "PaymentMethodType_old";
ALTER TYPE "PaymentMethodType_new" RENAME TO "PaymentMethodType";
DROP TYPE "public"."PaymentMethodType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "PaymentProvider_new" AS ENUM ('FAPSHI');
ALTER TABLE "contributions" ALTER COLUMN "paymentProvider" TYPE "PaymentProvider_new" USING ("paymentProvider"::text::"PaymentProvider_new");
ALTER TYPE "PaymentProvider" RENAME TO "PaymentProvider_old";
ALTER TYPE "PaymentProvider_new" RENAME TO "PaymentProvider";
DROP TYPE "public"."PaymentProvider_old";
COMMIT;

-- DropIndex
DROP INDEX "contributions_koraReference_key";

-- DropIndex
DROP INDEX "fines_koraReference_key";

-- AlterTable
ALTER TABLE "contributions" DROP COLUMN "koraReference";

-- AlterTable
ALTER TABLE "fines" DROP COLUMN "koraReference";

-- AlterTable
ALTER TABLE "saved_payment_methods" DROP COLUMN "cardBrand",
DROP COLUMN "cardLast4",
DROP COLUMN "koraCardToken";
