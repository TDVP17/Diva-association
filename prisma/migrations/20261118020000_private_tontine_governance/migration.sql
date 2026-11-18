-- Private tontine admin approval workflow & rules acceptance tracking

ALTER TABLE "tontine_sessions" ADD COLUMN IF NOT EXISTS "privateApprovalStatus" TEXT NOT NULL DEFAULT 'APPROVED';
ALTER TABLE "tontine_sessions" ADD COLUMN IF NOT EXISTS "privateRejectionReason" TEXT;
ALTER TABLE "tontine_sessions" ADD COLUMN IF NOT EXISTS "privateRulesAcceptedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "tontine_sessions_isPrivate_privateApprovalStatus_idx"
  ON "tontine_sessions"("isPrivate", "privateApprovalStatus");
