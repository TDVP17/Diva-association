import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { translate, type Lang } from "@/lib/i18n/translations";
import { LANG_COOKIE } from "@/lib/i18n/lang-cookie";
import { isAdminRole } from "@/lib/constants";
import { sendPushToUser } from "@/lib/push/send";
import { sendWhatsAppMessageSafe } from "@/lib/whatsapp/evolution";
import { sendEmailSafe } from "@/lib/email/resend";

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

  // Notify recipient on their phone via Web Push, WhatsApp (Evolution API), and Email (Resend)
  try {
    const senderName = session.user.name ?? "DIVA Asso";
    const preview =
      parsed.data.content.length > 70
        ? parsed.data.content.slice(0, 70) + "..."
        : parsed.data.content;
    const chatUrl = `/chat?with=${session.user.id}`;
    const baseUrl = process.env.NEXTAUTH_URL ?? "https://diva-association.vercel.app";

    const unreadChatCount =
      (await prisma.chatMessage.count({
        where: { receiverId: receiver.id, readAt: null },
      })) || 1;

    void sendPushToUser(receiver.id, {
      title: `Nouveau message - ${senderName}`,
      body: preview,
      url: chatUrl,
      badgeCount: unreadChatCount,
    }).catch((err) => console.error("[chat] Push notification failed:", err));

    if (receiver.phone) {
      const waText = `*DIVA Asso - Nouveau message*\n\nDe : *${senderName}*\n« ${preview} »\n\nRépondre dans l'app : ${baseUrl}${chatUrl}`;
      void sendWhatsAppMessageSafe(receiver.phone, waText).catch((err) =>
        console.error("[chat] WhatsApp notification failed:", err),
      );
    }

    if (receiver.email) {
      const emailHtml = `<p>Bonjour,</p><p>Vous avez reçu un nouveau message de <strong>${senderName}</strong> :</p><p style="padding:12px;background:#f1f5f9;border-radius:8px;">« ${preview} »</p><p><a href="${baseUrl}${chatUrl}" style="display:inline-block;padding:10px 16px;background:#003528;color:#ffffff;text-decoration:none;border-radius:6px;">Répondre dans l'application</a></p>`;
      void sendEmailSafe(receiver.email, `Nouveau message de ${senderName} — DIVA Asso`, emailHtml).catch((err) =>
        console.error("[chat] Email notification failed:", err),
      );
    }
  } catch (err) {
    console.error("[chat] Notification dispatch failed:", err);
  }

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

      const cookieHeader = request.headers?.get?.("cookie") ?? "";
      const cookieLangMatch = cookieHeader.match(new RegExp(`${LANG_COOKIE}=(fr|en)`));
      const activeLang: Lang =
        (cookieLangMatch?.[1] as Lang) ??
        (sender?.preferredLang === "en" ? "en" : "fr");

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
              content: translate(activeLang, "autoReplySupport", {
                name: sender.name,
              }),
            },
          }),
          prisma.user.update({
            where: { id: session.user.id },
            data: {
              lastAdminAutoReplyAt: new Date(),
              ...(sender.preferredLang !== activeLang ? { preferredLang: activeLang } : {}),
            },
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
