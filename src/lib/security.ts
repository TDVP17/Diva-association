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
  | "unauthorized_bulk_payment_attempt"
  | "admin_alert_sent"
  | "ip_blocked"
  | "emergency_lock_activated"
  | "emergency_lock_deactivated";

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

/**
 * Vérifie si une IP est temporairement bloquée (après 5 échecs consécutifs en 15 min).
 * Le blocage dure 30 minutes.
 */
export async function checkIpIsBlocked(ip: string): Promise<{ isBlocked: boolean; remainingMinutes: number }> {
  try {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

    // Vérifie s'il y a 5 échecs ou plus sur cette IP dans les 15 dernières minutes
    const recentFailures = await prisma.securityLog.findMany({
      where: {
        ip,
        type: { in: ["login_failed", "admin_attempt", "injection_attempt"] },
        createdAt: { gte: thirtyMinutesAgo },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    if (recentFailures.length >= 5) {
      // Vérifie l'ancienneté du 5ème échec
      const fifthAttempt = recentFailures[4];
      const elapsedMs = Date.now() - fifthAttempt.createdAt.getTime();
      const lockDurationMs = 30 * 60 * 1000;

      if (elapsedMs < lockDurationMs) {
        const remainingMinutes = Math.ceil((lockDurationMs - elapsedMs) / (60 * 1000));
        return { isBlocked: true, remainingMinutes };
      }
    }
  } catch (e) {
    console.error("[SECURITY] checkIpIsBlocked error:", e);
  }
  return { isBlocked: false, remainingMinutes: 0 };
}

/**
 * Envoie un email d'alerte immédiat à l'admin via l'Edge Function Supabase `send-email`.
 */
async function sendAdminSecurityAlert({
  targetEmail,
  ip,
  userAgent,
  country,
  failureCount,
  cameroonTime,
}: {
  targetEmail: string;
  ip: string;
  userAgent: string;
  country: string;
  failureCount: number;
  cameroonTime: string;
}) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return;

  const adminEmail = process.env.ADMIN_ALERT_EMAIL || "divaasso17@gmail.com";

  const bodyHtml = `
    <div style="font-family: sans-serif; line-height: 1.6; color: #1e293b;">
      <h2 style="color: #b91c1c; margin-top: 0;">🚨 Alerte Sécurité DIVA : Tentative suspecte de connexion</h2>
      <p>Un utilisateur a échoué <strong>${failureCount} fois</strong> consécutivement à se connecter à la plateforme.</p>
      
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
        <tr>
          <td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">📧 Compte ciblé :</td>
          <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;"><code>${targetEmail}</code></td>
        </tr>
        <tr>
          <td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">🌐 Adresse IP :</td>
          <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;"><code>${ip}</code></td>
        </tr>
        <tr>
          <td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">📍 Pays / Localisation :</td>
          <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${country}</td>
        </tr>
        <tr>
          <td style="padding: 10px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">🕒 Heure (Cameroun) :</td>
          <td style="padding: 10px; border-bottom: 1px solid #e2e8f0;">${cameroonTime}</td>
        </tr>
        <tr>
          <td style="padding: 10px; font-weight: bold;">💻 Navigateur :</td>
          <td style="padding: 10px; font-size: 13px; color: #64748b;">${userAgent}</td>
        </tr>
      </table>

      <p style="font-size: 14px; color: #475569;">
        Si cette adresse IP dépasse 5 tentatives, elle sera automatiquement bloquée pendant 30 minutes.
      </p>
    </div>
  `;

  try {
    await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        to: adminEmail,
        subject: `🚨 Alerte Sécurité DIVA : Tentative suspecte sur ${targetEmail}`,
        bodyHtml,
        actionUrl: "/admin/security",
        actionLabel: "Consulter les logs de sécurité",
      }),
    });
  } catch (err) {
    console.error("[SECURITY] Failed to dispatch admin alert email:", err);
  }
}

/**
 * Enregistre un échec de connexion, déclenche l'alerte admin (après 2 échecs)
 * ou le blocage IP (après 5 échecs en 15 min).
 */
