import nodemailer from "nodemailer";

/**
 * Transporter Nodemailer configuré avec le relais SMTP Brevo (anciennement Sendinblue).
 * 
 * Pourquoi les emails iCloud échouent avec Gmail SMTP ou un domaine générique :
 * Apple Mail / iCloud exige un alignement SPF, DKIM et DMARC strict sur le domaine
 * expéditeur (Return-Path et header From). L'utilisation de smtp-relay.brevo.com avec
 * une adresse professionnelle authentifiée (contact@mondomaine.com) garantit la
 * réception directe en boîte de réception sans rejet silencieux.
 */
export const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp-relay.brevo.com",
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false, // true pour le port 465, false pour 587 (utilise STARTTLS)
  auth: {
    user: process.env.BREVO_USER,
    pass: process.env.BREVO_KEY,
  },
  tls: {
    rejectUnauthorized: true,
  },
});

/**
 * Adresse d'expédition obligatoire :
 * DOIT correspondre à un domaine vérifié dans Brevo (ex: contact@votredomaine.com).
 * NE JAMAIS utiliser @gmail.com, @firebaseapp.com ou une adresse non vérifiée,
 * sinon Apple iCloud rejette systématiquement le message (politique DMARC).
 */
const DEFAULT_FROM = process.env.MAIL_FROM || "contact@mondomaine.com";

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
}

/**
 * Envoie un email général via le relais Brevo.
 */
export async function sendEmail({ to, subject, html, text, from }: SendEmailOptions) {
  const mailOptions = {
    from: from || DEFAULT_FROM,
    to,
    subject,
    text: text || html.replace(/<[^>]+>/g, " "),
    html,
    headers: {
      "X-Mailer": "NodeMailer / Brevo Relay",
      "X-Entity-Ref-ID": `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    },
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    return { success: true, messageId: info.messageId };
  } catch (error: any) {
    console.error("[Mailer] Erreur lors de l'envoi vers", to, ":", error);
    return { success: false, error: error?.message || "Erreur SMTP inconnue" };
  }
}

/**
 * Envoie un code de vérification / connexion à 6 chiffres.
 * Formaté de manière responsive et conforme aux filtres anti-spam d'iCloud et Gmail.
 *
 * @param to - Adresse email du destinataire (supporte @icloud.com et @privaterelay.appleid.com)
 * @param code - Le code numérique ou alphanumérique de vérification
 */
export async function sendCode(to: string, code: string) {
  const subject = `Votre code de vérification : ${code}`;

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
    .card { max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; padding: 32px 24px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
    .header { text-align: center; margin-bottom: 24px; }
    .title { font-size: 20px; font-weight: 700; color: #0f172a; margin: 0 0 8px 0; }
    .subtitle { font-size: 14px; color: #64748b; margin: 0; }
    .code-box { background: #f1f5f9; border: 2px dashed #cbd5e1; border-radius: 12px; padding: 20px; text-align: center; margin: 28px 0; }
    .code { font-family: 'SF Mono', Monaco, Menlo, Consolas, monospace; font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #0284c7; }
    .footer { text-align: center; font-size: 12px; color: #94a3b8; margin-top: 32px; line-height: 1.5; }
    .warning { font-size: 13px; color: #64748b; background: #fffbeb; border-left: 4px solid #f59e0b; padding: 12px; border-radius: 6px; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1 class="title">Code de vérification</h1>
      <p class="subtitle">Utilisez le code ci-dessous pour confirmer votre identité.</p>
    </div>

    <div class="code-box">
      <div class="code">${code}</div>
    </div>

    <div class="warning">
      Ce code est confidentiel et expire dans <strong>10 minutes</strong>. Ne le partagez avec personne.
    </div>

    <div class="footer">
      Si vous n'êtes pas à l'origine de cette demande, vous pouvez ignorer cet email en toute sécurité.<br>
      © ${new Date().getFullYear()} Tous droits réservés.
    </div>
  </div>
</body>
</html>
  `.trim();

  const text = `Votre code de vérification est : ${code}\nCe code expire dans 10 minutes. Ne le communiquez à personne.`;

  return sendEmail({ to, subject, html, text });
}
