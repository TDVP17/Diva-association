import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

interface LogAuditInput {
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  tontineSessionId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Fire-and-forget audit trail write — never throws, never blocks the
 * action it's recording. Called from every sensitive admin/member route
 * after the real operation has already succeeded.
 */
export async function logAudit(input: LogAuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId ?? null,
        tontineSessionId: input.tontineSessionId ?? null,
        metadata: (input.metadata as Prisma.InputJsonValue | undefined) ?? undefined,
      },
    });
  } catch (error) {
    console.error("[audit] failed to write audit log:", error);
  }
}