export async function recordFailedLoginAttempt({
  emailEssaye,
  ip,
  userAgent,
  country = "Inconnu (Cameroun par défaut)",
  isAdminTarget = false,
}: {
  emailEssaye: string;
  ip: string;
  userAgent: string;
  country?: string;
  isAdminTarget?: boolean;
}): Promise<{ blocked: boolean; failuresCount: number }> {
  const eventType: SecurityEventType = isAdminTarget ? "admin_attempt" : "login_failed";

  // 1. Enregistre le log d'échec
  await logSecurityEvent({
    type: eventType,
    emailEssaye,
    ip,
    userAgent,
    details: { country, timestamp: new Date().toISOString() },
  });

  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

  // 2. Compte les échecs récents pour la même IP OU le même email
  const [ipFailures, emailFailures] = await Promise.all([
    prisma.securityLog.count({
      where: {
        ip,
        type: { in: ["login_failed", "admin_attempt"] },
        createdAt: { gte: fifteenMinutesAgo },
      },
    }),
    prisma.securityLog.count({
      where: {
        emailEssaye,
        type: { in: ["login_failed", "admin_attempt"] },
        createdAt: { gte: fifteenMinutesAgo },
      },
    }),
  ]);

  const maxFailures = Math.max(ipFailures, emailFailures);
  const cameroonTime = new Date().toLocaleString("fr-FR", { timeZone: "Africa/Douala" });

  // 3. Après 2 échecs : Alerte immédiate à l'admin via send-email
  if (maxFailures >= 2) {
    // Vérifie qu'on n'a pas déjà envoyé une alerte dans les 15 dernières minutes pour cette cible
    const recentAlert = await prisma.securityLog.findFirst({
      where: {
        type: "admin_alert_sent",
        OR: [{ ip }, { emailEssaye }],
        createdAt: { gte: fifteenMinutesAgo },
      },
    });

    if (!recentAlert) {
      await sendAdminSecurityAlert({
        targetEmail: emailEssaye,
        ip,
        userAgent,
        country,
        failureCount: maxFailures,
        cameroonTime,
      });

      await logSecurityEvent({
        type: "admin_alert_sent",
        emailEssaye,
        ip,
        userAgent,
        details: { failureCount: maxFailures, cameroonTime },
      });
    }
  }

  // 4. Après 5 échecs en 15 minutes : Blocage IP
  if (maxFailures >= 5) {
    await logSecurityEvent({
      type: "ip_blocked",
      emailEssaye,
      ip,
      userAgent,
      details: { failureCount: maxFailures, duration: "30 minutes" },
    });
    return { blocked: true, failuresCount: maxFailures };
  }

  return { blocked: false, failuresCount: maxFailures };
}

/**
 * Vérifie si l'application est en état de verrouillage d'urgence (Bouton Panique).
 */
export async function isAppLocked(): Promise<boolean> {
  try {
    const setting = await prisma.appSetting.findUnique({
      where: { id: "singleton" },
      select: { isLocked: true },
    });
    return setting?.isLocked ?? false;
  } catch (err) {
    console.error("[SECURITY] isAppLocked check error:", err);
    return false;
  }
}

/**
 * Active ou désactive le verrouillage d'urgence de toute l'application.
 */
export async function setAppLocked({
  isLocked,
  adminEmail,
  reason,
}: {
  isLocked: boolean;
  adminEmail: string;
  reason?: string;
}): Promise<{ success: boolean; isLocked: boolean; lockedAt: Date }> {
  const now = new Date();
  await prisma.appSetting.upsert({
    where: { id: "singleton" },
    update: {
      isLocked,
      lockedAt: isLocked ? now : null,
      lockedBy: isLocked ? adminEmail : null,
      lockReason: isLocked ? reason || "Verrouillage d'urgence activé par l'administrateur" : null,
      updatedAt: now,
    },
    create: {
      id: "singleton",
      isLocked,
      lockedAt: isLocked ? now : null,
      lockedBy: isLocked ? adminEmail : null,
      lockReason: isLocked ? reason || "Verrouillage d'urgence activé par l'administrateur" : null,
      updatedAt: now,
    },
  });

  const cameroonTime = now.toLocaleTimeString("fr-FR", {
    timeZone: "Africa/Douala",
    hour: "2-digit",
    minute: "2-digit",
  });

  // Log de sécurité
  await logSecurityEvent({
    type: isLocked ? "emergency_lock_activated" : "emergency_lock_deactivated",
    emailEssaye: adminEmail,
    details: { reason, time: cameroonTime },
  });

  // Envoi d'email de confirmation à l'admin
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseUrl && serviceKey) {
    const statusLabel = isLocked ? "verrouillée" : "déverrouillée";
    const subject = isLocked
      ? `🔒 Application verrouillée à ${cameroonTime}`
      : `🔓 Application déverrouillée à ${cameroonTime}`;
    const bodyHtml = `
      <div style="font-family: sans-serif; line-height: 1.6; color: #1e293b;">
        <h2 style="color: ${isLocked ? "#b91c1c" : "#15803d"}; margin-top: 0;">
          ${isLocked ? "🔒 Verrouillage d'Urgence Activé" : "🔓 Application Déverrouillée"}
        </h2>
        <p>Application ${statusLabel} à <strong>${cameroonTime}</strong> (heure du Cameroun) par <strong>${adminEmail}</strong>.</p>
        ${reason ? `<p><strong>Motif renseigné :</strong> ${reason}</p>` : ""}
        <p style="font-size: 14px; color: #64748b;">
          ${
            isLocked
              ? "Tous les paiements sont suspendus et l'accès membre redirige vers la page d'indisponibilité. Seuls les administrateurs peuvent se connecter pour déverrouiller."
              : "La plateforme est de nouveau pleinement accessible pour l'ensemble des membres et les paiements sont opérationnels."
          }
        </p>
      </div>
    `;

    try {
      await fetch(`${supabaseUrl}/functions/v1/send-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({
          to: adminEmail,
          subject,
          bodyHtml,
          actionUrl: "/admin/security",
          actionLabel: "Ouvrir le panneau d'administration",
        }),
      });
    } catch (err) {
      console.error("[SECURITY] Failed to send lock notification email:", err);
    }
  }

  return { success: true, isLocked, lockedAt: now };
}

