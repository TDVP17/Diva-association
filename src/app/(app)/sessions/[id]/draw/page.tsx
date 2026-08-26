import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getLang, getTranslator } from "@/lib/i18n/get-lang";
import { DrawBowl } from "./draw-bowl";

export default async function DrawPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const userId = session!.user.id;
  const lang = await getLang();
  const t = getTranslator(lang);

  const tontineSession = await prisma.tontineSession.findUnique({
    where: { id },
    include: {
      memberships: {
        where: { status: "APPROVED" },
        select: {
          userId: true,
          slots: { select: { id: true, beneficiaryName: true, ballDrawn: true, officialPosition: true } },
        },
      },
    },
  });
  if (!tontineSession) notFound();

  const myMembership = tontineSession.memberships.find((m) => m.userId === userId);
  if (!myMembership) notFound();

  const allSlots = tontineSession.memberships.flatMap((m) => m.slots);
  const myDrawnSlots = myMembership.slots.filter((s) => s.ballDrawn !== null);
  const myUndrawnCount = myMembership.slots.length - myDrawnSlots.length;
  const myUndrawnSlots = myMembership.slots.filter((s) => s.ballDrawn === null);
  const positionsNotYetAssigned = myUndrawnSlots.some((s) => s.officialPosition === null);
  const sessionOpenForDrawing = tontineSession.status === "DRAWING" || tontineSession.status === "ACTIVE";

  return (
    <main className="flex-grow flex flex-col items-center justify-center p-container-padding pb-32 min-h-[calc(100vh-64px)]">
      <div className="text-center mb-stack-gap-lg max-w-md">
        <h2 className="font-title-md text-title-md text-primary mb-2">{t("cycleDraw")}</h2>
        <p className="font-body-md text-on-surface-variant">{t("cycleDrawBody")}</p>
      </div>

      {myUndrawnCount === 0 ? (
        <div className="flex flex-wrap justify-center gap-3 mb-stack-gap-lg">
          {myMembership.slots.map((s) => (
            <div key={s.id} className="flex flex-col items-center">
              <div className="w-24 h-24 rounded-full bg-white flex items-center justify-center font-numeric-data text-[40px] text-primary shadow-[inset_-5px_-5px_15px_rgba(0,0,0,0.2),inset_5px_5px_15px_rgba(255,255,255,0.8),0_10px_20px_rgba(0,53,40,0.2)]">
                {s.ballDrawn}
              </div>
              <p className="font-label-sm text-label-sm text-on-surface-variant mt-2">{s.beneficiaryName}</p>
            </div>
          ))}
        </div>
      ) : !sessionOpenForDrawing ? (
        <p className="font-body-md text-body-md text-on-surface-variant">{t("drawingNotOpen")}</p>
      ) : positionsNotYetAssigned ? (
        <p className="font-body-md text-body-md text-on-surface-variant">{t("positionsNotYetAssigned")}</p>
      ) : (
        <DrawBowl tontineSessionId={id} totalSlots={allSlots.length} lang={lang} />
      )}
    </main>
  );
}
