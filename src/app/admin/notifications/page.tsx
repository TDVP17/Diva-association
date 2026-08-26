import { getLang } from "@/lib/i18n/get-lang";
import { AdminNotificationsClient } from "./admin-notifications-client";

export default async function AdminNotificationsPage() {
  const lang = await getLang();
  return <AdminNotificationsClient lang={lang} />;
}
