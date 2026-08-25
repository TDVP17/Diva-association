import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getLang } from "@/lib/i18n/get-lang";
import { TopAppBar } from "@/components/top-app-bar";
import { BottomNav } from "@/components/bottom-nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const lang = await getLang();

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <TopAppBar userName={session.user.name ?? "Member"} userImage={session.user.image ?? null} lang={lang} />
      <div className="flex-1 pb-24 md:pb-8">{children}</div>
      <BottomNav />
    </div>
  );
}
