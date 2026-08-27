import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getSupportAdmin } from "@/lib/chat/support-admin";
import { isAdminRole } from "@/lib/constants";

interface Contact {
  id: string;
  name: string;
  avatar: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
}

async function withLastMessage(userId: string, otherIds: string[]): Promise<Contact[]> {
  if (otherIds.length === 0) return [];

  const [users, lastMessages, unreadByPartner] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: otherIds } },
      select: { id: true, name: true, avatar: true, image: true },
    }),
    prisma.chatMessage.findMany({
      where: {
        OR: [
          { senderId: userId, receiverId: { in: otherIds } },
          { receiverId: userId, senderId: { in: otherIds } },
        ],
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.chatMessage.groupBy({
      by: ["senderId"],
      where: { receiverId: userId, senderId: { in: otherIds }, readAt: null },
      _count: { _all: true },
    }),
  ]);

  const lastByPartner = new Map<string, (typeof lastMessages)[number]>();
  for (const msg of lastMessages) {
    const partnerId = msg.senderId === userId ? msg.receiverId : msg.senderId;
    if (!lastByPartner.has(partnerId)) lastByPartner.set(partnerId, msg);
  }
  const unreadCountByPartner = new Map(unreadByPartner.map((row) => [row.senderId, row._count._all]));

  return users
    .map((u) => {
      const last = lastByPartner.get(u.id);
      return {
        id: u.id,
        name: u.name,
        avatar: u.avatar ?? u.image,
        lastMessageAt: last?.createdAt.toISOString() ?? null,
        lastMessagePreview: last?.content ?? null,
        unreadCount: unreadCountByPartner.get(u.id) ?? 0,
      };
    })
    .sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""));
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isAdmin = isAdminRole(session.user.role);

  let memberIds: string[];
  if (isAdmin) {
    // Only users who have actually exchanged a message with this admin —
    // not every registered member. Derived from real ChatMessage rows, not
    // a role filter, so the list only grows as real conversations happen.
    const messages = await prisma.chatMessage.findMany({
      where: { OR: [{ senderId: session.user.id }, { receiverId: session.user.id }] },
      select: { senderId: true, receiverId: true },
    });
    const partnerIds = new Set<string>();
    for (const m of messages) {
      partnerIds.add(m.senderId === session.user.id ? m.receiverId : m.senderId);
    }
    memberIds = [...partnerIds];
  } else {
    const myMemberships = await prisma.membership.findMany({
      where: { userId: session.user.id },
      select: { tontineSessionId: true },
    });
    const sessionIds = myMemberships.map((m) => m.tontineSessionId);
    const coMemberships = await prisma.membership.findMany({
      where: { tontineSessionId: { in: sessionIds }, userId: { not: session.user.id } },
      select: { userId: true },
      distinct: ["userId"],
    });
    memberIds = coMemberships.map((m) => m.userId);
  }

  const [members, adminUser] = await Promise.all([
    withLastMessage(session.user.id, memberIds),
    isAdmin ? Promise.resolve(null) : getSupportAdmin(),
  ]);

  let admin: Contact | null = null;
  if (adminUser) {
    const [withAdmin] = await withLastMessage(session.user.id, [adminUser.id]);
    admin = withAdmin ?? {
      id: adminUser.id,
      name: adminUser.name,
      avatar: adminUser.avatar ?? adminUser.image,
      lastMessageAt: null,
      lastMessagePreview: null,
      unreadCount: 0,
    };
  }

  return NextResponse.json({ members, admin });
}
