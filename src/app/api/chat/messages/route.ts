import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { translate } from "@/lib/i18n/translations";
import { isAdminRole } from "@/lib/constants";

const AUTO_REPLY_THROTTLE_MS = 30 * 24 * 60 * 60 * 1000;

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

  const messages = await prisma.chatMessage.findMany({
    where: {
      OR: [
        { senderId: myId, receiverId: otherId },
        { senderId: otherId, receiverId: myId },
      ],
    },
    orderBy: { createdAt: "asc" },
  });

  const feed = messages.map((m) => ({
    kind: "message" as const,
    id: m.id,
    senderId: m.senderId,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
  }));

  // Opening this thread marks every message the other person sent me as
  // read — powers the unread-messages badge in the top-right menu.
  await prisma.chatMessage.updateMany({
    where: { senderId: otherId, receiverId: myId, readAt: null },
    data: { readAt: new Date() },
  });

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

  // Messaging is admin-only: a non-admin sender may only ever message an
  // admin/president (the support thread). Peer-to-peer messages between two
  // regular members are rejected outright, regardless of what the UI
  // exposes — this used to be enforced only by which contacts the client
  // happened to show.
  if (!isAdminRole(session.user.role) && !isAdminRole(receiver.role)) {
    return NextResponse.json(
      { error: "You can only message Admin Support" },
      { status: 403 },
    );
  }

  const message = await prisma.chatMessage.create({
    data: {
      senderId: session.user.id,
      receiverId: parsed.data.receiverId,
      content: parsed.data.content,
    },
  });

  // A non-admin messaging an admin (the "Admin Support" thread) gets exactly
  // one automated acknowledgement per rolling 30 days — not on every message,
  // so an ongoing conversation doesn't get spammed with the bot reply.
  // Wrapped defensively: the sender's real message above is already saved,
  // so a failure in this best-effort side effect must never fail the request.
  try {
    if (isAdminRole(receiver.role) && !isAdminRole(session.user.role)) {
      const sender = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { name: true, preferredLang: true, lastAdminAutoReplyAt: true },
      });
      const dueForAutoReply =
        sender &&
        (!sender.lastAdminAutoReplyAt ||
          Date.now() - sender.lastAdminAutoReplyAt.getTime() > AUTO_REPLY_THROTTLE_MS);
      if (sender && dueForAutoReply) {
        await prisma.$transaction([
          prisma.chatMessage.create({
            data: {
              senderId: receiver.id,
              receiverId: session.user.id,
              content: translate(sender.preferredLang === "fr" ? "fr" : "en", "autoReplySupport", {
                name: sender.name,
              }),
            },
          }),
          prisma.user.update({
            where: { id: session.user.id },
            data: { lastAdminAutoReplyAt: new Date() },
          }),
        ]);
      }
    }
  } catch (err) {
    console.error("[chat/messages] auto-reply side effect failed:", err);
  }

  return NextResponse.json({
    kind: "message" as const,
    id: message.id,
    senderId: message.senderId,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
  });
}
