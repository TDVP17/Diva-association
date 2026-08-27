-- The previous partial index only prevented a duplicate in one direction
-- ((A,B) vs (B,A) were different index keys) — it couldn't stop A
-- requesting a swap with B while B concurrently requests one with A,
-- which the application-level pre-check in
-- src/app/api/chat/swap-requests/route.ts already treats as the same
-- pending pair. Replaced with an expression index over the *unordered*
-- pair (LEAST/GREATEST) so both directions collide on the same key.
DROP INDEX IF EXISTS "position_swap_requests_pending_pair_idx";

CREATE UNIQUE INDEX "position_swap_requests_pending_pair_idx"
  ON "position_swap_requests" (
    "tontineSessionId",
    LEAST("requesterId", "targetId"),
    GREATEST("requesterId", "targetId")
  )
  WHERE "status" IN ('PENDING_MEMBERSHIP', 'PENDING_ADMIN');
