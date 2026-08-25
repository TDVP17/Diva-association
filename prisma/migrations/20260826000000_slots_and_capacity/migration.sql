-- Restructures payment/draw tracking from per-membership to per-slot.
-- Existing Contribution/Fine rows can't be meaningfully mapped to slots
-- that didn't exist yet when they were created — this app is pre-launch
-- with only demo/test data at stake, so they're cleared rather than left
-- as orphaned rows with no valid membershipSlotId to point at.
DELETE FROM "contributions";
DELETE FROM "fines";

-- Cotisation-level capacity cap.
ALTER TABLE "tontine_sessions" ADD COLUMN "maxSlots" DECIMAL(5,1);

-- Membership: officialPosition/ballDrawn move to the new per-slot table;
-- slotCount is the new post-approval billing multiplier.
ALTER TABLE "memberships" ADD COLUMN "slotCount" DECIMAL(3,1);
ALTER TABLE "memberships" DROP COLUMN "officialPosition";
ALTER TABLE "memberships" DROP COLUMN "ballDrawn";

-- New per-slot table: one row per named, positioned slot.
CREATE TABLE "membership_slots" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "beneficiaryName" TEXT NOT NULL,
    "officialPosition" INTEGER,
    "ballDrawn" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_slots_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "membership_slots" ADD CONSTRAINT "membership_slots_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Contribution: re-key from (userId, tontineSessionId) to membershipSlotId.
ALTER TABLE "contributions" DROP CONSTRAINT "contributions_userId_fkey";
ALTER TABLE "contributions" DROP CONSTRAINT "contributions_tontineSessionId_fkey";
DROP INDEX "contributions_userId_tontineSessionId_dueDate_key";

ALTER TABLE "contributions" ADD COLUMN "membershipSlotId" TEXT NOT NULL;
ALTER TABLE "contributions" DROP COLUMN "userId";
ALTER TABLE "contributions" DROP COLUMN "tontineSessionId";

CREATE UNIQUE INDEX "contributions_membershipSlotId_dueDate_key" ON "contributions"("membershipSlotId", "dueDate");
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_membershipSlotId_fkey" FOREIGN KEY ("membershipSlotId") REFERENCES "membership_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Fine: same re-key as Contribution.
ALTER TABLE "fines" DROP CONSTRAINT "fines_userId_fkey";
ALTER TABLE "fines" DROP CONSTRAINT "fines_tontineSessionId_fkey";
DROP INDEX "fines_userId_tontineSessionId_dueDate_key";

ALTER TABLE "fines" ADD COLUMN "membershipSlotId" TEXT NOT NULL;
ALTER TABLE "fines" DROP COLUMN "userId";
ALTER TABLE "fines" DROP COLUMN "tontineSessionId";

CREATE UNIQUE INDEX "fines_membershipSlotId_dueDate_key" ON "fines"("membershipSlotId", "dueDate");
ALTER TABLE "fines" ADD CONSTRAINT "fines_membershipSlotId_fkey" FOREIGN KEY ("membershipSlotId") REFERENCES "membership_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
