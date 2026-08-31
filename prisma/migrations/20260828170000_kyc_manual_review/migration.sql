-- AlterTable
ALTER TABLE "kyc_verifications" ADD COLUMN     "selfieImageUrl" TEXT,
ALTER COLUMN "diditSessionId" DROP NOT NULL;

