-- Drop the simple account-level approval (intentional destructive drop —
-- replaced by document-based KYC tied to the join-request flow instead).
ALTER TABLE "users" DROP COLUMN "accountStatus";
DROP TYPE "AccountStatus";

-- Cotisation metadata (admin-creation flow)
ALTER TABLE "tontine_sessions" ADD COLUMN "title" TEXT;
ALTER TABLE "tontine_sessions" ADD COLUMN "rules" TEXT;

-- Manual-contribution audit trail
ALTER TABLE "contributions" ADD COLUMN "recordedByAdminId" TEXT;
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_recordedByAdminId_fkey" FOREIGN KEY ("recordedByAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- KYC verification (Didit)
CREATE TYPE "KycDocumentType" AS ENUM ('CNI', 'PASSPORT');
CREATE TYPE "KycVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED');

CREATE TABLE "kyc_verifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tontineSessionId" TEXT NOT NULL,
    "membershipId" TEXT,
    "documentType" "KycDocumentType" NOT NULL,
    "status" "KycVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "diditSessionId" TEXT NOT NULL,
    "matchConfidence" DECIMAL(5,2),
    "documentImageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "kyc_verifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "kyc_verifications_membershipId_key" ON "kyc_verifications"("membershipId");
CREATE UNIQUE INDEX "kyc_verifications_diditSessionId_key" ON "kyc_verifications"("diditSessionId");
CREATE INDEX "kyc_verifications_userId_tontineSessionId_idx" ON "kyc_verifications"("userId", "tontineSessionId");

ALTER TABLE "kyc_verifications" ADD CONSTRAINT "kyc_verifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kyc_verifications" ADD CONSTRAINT "kyc_verifications_tontineSessionId_fkey" FOREIGN KEY ("tontineSessionId") REFERENCES "tontine_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kyc_verifications" ADD CONSTRAINT "kyc_verifications_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;
