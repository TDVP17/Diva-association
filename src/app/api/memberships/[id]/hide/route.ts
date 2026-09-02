import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/** Lets a member dismiss one of their own CLOSED cotisations from /sessions — a display preference only, never touches contribution/payout history. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const membership = await prisma.membership.findUnique({
    where: { id },
    include: { tontineSession: { select: { status: true } } },
  });
  if (!membership || membership.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (membership.tontineSession.status !== "CLOSED") {
    return NextResponse.json({ error: "This cotisation isn't closed yet" }, { status: 409 });
  }

  await prisma.membership.update({ where: { id }, data: { hiddenByMemberAt: new Date() } });
  return NextResponse.json({ ok: true });
}
