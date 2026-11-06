import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/constants";
import { extractClientInfo, logSecurityEvent } from "@/lib/security";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const { id: tontineSessionId } = await params;

  const tontineSession = await prisma.tontineSession.findUnique({
    where: { id: tontineSessionId },
    select: {
      id: true,
      title: true,
      type: true,
      status: true,
      amount: true,
      fee: true,
      startDate: true,
    },
  });

  if (!tontineSession) {
    return NextResponse.json({ error: "Cotisation introuvable" }, { status: 404 });
  }

  const isUserAdmin = isAdminRole(session.user.role);
  const membership = await prisma.membership.findFirst({
    where: {
      tontineSessionId,
      userId: session.user.id,
      status: "APPROVED",
    },
  });

  if (!membership && !isUserAdmin) {
    const { ip, userAgent } = extractClientInfo(request);
    await logSecurityEvent({
      type: "unauthorized_api_access",
      emailEssaye: session.user.email ?? null,
      ip,
      userAgent,
      details: {
        userId: session.user.id,
        targetSessionId: tontineSessionId,
        sessionStatus: tontineSession.status,
      },
    });

    return NextResponse.json(
      { error: "Accès refusé : vous ne faites pas partie de cette cotisation." },
      { status: 403 },
    );
  }

  return NextResponse.json({ session: tontineSession });
}
