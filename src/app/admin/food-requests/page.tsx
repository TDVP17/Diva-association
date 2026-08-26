import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getLang } from "@/lib/i18n/get-lang";
import { isAdminRole } from "@/lib/constants";
import { FoodRequestsClient } from "./food-requests-client";

export default async function AdminFoodRequestsPage() {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) redirect("/dashboard");
  const lang = await getLang();

  return <FoodRequestsClient lang={lang} />;
}
