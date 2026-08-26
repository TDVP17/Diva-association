import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getLang, getTranslator } from "@/lib/i18n/get-lang";
import { AvatarUpload } from "@/app/(app)/profile/avatar-upload";
import { InlineField } from "@/app/(app)/profile/inline-field";
import { InlinePasswordField } from "@/app/(app)/profile/inline-password-field";
import { updatePhoneAction, updateEmailAction } from "@/app/(app)/profile/actions";

export default async function AdminSettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const lang = await getLang();
  const t = getTranslator(lang);

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, email: true, avatar: true, image: true, phone: true, role: true },
  });
  if (!user) redirect("/login");

  return (
    <main className="px-container-padding pt-stack-gap-lg pb-32 max-w-md mx-auto w-full">
      <div className="flex flex-col items-center mb-stack-gap-lg">
        <AvatarUpload currentAvatarUrl={user.avatar ?? user.image} userName={user.name} lang={lang} />
        <h1 className="font-title-md text-title-md text-primary mt-3">{user.name}</h1>
      </div>

      <div className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant overflow-hidden mb-stack-gap-lg">
        <InlineField
          label={t("emailLabel")}
          currentValue={user.email}
          fieldName="email"
          purpose="EMAIL_CHANGE"
          action={updateEmailAction}
          lang={lang}
          inputType="email"
        />
        <InlineField
          label={t("phoneLabel")}
          currentValue={user.phone ?? ""}
          fieldName="phone"
          purpose="PHONE_CHANGE"
          action={updatePhoneAction}
          lang={lang}
          inputType="tel"
        />
        <div className="flex justify-between items-center px-4 py-3 border-t border-surface-variant">
          <span className="font-label-sm text-label-sm text-on-surface-variant">{t("roleLabel")}</span>
          <span className="font-label-md text-label-md text-on-surface">{user.role}</span>
        </div>
      </div>

      <section className="mb-stack-gap-lg">
        <InlinePasswordField lang={lang} />
      </section>
    </main>
  );
}
