import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getLang } from "@/lib/i18n/get-lang";
import { PrivateTontinesClient, type PrivateTontineItem } from "./private-tontines-client";

export default async function PrivateTontinesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const lang = await getLang();

  const tontines = await prisma.tontineSession.findMany({
    where: {
      isPrivate: true,
      OR: [
        { creatorId: userId },
        { memberships: { some: { userId } } },
      ],
    },
    include: {
      creator: { select: { id: true, name: true } },
      memberships: {
        include: {
          user: { select: { id: true, name: true, phone: true } },
          slots: { orderBy: { officialPosition: "asc" } },
        },
        orderBy: { joinedAt: "asc" },
      },
    },
    orderBy: { startDate: "desc" },
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://divaasso.com";

  const initialTontines: PrivateTontineItem[] = tontines.map((t) => ({
    id: t.id,
    title: t.title || "Cotisation Privée",
    description: t.description,
    type: t.type,
    amount: Number(t.amount),
    fee: Number(t.fee),
    status: t.status,
    startDate: t.startDate.toISOString(),
    limitTime: t.limitTime,
    maxSlots: t.maxSlots ? Number(t.maxSlots) : null,
    inviteToken: t.inviteToken,
    inviteUrl: t.inviteToken ? `${baseUrl}/join/${t.inviteToken}` : null,
    isCreator: t.creatorId === userId,
    creatorName: t.creator?.name ?? "DIVA Asso",
    pendingCount: t.memberships.filter((m) => m.status === "PENDING").length,
    approvedCount: t.memberships.filter((m) => m.status === "APPROVED").length,
    memberships: t.memberships.map((m) => ({
      id: m.id,
      userId: m.userId,
      userName: m.user.name,
      userPhone: m.user.phone,
      status: m.status,
      slotCount: m.slotCount,
      joinedAt: m.joinedAt.toISOString(),
      slots: m.slots.map((s) => ({
        id: s.id,
        beneficiaryName: s.beneficiaryName,
        officialPosition: s.officialPosition,
        ballDrawn: s.ballDrawn,
      })),
    })),
  }));

  return <PrivateTontinesClient lang={lang} initialTontines={initialTontines} />;
}

