import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AdminClient } from "./admin-client";

export default async function AdminPage() {
  const session = await auth();
  if (session?.user.role !== "ADMIN") redirect("/dashboard");

  return <AdminClient />;
}
