import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getLang } from "@/lib/i18n/get-lang";
import { AdminDashboardClient } from "./admin-dashboard-client";

export default async function AdminPage() {
  const session = await auth();
  if (session?.user.role !== "ADMIN") redirect("/dashboard");
  const lang = await getLang();

  return <AdminDashboardClient lang={lang} />;
}
