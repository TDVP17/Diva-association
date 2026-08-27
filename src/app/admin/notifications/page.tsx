import { getLang, getTranslator } from "@/lib/i18n/get-lang";
import { NotificationsClient } from "@/app/(app)/notifications/notifications-client";
import { AdminNotificationsClient } from "./admin-notifications-client";

export default async function AdminNotificationsPage() {
  const lang = await getLang();
  const t = getTranslator(lang);

  return (
    <div className="flex flex-col">
      <section className="px-container-padding pt-stack-gap-lg max-w-4xl mx-auto w-full">
        <h2 className="font-title-md text-title-md text-primary mb-stack-gap-md">{t("myNotificationsNav")}</h2>
        <NotificationsClient lang={lang} />
      </section>
      <AdminNotificationsClient lang={lang} />
    </div>
  );
}
