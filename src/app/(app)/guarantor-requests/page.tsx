import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getLang } from "@/lib/i18n/get-lang";
import { GuarantorRequestsClient, type GuarantorRequestItem } from "./guarantor-requests-client";

export default async function GuarantorRequestsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const lang = await getLang();

  const requests = await prisma.kycVerification.findMany({
    where: { referrerUserId: session.user.id },
    include: {
      user: { select: { id: true, name: true, avatar: true, image: true, city: true, neighborhood: true } },
      tontineSession: { select: { id: true, title: true, type: true, amount: true, fee: true } },
      membership: { select: { id: true, status: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const initialRequests: GuarantorRequestItem[] = requests.map((r) => ({
    id: r.id,
    guarantorStatus: r.guarantorStatus,
    guarantorAcceptedAt: r.guarantorAcceptedAt?.toISOString() ?? null,
    guarantorDeclinedAt: r.guarantorDeclinedAt?.toISOString() ?? null,
    guarantorDeclineReason: r.guarantorDeclineReason,
    createdAt: r.createdAt.toISOString(),
    applicant: {
      id: r.user.id,
      name: r.user.name,
      avatar: r.user.avatar || r.user.image || null,
      city: r.user.city,
      neighborhood: r.user.neighborhood,
    },
    tontineSession: {
      id: r.tontineSession.id,
      title: r.tontineSession.title || r.tontineSession.type,
      amount: Number(r.tontineSession.amount),
      fee: Number(r.tontineSession.fee),
    },
    membershipStatus: r.membership?.status ?? "PENDING",
  }));

  return <GuarantorRequestsClient lang={lang} initialRequests={initialRequests} />;
}

