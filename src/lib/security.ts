import { prisma } from "@/lib/prisma";

// Regex for common SQL injection patterns:
// 1) Classic tautology attacks: ' OR '1'='1, " OR ""="", ' OR 1=1
// 2) Destructive statements: ; DROP TABLE, ; DELETE FROM, ; TRUNCATE
// 3) UNION based extraction: UNION SELECT, UNION ALL SELECT
// 4) Comment/inline evasion: --, /* */, ;--
// 5) Database fingerprints/timing: SLEEP(), BENCHMARK(), PG_SLEEP()
const SQL_INJECTION_PATTERNS = [
  /(\b(OR|AND)\b\s+['"]?[\w]+['"]?\s*=\s*['"]?[\w]+['"]?)/i,
  /(\b(OR|AND)\b\s+[0-9]+\s*=\s*[0-9]+)/i,
  /(\bUNION\s+(ALL\s+)?SELECT\b)/i,
  /(;\s*(DROP|DELETE|TRUNCATE|ALTER|UPDATE|INSERT)\s+(TABLE|FROM|INTO)?)/i,
  /(--|\/\*|\*\/)/i,
  /(\b(PG_SLEEP|SLEEP|BENCHMARK)\s*\()/i,
  /(';\s*DROP\s+TABLE)/i,
];

export function detectSqlInjection(input: unknown): boolean {
  if (typeof input !== "string") return false;
  const trimmed = input.trim();
  if (!trimmed) return false;
  return SQL_INJECTION_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function extractClientInfo(request: Request): { ip: string; userAgent: string } {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  const ip = forwardedFor ? forwardedFor.split(",")[0].trim() : (realIp || "127.0.0.1");
  const userAgent = request.headers.get("user-agent") || "unknown";
  return { ip, userAgent };
}

export type SecurityEventType =
  | "login_failed"
  | "admin_attempt"
  | "injection_attempt"
  | "unauthorized_session_access"
  | "unauthorized_api_access"
  | "unauthorized_payment_attempt"
  | "unauthorized_bulk_payment_attempt";

export async function logSecurityEvent({
  type,
  emailEssaye,
  ip,
  userAgent,
  details,
}: {
  type: SecurityEventType;
  emailEssaye?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  details?: Record<string, unknown> | null;
}) {
  try {
    await prisma.securityLog.create({
      data: {
        type,
        emailEssaye: emailEssaye ? emailEssaye.slice(0, 255) : null,
        ip: ip ? ip.slice(0, 100) : null,
        userAgent: userAgent ? userAgent.slice(0, 500) : null,
        details: details ? (details as unknown as object) : undefined,
      },
    });
  } catch (err) {
    console.error("[SECURITY] Failed to write security log:", err);
  }
}

