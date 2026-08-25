import { auth } from "@/auth";
import { getLang } from "@/lib/i18n/get-lang";
import { ChatClient } from "./chat-client";

export default async function ChatPage() {
  const session = await auth();
  const lang = await getLang();
  return <ChatClient currentUserId={session!.user.id} isAdmin={session!.user.role === "ADMIN"} lang={lang} />;
}
