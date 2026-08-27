-- Prevents two concurrent requests from creating duplicate pending swap
-- requests between the same pair for the same cotisation — enforced at the
-- database level, not just a pre-check in application code (see
-- src/app/api/chat/swap-requests/route.ts). Not expressible in
-- schema.prisma (Prisma has no partial-unique-index syntax), so this index
-- is hand-written and must be preserved across future `prisma migrate diff`
-- runs rather than accidentally dropped.
CREATE UNIQUE INDEX "position_swap_requests_pending_pair_idx"
  ON "position_swap_requests" ("requesterId", "targetId", "tontineSessionId")
  WHERE "status" IN ('PENDING_MEMBERSHIP', 'PENDING_ADMIN');
