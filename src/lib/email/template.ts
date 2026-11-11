import { sendEmailSafe } from "@/lib/email/resend";
import { prisma } from "@/lib/prisma";
import type { Lang } from "@/lib/i18n/translations";

export interface BrandedEmailParams {
  title: string;
  bodyHtml?: string;
  bodyText?: string;
  actionUrl?: string;
  actionLabel?: string;
  lang?: Lang;
  baseUrl?: string;
  recipientName?: string;
}

export const ASSO_TITLE_BADGE = "Asso 🌿";

const LEADING_GREETING_PREFIX_RE =
  /^(?:salut|bonjour|bonsoir|coucou|hello|hi|hey)(?:\s*,?\s+[^\r\n!?:—]{1,40}?)?(?:\s*👋)?\s*(?:[!?:—-]+)\s*/iu;

const OPENING_GREETING_RE =
  /^\s*(?:[\p{Extended_Pictographic}\uFE0F\u200D\u20E3\s]*)(?:salut|bonjour|bonsoir|coucou|hello|hi\b|hey\b|dear\b|cher|chère|félicitations|congratulations)\b/iu;

const STANDALONE_GREETING_LINE_RE =
  /^\s*((?:salut|bonjour|bonsoir|coucou|hello|hi|hey)(?:\s*,?\s+[^\r\n!?:—]{1,40}?)?(?:\s*👋)?\s*[!.]?)\s*\r?\n\s*\r?\n\s*([\s\S]+)$/iu;

/** Strips any personal greeting prefix (e.g. "Salut, Valentine 👋 ! ") from a title/subject. */
export function stripLeadingGreetingPrefix(text: string): string {
  return text.trim().replace(LEADING_GREETING_PREFIX_RE, "").trim();
}

/**
 * Formats an announcement/email title with "Asso 🌿 — " (no personal greeting
 * and no member name), replacing any leading greeting prefix cleanly.
 */
export function formatBroadcastTitle(rawTitle: string): string {
  const cleaned = stripLeadingGreetingPrefix(rawTitle);
  if (!cleaned) return ASSO_TITLE_BADGE;
  if (/^(?:[\p{Extended_Pictographic}\uFE0F\u200D\s]*(?:DIVA\s+)?Asso\b)/iu.test(cleaned)) {
    return cleaned;
  }
  return `${ASSO_TITLE_BADGE} — ${cleaned}`;
}

/**
 * Checks whether the opening lines of a notification/email body already contain
 * a greeting so we never double-greet or repeat the recipient's name.
 */
export function hasOpeningGreeting(text: string): boolean {
  const headLines = text.trim().split(/\r?\n/).slice(0, 3);
  return headLines.some((line) => OPENING_GREETING_RE.test(line));
}

export function getAppBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "https://www.divaasso.com";
}

/**
 * Returns a standardized, high-deliverability responsive HTML email template
 * featuring the official DIVA Asso logo, brand colors, and clean layout.
 */
