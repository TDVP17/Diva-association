import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const otherId = new URL(request.url).searchParams.get("with");
  if (!otherId) {
    return NextResponse.json({ error: "Missing `with` query param" }, { status: 400 });
  }

  const [mine, theirs] = await Promise.all([
    prisma.membership.findMany({
      where: { userId: session.user.id, tontineSession: { status: { in: ["DRAWING", "ACTIVE"] } } },
      include: { tontineSession: true },
    }),
    prisma.membership.findMany({
      where: { userId: otherId, tontineSession: { status: { in: ["DRAWING", "ACTIVE"] } } },
    }),
  ]);

  const theirBySession = new Map(theirs.map((m) => [m.tontineSessionId, m]));

  const common = mine
    .filter((m) => theirBySession.has(m.tontineSessionId))
    .map((m) => {
      const theirMembership = theirBySession.get(m.tontineSessionId)!;
      return {
        tontineSessionId: m.tontineSessionId,
        tontineType: m.tontineSession.type,
        myPosition: m.officialPosition ?? m.ballDrawn,
        theirPosition: theirMembership.officialPosition ?? theirMembership.ballDrawn,
      };
    });

  return NextResponse.json({ sessions: common });
}
