import "dotenv/config";

async function main() {
  const { prisma } = await import("../src/lib/prisma");
  const { sendEmailSafe } = await import("../src/lib/email/resend");
  const { renderBrandedEmailHtml } = await import("../src/lib/email/template");

  console.log("=== NOTIFY USERS WITHOUT WHATSAPP NUMBER ===");

  const recipientsToNotify = await prisma.user.findMany({
    where: {
      isBanned: false,
      OR: [{ phone: null }, { phone: "" }],
    },
    select: {
      id: true,
      name: true,
      email: true,
      preferredLang: true,
    },
    orderBy: { createdAt: "desc" },
  });

  console.log(`Found ${recipientsToNotify.length} member(s) without a registered WhatsApp number.`);

  if (recipientsToNotify.length === 0) {
    console.log("No members need notification.");
    await prisma.$disconnect();
    return;
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "https://www.divaasso.com";
  let successCount = 0;

  for (let i = 0; i < recipientsToNotify.length; i++) {
    const user = recipientsToNotify[i];
    const isEn = user.preferredLang === "en";

    const title = isEn
      ? "Action Required: Register your WhatsApp number on DIVA Asso"
      : "Action requise : Enregistrez votre numéro WhatsApp sur DIVA Asso";

    const bodyText = isEn
      ? `You have not registered your WhatsApp phone number on your DIVA Asso account yet.\n\nAdding your WhatsApp number is essential for receiving contribution reminders, turn alerts, and securing your payouts.\n\nPlease visit your profile to add your number now. A 6-digit confirmation code will be sent to your email address (${user.email}) to verify that this number is yours.`
      : `Vous n'avez pas encore renseigné votre numéro WhatsApp sur votre compte DIVA Asso.\n\nL'enregistrement de votre numéro WhatsApp est indispensable pour recevoir vos alertes de cotisations, vos notifications de tour et sécuriser vos versements.\n\nRendez-vous dans votre profil pour ajouter votre numéro dès maintenant. Un code de sécurité unique à 6 chiffres vous sera envoyé à votre adresse e-mail (${user.email}) afin de confirmer que ce numéro vous appartient bien.`;

    const emailHtml = renderBrandedEmailHtml({
      title,
      bodyText,
      actionUrl: "/profile",
      actionLabel: isEn ? "Add my WhatsApp number" : "Ajouter mon numéro WhatsApp",
      lang: isEn ? "en" : "fr",
      baseUrl,
      recipientName: user.name,
    });

    console.log(`[${i + 1}/${recipientsToNotify.length}] Sending email to ${user.name} <${user.email}>...`);
    try {
      await sendEmailSafe(user.email, title, emailHtml);
      successCount++;
    } catch (err) {
      console.error(`Failed to send email to ${user.email}:`, err);
    }

    // Rate-limit safety: 200ms pause between emails to comfortably stay under Resend's 10 req/s limit
    if (i + 1 < recipientsToNotify.length) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  console.log(`\n🎉 Completed! Successfully sent notification emails to ${successCount}/${recipientsToNotify.length} members.`);

  // Also verify In-App notifications exist
  const inAppCount = await prisma.notification.count({
    where: {
      userId: { in: recipientsToNotify.map((u) => u.id) },
      type: "ADMIN_BROADCAST",
      channel: "IN_APP",
    },
  });
  console.log(`In-App notification rows present in database: ${inAppCount}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("❌ Fatal error notifying users:", err);
  process.exit(1);
});
