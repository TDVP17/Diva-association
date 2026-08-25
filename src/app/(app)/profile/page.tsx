import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getContributionTotal, getNextDueDate } from "@/lib/tontine-engine";
import { getLang, getTranslator } from "@/lib/i18n/get-lang";
import { ProfileForm } from "./profile-form";
import { ChangePasswordForm } from "./change-password-form";
import { AvatarUpload } from "./avatar-upload";

const TONTINE_LABELS: Record<string, string> = {
  HEBDO_SUNDAY: "Weekly Tontine (Sunday)",
  MONTHLY_28: "Monthly Tontine (28th)",
  MONTHLY_25: "Monthly Tontine (25th)",
};

const MEMBERSHIP_STATUS_CLASS: Record<string, string> = {
  PENDING: "bg-secondary-fixed text-on-secondary-fixed-variant",
  APPROVED: "bg-[#d1fae5] text-[#065f46]",
  REJECTED: "bg-error-container text-on-error-container",
};

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const t = getTranslator(await getLang());
  const MEMBERSHIP_STATUS_LABEL: Record<string, string> = {
    PENDING: t("membershipStatusPending"),
    APPROVED: t("membershipStatusApproved"),
    REJECTED: t("membershipStatusRejected"),
  };

  const [user, memberships] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        name: true,
        email: true,
        avatar: true,
        image: true,
        phone: true,
        city: true,
        neighborhood: true,
        sponsorCode: true,
        role: true,
      },
    }),
    prisma.membership.findMany({
      where: { userId: session.user.id },
      include: { tontineSession: true, slots: true },
      orderBy: { joinedAt: "desc" },
    }),
  ]);

  if (!user) {
    return (
      <main className="px-container-padding py-stack-gap-lg max-w-md mx-auto text-center">
        <p className="font-body-md text-body-md text-on-surface-variant mb-stack-gap-md">
          {t("couldNotFindProfile")}
        </p>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button
            type="submit"
            className="py-2 px-4 rounded-lg border-2 border-error text-error font-label-md text-label-md hover:bg-error/5"
          >
            {t("signOut")}
          </button>
        </form>
      </main>
    );
  }

  const now = new Date();
  const approvedActiveMemberships = memberships.filter(
    (m) => m.status === "APPROVED" && m.tontineSession.status === "ACTIVE",
  );
  const allMySlotIds = approvedActiveMemberships.flatMap((m) => m.slots.map((s) => s.id));
  const contributions = allMySlotIds.length
    ? await prisma.contribution.findMany({ where: { membershipSlotId: { in: allMySlotIds } } })
    : [];
  const contributionBySlotCycle = new Map(
    contributions.map((c) => [`${c.membershipSlotId}:${c.dueDate.toISOString()}`, c]),
  );

  const rows: Array<[string, string]> = [
    [t("emailLabel"), user.email],
    [t("phoneLabel"), user.phone ?? t("notSet")],
    [t("sponsorCodeLabel"), user.sponsorCode ?? t("notSet")],
    [t("roleLabel"), user.role],
  ];

  return (
    <main className="px-container-padding py-stack-gap-lg max-w-md mx-auto">
      <div className="flex flex-col items-center mb-stack-gap-lg">
        <AvatarUpload currentAvatarUrl={user.avatar ?? user.image} userName={user.name} />
        <h1 className="font-title-md text-title-md text-primary mt-3">{user.name}</h1>
      </div>

      <div className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant overflow-hidden mb-stack-gap-lg">
        {rows.map(([label, value], i) => (
          <div
            key={label}
            className={`flex justify-between items-center px-4 py-3 ${i < rows.length - 1 ? "border-b border-surface-variant" : ""}`}
          >
            <span className="font-label-sm text-label-sm text-on-surface-variant">{label}</span>
            <span className="font-label-md text-label-md text-on-surface">{value}</span>
          </div>
        ))}
      </div>

      <section className="mb-stack-gap-lg">
        <h2 className="font-title-md text-title-md text-on-surface mb-stack-gap-md px-1">
          {t("yourCotisations")}
        </h2>
        {memberships.length === 0 ? (
          <div className="bg-white rounded-xl p-4 shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant text-center">
            <p className="font-label-sm text-label-sm text-on-surface-variant">
              {t("noTontineYet")}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-stack-gap-sm">
            {memberships.map((m) => {
              const label = m.tontineSession.title || TONTINE_LABELS[m.tontineSession.type] || m.tontineSession.type;
              let summary: string | null = null;
              if (m.status === "APPROVED" && m.tontineSession.status === "ACTIVE" && m.slots.length > 0) {
                const dueDate = getNextDueDate(m.tontineSession.type, now);
                const { total } = getContributionTotal({
                  amount: Number(m.tontineSession.amount),
                  fee: Number(m.tontineSession.fee),
                });
                const paidSlots = m.slots.filter(
                  (s) => contributionBySlotCycle.get(`${s.id}:${dueDate.toISOString()}`)?.status === "PAID",
                ).length;
                summary =
                  paidSlots === m.slots.length
                    ? t("allSlotsPaidThisCycle")
                    : t("slotsPaidSummary", {
                        paid: String(paidSlots),
                        total: String(m.slots.length),
                        amount: total.toLocaleString("en-US"),
                      });
              } else if (m.status === "APPROVED" && m.slotCount === null) {
                summary = t("selectSlotsToStart");
              }
              return (
                <div
                  key={m.id}
                  className="bg-white rounded-xl p-4 shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant flex items-center justify-between"
                >
                  <div>
                    <p className="font-label-md text-label-md text-on-surface">{label}</p>
                    {summary && (
                      <p className="font-label-sm text-label-sm text-on-surface-variant mt-0.5">{summary}</p>
                    )}
                  </div>
                  <span
                    className={`inline-flex items-center px-2 py-1 rounded-md font-label-sm text-label-sm ${MEMBERSHIP_STATUS_CLASS[m.status]}`}
                  >
                    {MEMBERSHIP_STATUS_LABEL[m.status]}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="mb-stack-gap-lg">
        <h2 className="font-title-md text-title-md text-on-surface mb-stack-gap-md px-1">{t("editProfile")}</h2>
        <ProfileForm phone={user.phone} city={user.city} neighborhood={user.neighborhood} />
      </section>

      <section className="mb-stack-gap-lg">
        <h2 className="font-title-md text-title-md text-on-surface mb-stack-gap-md px-1">{t("changePassword")}</h2>
        <ChangePasswordForm />
      </section>

      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/login" });
        }}
      >
        <button
          type="submit"
          className="w-full py-3 rounded-lg border-2 border-error text-error font-label-md text-label-md hover:bg-error/5 active:scale-95 transition-all"
        >
          {t("signOut")}
        </button>
      </form>
    </main>
  );
}
