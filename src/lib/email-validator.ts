import dns from "dns";
import type { Lang } from "@/lib/i18n/translations";

// Configure fast reliable DNS resolvers for MX validation
try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch {
  // Use system default if setServers is restricted
}

const DISPOSABLE_DOMAINS = new Set([
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
  "mailinator.com",
  "tempmail.com",
  "temp-mail.org",
  "10minutemail.com",
  "guerrillamail.com",
  "sharklasers.com",
  "trashmail.com",
  "dispostable.com",
  "getairmail.com",
  "throwawaymail.com",
]);

const COMMON_TYPOS: Record<string, string> = {
  "gmai.com": "gmail.com",
  "gmial.com": "gmail.com",
  "gamil.com": "gmail.com",
  "gmaill.com": "gmail.com",
  "gnail.com": "gmail.com",
  "yaho.com": "yahoo.com",
  "yahooo.com": "yahoo.com",
  "yaho.fr": "yahoo.fr",
  "hotmial.com": "hotmail.com",
  "hotmaill.com": "hotmail.com",
  "outlok.com": "outlook.com",
  "outloo.com": "outlook.com",
};

export interface EmailValidationResult {
  valid: boolean;
  error?: string;
  normalizedEmail?: string;
}

/**
 * Validates that an email address is syntactically valid, not disposable,
 * has no obvious typo, and belongs to a real domain with active mail servers (MX).
 */
export async function validateEmailAddress(
  rawEmail: string,
  lang: Lang = "fr",
): Promise<EmailValidationResult> {
  const email = rawEmail.trim().toLowerCase();

  if (!email) {
    return {
      valid: false,
      error: lang === "fr" ? "Veuillez entrer une adresse e-mail." : "Please enter an email address.",
    };
  }

  // 1. Strict RFC 5322 standard email regex
  const emailRegex =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

  if (!emailRegex.test(email)) {
    return {
      valid: false,
      error:
        lang === "fr"
          ? "Le format de l'adresse e-mail est invalide."
          : "Invalid email address format.",
    };
  }

  const [, domain] = email.split("@");
  if (!domain || !domain.includes(".")) {
    return {
      valid: false,
      error:
        lang === "fr"
          ? "Le nom de domaine de l'e-mail est incomplet."
          : "Incomplete email domain name.",
    };
  }

  // 2. Reject disposable / temporary email addresses
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return {
      valid: false,
      error:
        lang === "fr"
          ? "Les adresses e-mails temporaires ou jetables ne sont pas autorisées."
          : "Temporary or disposable email addresses are not allowed.",
    };
  }

  // 3. Typo detection
  if (COMMON_TYPOS[domain]) {
    const suggested = COMMON_TYPOS[domain];
    return {
      valid: false,
      error:
        lang === "fr"
          ? `Vérifiez l'adresse : vouliez-vous écrire @${suggested} au lieu de @${domain} ?`
          : `Did you mean @${suggested} instead of @${domain}?`,
    };
  }

  // 4. Real domain MX / DNS check
  try {
    const mxRecords = await Promise.race([
      dns.promises.resolveMx(domain),
      new Promise<dns.MxRecord[]>((_, reject) =>
        setTimeout(() => reject(new Error("DNS_TIMEOUT")), 3000),
      ),
    ]);

    if (!mxRecords || mxRecords.length === 0) {
      // Fallback: check if the domain resolves to an A record
      const aRecords = await dns.promises.resolve4(domain).catch(() => []);
      if (aRecords.length === 0) {
        return {
          valid: false,
          error:
            lang === "fr"
              ? `Le domaine @${domain} n'existe pas ou ne possède aucun serveur de messagerie.`
              : `The domain @${domain} does not exist or has no active mail server.`,
        };
      }
    }
  } catch (err: any) {
    if (err?.code === "ENOTFOUND" || err?.code === "ENODATA") {
      return {
        valid: false,
        error:
          lang === "fr"
            ? `Le domaine @${domain} n'existe pas. Veuillez vérifier l'orthographe de votre e-mail.`
            : `The domain @${domain} does not exist. Please check your email spelling.`,
      };
    }
    // In case of network timeout or unexpected error, don't hard-block valid users
  }

  return { valid: true, normalizedEmail: email };
}