export function renderBrandedEmailHtml(params: BrandedEmailParams): string {
  const baseUrl = params.baseUrl || getAppBaseUrl();
  const logoUrl = `${baseUrl}/icons/icon-512.png`;
  const primaryColor = "#003528";
  const rawUrl = params.actionUrl?.trim() || "/dashboard";
  let targetUrl = "";

  if (rawUrl.startsWith("http")) {
    try {
      const parsed = new URL(rawUrl);
      const baseOrigin = new URL(baseUrl).origin;
      if (parsed.origin === baseOrigin) {
        targetUrl = `${baseUrl}/open?target=${encodeURIComponent(parsed.pathname + parsed.search)}`;
      } else {
        targetUrl = rawUrl;
      }
    } catch {
      targetUrl = rawUrl;
    }
  } else {
    const cleanPath = rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`;
    targetUrl = `${baseUrl}/open?target=${encodeURIComponent(cleanPath)}`;
  }

  const actionButton = `
    <div style="margin: 28px 0 10px 0; text-align: center;">
      <a href="${targetUrl}" 
         style="background-color: ${primaryColor}; color: #ffffff; padding: 13px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px; display: inline-block; box-shadow: 0 2px 4px rgba(0,53,40,0.15);">
        ${params.actionLabel || (params.lang === "en" ? "Open in App" : "Ouvrir dans l'application")}
      </a>
    </div>
  `;

  const rawRecipient = params.recipientName?.trim();
  const firstName = rawRecipient ? rawRecipient.split(/\s+/)[0] : "";
  const greetingHtml = firstName
    ? `<p style="font-size: 16px; font-weight: 700; color: #003528; margin: 0 0 14px 0;">${
        params.lang === "en" ? `Hello, ${firstName} 👋` : `Salut, ${firstName} 👋`
      }</p>`
    : "";

  const sanitizeEmailBody = (str: string) => {
    return str
      .replace(/Salut,\s*\{name\}\s*👋/g, firstName ? `Salut, ${firstName} 👋` : "Salut 👋")
      .replace(/Hello,\s*\{name\}\s*👋/g, firstName ? `Hello, ${firstName} 👋` : "Hello 👋")
      .replace(/Bonjour,\s*\{name\}\s*👋/g, firstName ? `Bonjour, ${firstName} 👋` : "Bonjour 👋")
      .replace(/,\s*\{name\}/g, firstName ? `, ${firstName}` : "")
      .replace(/\{name\}/g, firstName || "");
  };

  const rawTitle = (params.title || "").trim();
  const cleanTitle = LEADING_GREETING_PREFIX_RE.test(rawTitle)
    ? formatBroadcastTitle(rawTitle)
    : rawTitle || ASSO_TITLE_BADGE;

  let content = "";
  if (params.bodyHtml) {
    const cleanHtml = sanitizeEmailBody(params.bodyHtml);
    const htmlHeadText = cleanHtml
      .replace(/<[^>]+>/g, "\n")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 3)
      .join("\n");
    content = hasOpeningGreeting(htmlHeadText) ? cleanHtml : `${greetingHtml}${cleanHtml}`;
  } else {
    const rawText = params.bodyText || "";
    const cleanText = sanitizeEmailBody(rawText).trim();
    const standaloneGreetingMatch = cleanText.match(STANDALONE_GREETING_LINE_RE);

    if (standaloneGreetingMatch) {
      const existingGreeting = standaloneGreetingMatch[1].trim();
      const restBody = standaloneGreetingMatch[2].trim();
      content = `<p style="font-size: 16px; font-weight: 700; color: #003528; margin: 0 0 14px 0;">${existingGreeting}</p><p style="font-size: 15px; line-height: 1.65; color: #334155; margin: 0; white-space: pre-line;">${restBody}</p>`;
    } else if (hasOpeningGreeting(cleanText)) {
      content = `<p style="font-size: 15px; line-height: 1.65; color: #334155; margin: 0; white-space: pre-line;">${cleanText}</p>`;
    } else {
      content = `${greetingHtml}<p style="font-size: 15px; line-height: 1.65; color: #334155; margin: 0; white-space: pre-line;">${cleanText}</p>`;
    }
  }

  return `
    <!DOCTYPE html>
    <html lang="${params.lang || "fr"}">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${cleanTitle}</title>
    </head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px 12px; -webkit-font-smoothing: antialiased;">
      <table width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 580px; margin: 0 auto; background-color: #ffffff; border-radius: 14px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 16px rgba(15, 23, 42, 0.04);">
        <!-- En-tête avec Logo Officiel DIVA Asso -->
        <tr>
          <td style="padding: 26px 24px 20px; text-align: center; background: linear-gradient(180deg, #f0fdf4 0%, #ffffff 100%); border-bottom: 1px solid #f1f5f9;">
            <a href="${baseUrl}" target="_blank" style="text-decoration: none; display: inline-block;">
              <img src="${logoUrl}" alt="DIVA Asso" width="60" height="60" style="display: block; margin: 0 auto 10px; border-radius: 14px; border: 1px solid #e2e8f0;" />
              <span style="display: block; font-size: 20px; font-weight: 800; color: #003528; letter-spacing: -0.5px;">DIVA Asso.</span>
            </a>
          </td>
        </tr>
        
        <!-- Contenu du message -->
        <tr>
          <td style="padding: 28px 28px 20px;">
            <h2 style="color: #0f172a; font-size: 18px; font-weight: 700; margin-top: 0; margin-bottom: 18px; line-height: 1.4;">${cleanTitle}</h2>
            <div style="font-size: 15px; line-height: 1.6; color: #334155;">
              ${content}
            </div>
            ${actionButton}
          </td>
        </tr>

        <!-- Pied de page -->
        <tr>
          <td style="padding: 20px 24px 28px; background-color: #f8fafc; border-top: 1px solid #f1f5f9; text-align: center;">
            <p style="font-size: 12px; color: #64748b; margin: 0 0 6px 0;">
              <strong>DIVA Asso.</strong> — Plateforme sécurisée de gestion des tontines et cotisations
            </p>
            <p style="font-size: 11px; color: #94a3b8; margin: 0;">
              <a href="${baseUrl}" style="color: #003528; text-decoration: underline;">www.divaasso.com</a> • Bertoua, Cameroun
            </p>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `.trim();
}

/**
 * Sends a welcome notification (Email + In-App) to a newly registered user,
 * and alerts all administrators that a new member has joined.
 */
export async function sendWelcomeAndAdminNotifications(params: {
  userId: string;
  name: string;
  email: string;
  memberCode: string;
  lang?: Lang;
}): Promise<void> {
  const lang = params.lang || "fr";
  const baseUrl = getAppBaseUrl();
  const firstName = params.name.trim().split(/\s+/)[0] || params.name;

  // 1. Email de bienvenue au nouvel utilisateur
  const userSubject =
    lang === "fr"
      ? "Bienvenue dans la communauté DIVA Asso ! 🎉"
      : "Welcome to the DIVA Asso Community! 🎉";

  const userBodyHtml = `
    <p style="margin-top: 0;">${lang === "fr" ? `Bonjour <strong>${firstName}</strong>,` : `Hello <strong>${firstName}</strong>,`}</p>
    <p>
      ${
        lang === "fr"
          ? "Nous sommes ravis de vous compter parmi nous ! Votre compte DIVA Asso est désormais actif."
          : "We are thrilled to welcome you! Your DIVA Asso account is now active."
      }
    </p>
    
    <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 16px; margin: 20px 0; text-align: center;">
      <p style="margin: 0 0 6px 0; font-size: 13px; color: #166534; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;">
        ${lang === "fr" ? "Votre Matricule de Membre Personnel" : "Your Personal Member Code"}
      </p>
      <div style="font-size: 26px; font-weight: 800; color: #003528; letter-spacing: 2px;">
        ${params.memberCode}
      </div>
      <p style="margin: 8px 0 0 0; font-size: 12px; color: #15803d;">
        ${
          lang === "fr"
            ? "Partagez ce matricule si un proche souhaite cotiser pour vous."
            : "Share this code if a relative wants to pay a contribution on your behalf."
        }
      </p>
    </div>

    <p>
      ${
        lang === "fr"
          ? "Sur DIVA Asso, vous pouvez rejoindre des cotisations en toute confiance, suivre les cagnottes, effectuer vos paiements sécurisés par Mobile Money / Orange Money et télécharger vos reçus officiels."
          : "On DIVA Asso, you can join tontines safely, track pots, make secure Mobile Money / Orange Money payments, and download your official receipts."
      }
    </p>
  `;

  const userEmailHtml = renderBrandedEmailHtml({
    title: userSubject,
    bodyHtml: userBodyHtml,
    actionUrl: "/dashboard",
    actionLabel: lang === "fr" ? "Accéder à mon espace" : "Go to My Dashboard",
    lang,
    baseUrl,
  });

  await sendEmailSafe(params.email, userSubject, userEmailHtml);

  // 2. Notification in-app pour le nouvel utilisateur
  try {
    await prisma.notification.create({
      data: {
        userId: params.userId,
        channel: "IN_APP",
        type: "ADMIN_BROADCAST",
        message:
          lang === "fr"
            ? `Bienvenue sur DIVA Asso ! Votre matricule de membre est ${params.memberCode}.`
            : `Welcome to DIVA Asso! Your member code is ${params.memberCode}.`,
        actionUrl: "/dashboard",
        status: "SENT",
      },
    });
  } catch (err) {
    console.error("[welcome] user in-app notification failed:", err);
  }

  // 3. Notification aux administrateurs & présidents
  try {
    const admins = await prisma.user.findMany({
      where: { role: { in: ["ADMIN", "PRESIDENT"] } },
      select: { id: true, email: true, name: true, preferredLang: true },
    });

    if (admins.length > 0) {
      const adminTitle = `Nouveau membre inscrit : ${params.name}`;
      const adminMessage = `Un nouveau membre s'est inscrit sur DIVA Asso : ${params.name} (${params.email}) — Matricule : ${params.memberCode}.`;

      // In-app pour chaque admin
      await prisma.notification.createMany({
        data: admins.map((a) => ({
          userId: a.id,
          channel: "IN_APP" as const,
          type: "ADMIN_BROADCAST" as const,
          message: adminMessage,
          actionUrl: "/admin/users",
          status: "SENT" as const,
        })),
      });

      // Email aux admins
      const adminEmailHtml = renderBrandedEmailHtml({
        title: "Nouveau membre inscrit sur la plateforme",
        bodyHtml: `
          <p>Bonjour,</p>
          <p>Un nouvel utilisateur vient de créer son compte sur DIVA Asso :</p>
          <ul style="padding-left: 20px; line-height: 1.8;">
            <li><strong>Nom :</strong> ${params.name}</li>
            <li><strong>Email :</strong> ${params.email}</li>
            <li><strong>Matricule généré :</strong> ${params.memberCode}</li>
            <li><strong>Date d'inscription :</strong> ${new Date().toLocaleString("fr-FR", { timeZone: "Africa/Douala" })}</li>
          </ul>
        `,
        actionUrl: "/admin/users",
        actionLabel: "Voir les membres (Admin)",
        lang: "fr",
        baseUrl,
      });

      await Promise.all(
        admins
          .filter((a) => Boolean(a.email))
          .map((a) => sendEmailSafe(a.email, adminTitle, adminEmailHtml)),
      );
    }
  } catch (adminNotifErr) {
    console.error("[welcome] admin alert failed:", adminNotifErr);
  }
}
