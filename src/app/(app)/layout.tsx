import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getLang } from "@/lib/i18n/get-lang";
import { TopAppBar } from "@/components/top-app-bar";
import { BackBar } from "@/components/back-bar";
import { BottomNav } from "@/components/bottom-nav";
import { MemberSidebar } from "@/components/member-sidebar";
import { IosInstallBanner } from "@/components/ios-install-banner";
import { InstallPromptModal } from "@/components/install-prompt-modal";
import { TutorialPopup } from "@/components/tutorial-popup";
import { NotificationBadgeSync } from "@/components/notification-badge-sync";
import { PushPermissionPrompt } from "@/components/push-permission-prompt";
import { OfflineDraftSync } from "@/components/offline-draft-sync";
import { isAdminRole } from "@/lib/constants";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // Admin is the platform manager/owner, never a member — always sent to
  // its own dedicated dashboard/support/settings instead. Safe to enforce
  // now that those all exist under /admin (see src/app/admin/support,
  // src/app/admin/settings) — previously left open because admin had no
  // equivalent to reach for chat/profile.
  if (isAdminRole(session.user.role)) redirect("/admin");
  const lang = await getLang();

  // session.user.image is Auth.js's own OAuth-profile-picture field, set
  // once at login and never updated — the avatar-upload feature writes to
  // the User.avatar column instead, which the JWT/session never reads. A
  // fresh DB read here (this layout re-runs every request) shows the
  // current photo immediately after upload, with no session refresh needed.
  const dbUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { avatar: true, image: true },
  });

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <TopAppBar
        userId={session.user.id}
        userName={session.user.name ?? "Member"}
        userImage={dbUser?.avatar ?? dbUser?.image ?? null}
        lang={lang}
      />
      <MemberSidebar lang={lang} />
      <div className="flex-1 pb-24 md:pb-8 md:pl-60">
        <BackBar lang={lang} area="member" />
        {children}
      </div>
      <BottomNav lang={lang} />
      <IosInstallBanner lang={lang} />
      <InstallPromptModal lang={lang} />
      <TutorialPopup lang={lang} />
      <PushPermissionPrompt lang={lang} />
      <OfflineDraftSync lang={lang} />
      <NotificationBadgeSync />
    </div>
  );
}
