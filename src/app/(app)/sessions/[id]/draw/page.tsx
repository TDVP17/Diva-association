import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { DrawBowl } from "./draw-bowl";

export default async function DrawPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = session!.user.id;

  const tontineSession = await prisma.tontineSession.findUnique({
    where: { id },
    include: { memberships: { select: { userId: true, status: true, ballDrawn: true } } },
  });
  if (!tontineSession) notFound();

  const myMembership = tontineSession.memberships.find((m) => m.userId === userId);
  if (!myMembership || myMembership.status !== "APPROVED") notFound();

  const approvedMemberships = tontineSession.memberships.filter((m) => m.status === "APPROVED");

  return (
    <main className="flex-grow flex flex-col items-center justify-center p-container-padding pb-32 min-h-[calc(100vh-64px)]">
      <div className="text-center mb-stack-gap-lg max-w-md">
        <h2 className="font-title-md text-title-md text-primary mb-2">Cycle Draw</h2>
        <p className="font-body-md text-on-surface-variant">
          It&rsquo;s time to determine the order for this cycle. The process is transparent and
          random.
        </p>
      </div>

      {myMembership.ballDrawn !== null ? (
        <div className="w-24 h-24 rounded-full bg-white flex items-center justify-center font-numeric-data text-[48px] text-primary mb-stack-gap-lg shadow-[inset_-5px_-5px_15px_rgba(0,0,0,0.2),inset_5px_5px_15px_rgba(255,255,255,0.8),0_10px_20px_rgba(0,53,40,0.2)]">
          {myMembership.ballDrawn}
        </div>
      ) : tontineSession.status !== "DRAWING" ? (
        <p className="font-body-md text-body-md text-on-surface-variant">
          Drawing is not currently open for this session.
        </p>
      ) : (
        <DrawBowl tontineSessionId={id} totalMembers={approvedMemberships.length} />
      )}
    </main>
  );
}
