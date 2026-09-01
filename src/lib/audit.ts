import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { AuditLogStatus, Role } from "@/generated/prisma/enums";

interface LogAuditInput {
  actorId?: string | null;
  /** Snapshot the actor's role at call time — e.g. `admin.user.role`. Never re-derived later. */
  actorRole?: Role | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  tontineSessionId?: string | null;
  metadata?: Record<string, unknown>;
  /** State of the target resource before this action, for a before/after diff in the admin viewer. */
  payloadBefore?: Record<string, unknown> | null;
  /** State of the target resource after this action. */
  payloadAfter?: Record<string, unknown> | null;
  status?: AuditLogStatus;
  /** Why the action failed/was blocked — only meaningful when status isn't SUCCESS. */
  failureReason?: string | null;
  /**
   * The route handler's incoming Request — when passed, ipAddress/userAgent
   * are extracted automatically so call sites don't have to parse headers
   * themselves. Ignored if ipAddress/userAgent are also passed explicitly.
   */
  request?: Request | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Best-effort client IP from standard proxy headers (Vercel/most proxies set x-forwarded-for). */
function extractIpAddress(request: Request): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]!.trim();
  return request.headers.get("x-real-ip");
}

/**
 * Fire-and-forget audit trail write — never throws, never blocks the
 * action it's recording. Called from every sensitive admin/member route
 * after the real operation has already succeeded (or failed/was blocked,
 * via `status`). Rows are append-only at the database level — see the
 * audit_logs_no_update/audit_logs_no_delete triggers in
 * 20260902120000_audit_log_hardening/migration.sql.
 */
export async function logAudit(input: LogAuditInput): Promise<void> {
  try {
    const ipAddress = input.ipAddress ?? (input.request ? extractIpAddress(input.request) : null);
    const userAgent = input.userAgent ?? input.request?.headers.get("user-agent") ?? null;

    await prisma.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        actorRole: input.actorRole ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        tontineSessionId: input.tontineSessionId ?? null,
        metadata: (input.metadata as Prisma.InputJsonValue | undefined) ?? undefined,
        payloadBefore: (input.payloadBefore as Prisma.InputJsonValue | null | undefined) ?? undefined,
        payloadAfter: (input.payloadAfter as Prisma.InputJsonValue | null | undefined) ?? undefined,
        ipAddress,
        userAgent,
        status: input.status ?? "SUCCESS",
        failureReason: input.failureReason ?? null,
      },
    });
  } catch (error) {
    console.error("[audit] failed to write audit log:", error);
  }
}
