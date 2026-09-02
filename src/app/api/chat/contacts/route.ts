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

  // Messaging is admin-only: a member's only possible contact is the
  // support admin (below); an admin's contact list is everyone who's
  // actually messaged them (unaffected by removing peer-to-peer chat,
  // since it was never peer-to-peer from an admin's perspective).
  let memberIds: string[] = [];
  if (isAdmin) {
    const messages = await prisma.chatMessage.findMany({
      where: { OR: [{ senderId: session.user.id }, { receiverId: session.user.id }] },
      select: { senderId: true, receiverId: true },
    });
    const partnerIds = new Set<string>();
    for (const m of messages) {
      partnerIds.add(m.senderId === session.user.id ? m.receiverId : m.senderId);
    }
    memberIds = [...partnerIds];
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
