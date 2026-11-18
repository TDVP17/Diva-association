import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { normalizeCameroonPhone } from "@/lib/fapshi";
import { detectMobileMoneyProvider } from "@/lib/mobile-money-provider";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";
import { sendEmailSafe } from "@/lib/email/resend";
import { renderBrandedEmailHtml } from "@/lib/email/template";

const MAX_SAVED_METHODS = 4;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawMethods = await prisma.savedPaymentMethod.findMany({
    where: { userId: session.user.id },
    select: {
      id: true,
      provider: true,
      label: true,
      phone: true,
      accountName: true,
      status: true,
      rejectionReason: true,
      verifiedAt: true,
      isDefault: true,
      createdAt: true,
    },
  });

  // Tri : MTN en priorité en premier, puis Orange (comme demandé : "Le premier numéro pris en compte est MTN")
  const methods = rawMethods.sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1;
    if (!a.isDefault && b.isDefault) return 1;
    if (a.provider === "MTN" && b.provider !== "MTN") return -1;
    if (a.provider !== "MTN" && b.provider === "MTN") return 1;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  return NextResponse.json({ methods });
}

const bodySchema = z.object({
  phone: z.string().min(1),
  accountName: z.string().trim().min(2, "Le nom du titulaire du compte est requis").max(100).optional(),
  label: z.string().trim().max(40).optional(),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Données invalides" }, { status: 400 });
  }

  const normalizedPhone = normalizeCameroonPhone(parsed.data.phone);
  if (!normalizedPhone) {
    return NextResponse.json(
      { error: "Veuillez entrer un numéro Mobile Money / Orange Money camerounais valide (9 chiffres)", errorKey: "invalidMobileMoneyPhone" },
      { status: 400 },
    );
  }

  const provider = detectMobileMoneyProvider(normalizedPhone);
  if (!provider) {
    return NextResponse.json(
      {
        error: "Ce numéro ne correspond ni à Orange Money ni à MTN Mobile Money",
        errorKey: "unrecognizedMobileMoneyProvider",
      },
      { status: 400 },
    );
  }

  try {
    const existingCount = await prisma.savedPaymentMethod.count({ where: { userId: session.user.id } });
    if (existingCount >= MAX_SAVED_METHODS) {
      return NextResponse.json(
        {
          error: `Vous pouvez enregistrer jusqu'à ${MAX_SAVED_METHODS} numéros de retrait`,
          errorKey: "savedPaymentMethodLimitReached",
          errorVars: { max: String(MAX_SAVED_METHODS) },
        },
        { status: 409 },
      );
    }

    const isFirst = existingCount === 0;
    const accountName = parsed.data.accountName || parsed.data.label || null;

    // Statut PENDING : doit obligatoirement être vérifié et validé par DIVA Asso avant utilisation pour retrait
    const method = await prisma.savedPaymentMethod.create({
      data: {
        userId: session.user.id,
        provider,
        phone: normalizedPhone,
        accountName,
        label: accountName,
        status: "PENDING",
        isDefault: isFirst,
      },
      select: {
        id: true,
        provider: true,
        label: true,
        phone: true,
        accountName: true,
        status: true,
        isDefault: true,
      },
    });

    // Notifier immédiatement tous les admins pour valider ou refuser ce numéro de retrait
    try {
      const admins = await prisma.user.findMany({
        where: { role: { in: ["ADMIN", "PRESIDENT"] }, isBanned: false },
        select: { id: true, email: true },
      });
      if (admins.length > 0) {
        const providerLabel = provider === "ORANGE" ? "Orange Money" : "MTN MoMo";
        const memberName = session.user.name || "Un membre";
        await scheduleInAppNotifications({
          type: "ADMIN_BROADCAST",
          recipients: admins.map((a) => ({
            userId: a.id,
            message: `Nouveau numéro de retrait à valider : ${memberName} a enregistré ${providerLabel} ${normalizedPhone} (${accountName || "sans nom"}).`,
            actionUrl: "/admin/disbursement-methods",
          })),
        }).catch(() => {});

        const subject = `DIVA Asso — Nouveau numéro de retrait à valider (${memberName})`;
        const bodyText = `Bonjour,\n\n${memberName} vient d'enregistrer un numéro de retrait ${providerLabel} (${normalizedPhone} — Titulaire : ${accountName || "Non renseigné"}).\n\nConnectez-vous à l'espace Admin pour vérifier et valider ou annuler ce numéro.`;
        const html = renderBrandedEmailHtml({
          title: subject,
          bodyText,
          actionUrl: "/admin/disbursement-methods",
          actionLabel: "Valider les numéros de retrait",
          lang: "fr",
        });
        await Promise.all(
          admins
            .filter((a) => Boolean(a.email))
            .map((a) => sendEmailSafe(a.email, subject, html)),
        );
      }
    } catch (notifErr) {
      console.error("[profile/payment-methods POST] admin notify error:", notifErr);
    }

    return NextResponse.json({ method });
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as { code?: string }).code === "P2002") {
      return NextResponse.json(
        { error: "Ce numéro de retrait est déjà enregistré sur votre compte", errorKey: "savedPaymentMethodDuplicate" },
        { status: 409 },
      );
    }
    console.error("[profile/payment-methods POST] unexpected error:", err);
    return NextResponse.json({ error: "Impossible d'enregistrer ce numéro de retrait" }, { status: 500 });
  }
}
