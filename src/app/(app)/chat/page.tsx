import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getLang } from "@/lib/i18n/get-lang";
import { isAdminRole } from "@/lib/constants";
import { ChatClient } from "./chat-client";

export default async function ChatPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const lang = await getLang();
  return <ChatClient currentUserId={session.user.id} isAdmin={isAdminRole(session.user.role)} lang={lang} />;
}
