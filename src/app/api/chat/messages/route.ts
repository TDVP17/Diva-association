import { NextResponse } from "next/server";
import { z } from "zod";
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

  const myId = session.user.id;

  const [messages, swapRequests] = await Promise.all([
    prisma.chatMessage.findMany({
      where: {
        OR: [
          { senderId: myId, receiverId: otherId },
          { senderId: otherId, receiverId: myId },
        ],
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.positionSwapRequest.findMany({
      where: {
        OR: [
          { requesterId: myId, targetId: otherId },
          { requesterId: otherId, targetId: myId },
        ],
      },
      include: { tontineSession: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const feed = [
    ...messages.map((m) => ({
      kind: "message" as const,
      id: m.id,
      senderId: m.senderId,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    })),
    ...swapRequests.map((r) => ({
      kind: "swap_request" as const,
      id: r.id,
      requesterId: r.requesterId,
      targetId: r.targetId,
      status: r.status,
      tontineType: r.tontineSession.type,
      createdAt: r.createdAt.toISOString(),
    })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return NextResponse.json({ feed });
}

const sendSchema = z.object({
  receiverId: z.string().min(1),
  content: z.string().trim().min(1).max(2000),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = sendSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const receiver = await prisma.user.findUnique({ where: { id: parsed.data.receiverId } });
  if (!receiver) {
    return NextResponse.json({ error: "Recipient not found" }, { status: 404 });
  }

  const message = await prisma.chatMessage.create({
    data: {
      senderId: session.user.id,
      receiverId: parsed.data.receiverId,
      content: parsed.data.content,
    },
  });

  return NextResponse.json({
    kind: "message" as const,
    id: message.id,
    senderId: message.senderId,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
  });
}
