import { auth } from "@/auth";
import { ChatClient } from "./chat-client";

export default async function ChatPage() {
  const session = await auth();
  return <ChatClient currentUserId={session!.user.id} isAdmin={session!.user.role === "ADMIN"} />;
}
