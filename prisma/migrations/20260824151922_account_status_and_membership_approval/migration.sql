-- Rename KycStatus -> AccountStatus (data-preserving; the old default diff
-- would have dropped+recreated the column, resetting every user's approval
-- status back to PENDING).
ALTER TYPE "KycStatus" RENAME TO "AccountStatus";
ALTER TABLE "users" RENAME COLUMN "kycStatus" TO "accountStatus";

-- Drop the now-unused identity-document fields (KYC upload flow removed).
ALTER TABLE "users" DROP COLUMN "cniFrontUrl",
DROP COLUMN "cniBackUrl",
DROP COLUMN "selfieUrl";

-- New per-tontine membership approval status.
CREATE TYPE "MembershipStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
ALTER TABLE "memberships" ADD COLUMN "status" "MembershipStatus" NOT NULL DEFAULT 'PENDING';
