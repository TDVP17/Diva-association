import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const q = searchParams.get("q")?.trim();
  const limit = Math.min(Number(searchParams.get("limit") || 50), 200);

  const whereClause: Record<string, unknown> = {};
  if (type && type !== "all") {
    whereClause.type = type;
  }
  if (q) {
    whereClause.OR = [
      { emailEssaye: { contains: q, mode: "insensitive" } },
      { ip: { contains: q } },
      { userAgent: { contains: q, mode: "insensitive" } },
    ];
  }

  const [logs, totalCount, appSetting, recent24hFailures, blockedCount] = await Promise.all([
    prisma.securityLog.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.securityLog.count({ where: whereClause }),
    prisma.appSetting.findUnique({ where: { id: "singleton" } }),
    prisma.securityLog.count({
      where: {
        type: { in: ["login_failed", "admin_attempt", "injection_attempt"] },
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }),
    prisma.securityLog.count({
      where: {
        type: "ip_blocked",
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }),
  ]);

  return NextResponse.json({
    logs,
    totalCount,
    appSetting: appSetting || { isLocked: false },
    stats: {
      recent24hFailures,
      blockedCount,
      isLocked: appSetting?.isLocked ?? false,
    },
  });
}
