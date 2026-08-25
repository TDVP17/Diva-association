import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { TopAppBar } from "@/components/top-app-bar";
import { BottomNav } from "@/components/bottom-nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <TopAppBar
        userName={session.user.name ?? "Member"}
        userImage={session.user.image ?? null}
        accountApproved={session.user.accountStatus === "APPROVED"}
      />
      <div className="flex-1 pb-24 md:pb-8">{children}</div>
      <BottomNav />
    </div>
  );
}
