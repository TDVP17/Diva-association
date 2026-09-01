import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import type { Prisma } from "@/generated/prisma/client";

const PAGE_SIZE = 30;

export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(request.url);
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");
  const actor = url.searchParams.get("actor");
  const action = url.searchParams.get("action");
  const resourceType = url.searchParams.get("resourceType");
  const status = url.searchParams.get("status");
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);

  const where: Prisma.AuditLogWhereInput = {};
  if (startDate || endDate) {
    where.createdAt = {
      ...(startDate ? { gte: new Date(startDate) } : {}),
      ...(endDate ? { lte: new Date(`${endDate}T23:59:59.999Z`) } : {}),
    };
  }
  if (actor) {
    where.actor = { name: { contains: actor, mode: "insensitive" } };
  }
  if (action) where.action = action;
  if (resourceType) where.targetType = resourceType;
  if (status === "SUCCESS" || status === "FAILED" || status === "BLOCKED") where.status = status;

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { actor: { select: { name: true, email: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return NextResponse.json({
    logs: logs.map((l) => ({
      id: l.id,
      createdAt: l.createdAt,
      actorId: l.actorId,
      actorName: l.actor?.name ?? null,
      actorEmail: l.actor?.email ?? null,
      actorRole: l.actorRole,
      action: l.action,
      targetType: l.targetType,
      targetId: l.targetId,
      tontineSessionId: l.tontineSessionId,
      ipAddress: l.ipAddress,
      userAgent: l.userAgent,
      status: l.status,
      failureReason: l.failureReason,
      metadata: l.metadata,
      payloadBefore: l.payloadBefore,
      payloadAfter: l.payloadAfter,
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
  });
}
