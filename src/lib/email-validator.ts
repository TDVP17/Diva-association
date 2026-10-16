import dns from "dns";
import type { Lang } from "@/lib/i18n/translations";



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
    let hasMailServer = false;

    try {
      const mxRecords = await Promise.race([
        dns.promises.resolveMx(domain),
        new Promise<dns.MxRecord[]>((_, reject) =>
          setTimeout(() => reject(new Error("DNS_TIMEOUT")), 2500),
        ),
      ]);
      if (mxRecords && mxRecords.length > 0) {
        hasMailServer = true;
      }
    } catch {
      // Fallback if MX query is restricted or timed out
    }

    if (!hasMailServer) {
      // Try resolving via system lookup (A / AAAA)
      try {
        await dns.promises.lookup(domain);
        hasMailServer = true;
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
  }

  return { valid: true, normalizedEmail: email };
}
