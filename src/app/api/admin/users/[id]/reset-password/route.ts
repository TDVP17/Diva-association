import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { getSupabaseAdminClient } from "@/lib/supabase-auth";
import { renderBrandedEmailHtml } from "@/lib/email/template";
import { sendEmailSafe } from "@/lib/email/resend";
import { logAudit } from "@/lib/audit";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, phone: true, memberCode: true, preferredLang: true },
  });

  if (!user) {
    return NextResponse.json({ error: "Utilisateur non trouvé" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const mode = body?.mode || "temp_password"; // "temp_password" or "send_email"
  const lang = user.preferredLang === "en" ? "en" : "fr";
  const firstName = user.name.trim().split(/\s+/)[0] || user.name;

  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const { data: list, error: listError } = await supabaseAdmin.auth.admin.listUsers();

    if (listError || !list?.users) {
      return NextResponse.json(
        { error: "Impossible d'accéder au service d'authentification Supabase" },
        { status: 500 },
      );
    }

    const authUser = list.users.find(
      (u) => u.email?.toLowerCase() === user.email.toLowerCase(),
    );

    if (!authUser) {
      return NextResponse.json(
        { error: "Cet utilisateur n'a pas de compte email/mot de passe (connecté via Google OAuth)" },
        { status: 400 },
      );
    }

    // Generate a secure temporary password
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const tempPassword = `Diva@${randomSuffix}!`;

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(authUser.id, {
      password: tempPassword,
    });

    if (updateError) {
      return NextResponse.json(
        { error: `Erreur lors de la réinitialisation : ${updateError.message}` },
        { status: 500 },
      );
    }

    // Send email to user with their new temporary credentials
    const subject =
      lang === "fr"
        ? "DIVA Asso — Vos nouveaux identifiants de connexion"
        : "DIVA Asso — Your new connection credentials";

    const emailHtml = renderBrandedEmailHtml({
      title: subject,
      bodyHtml: `
        <p style="margin-top: 0;">${lang === "fr" ? `Salut <strong>${firstName}</strong> 👋,` : `Hello <strong>${firstName}</strong> 👋,`}</p>
        <p>
          ${
            lang === "fr"
              ? "L'administrateur de DIVA Asso a réinitialisé votre mot de passe pour vous aider à vous reconnecter à votre compte :"
              : "The DIVA Asso administrator has reset your password to help you reconnect to your account:"
          }
        </p>
        <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 18px; margin: 20px 0;">
          <p style="margin: 0 0 6px 0; font-size: 13px; color: #166534; font-weight: 600;">
            ${lang === "fr" ? "Identifiant de connexion" : "Login Identifier"} :
          </p>
          <div style="font-size: 16px; font-weight: 700; color: #003528; margin-bottom: 12px;">
            ${user.email} ${user.phone ? `(ou téléphone: ${user.phone})` : ""}
          </div>
          <p style="margin: 0 0 6px 0; font-size: 13px; color: #166534; font-weight: 600;">
            ${lang === "fr" ? "Nouveau Mot de passe temporaire" : "Temporary Password"} :
          </p>
          <div style="font-size: 22px; font-weight: 800; color: #003528; letter-spacing: 1px;">
            ${tempPassword}
          </div>
        </div>
        <p style="font-size: 13px; color: #64748b;">
          ${
            lang === "fr"
              ? "👉 Nous vous recommandons de vous connecter et de changer ce mot de passe depuis votre page Profil."
              : "👉 We recommend that you log in and change this password from your Profile page."
          }
        </p>
      `,
      actionUrl: "/login",
      actionLabel: lang === "fr" ? "Se connecter maintenant" : "Sign In Now",
      lang,
      recipientName: user.name,
    });

    await sendEmailSafe(user.email, subject, emailHtml);

    await logAudit({
      actorId: admin.user.id,
      actorRole: admin.user.role,
      action: "admin_reset_user_password",
      targetType: "User",
      targetId: user.id,
      request,
      metadata: { targetUserEmail: user.email },
    });

    return NextResponse.json({
      ok: true,
      email: user.email,
      phone: user.phone,
      memberCode: user.memberCode,
      tempPassword,
      message:
        lang === "fr"
          ? `Mot de passe réinitialisé avec succès ! Un email a été envoyé à ${user.email}.`
          : `Password reset successfully! An email has been sent to ${user.email}.`,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Erreur inattendue";
    console.error("[admin reset-password] error:", err);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
