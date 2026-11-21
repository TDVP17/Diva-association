import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { detectSqlInjection, extractClientInfo, logSecurityEvent } from "@/lib/security";

function maskEmail(email: string | null): string {
  if (!email || !email.includes("@")) return "";
  const [local, domain] = email.split("@");
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local.slice(0, 2)}***${local.slice(-1)}@${domain}`;
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const currentUserId = session.user.id;
  const rawQ = new URL(request.url).searchParams.get("q") ?? "";
  const query = rawQ.trim();
  const { ip, userAgent } = extractClientInfo(request);

  if (query && detectSqlInjection(query)) {
    await logSecurityEvent({
      type: "injection_attempt",
      emailEssaye: null,
      ip,
      userAgent,
      details: { target: "eligible_guarantors", payload: query },
    });
    return NextResponse.json({ error: "Paramètre de recherche invalide." }, { status: 400 });
  }

  // If query is shorter than 2 characters, return empty list
  if (query.length < 2) {
    return NextResponse.json({ guarantors: [] });
  }

  // Guarantor rule: Must be a member of at least one public cotisation
  const publicMemberships = await prisma.membership.findMany({
    where: {
      userId: { not: currentUserId },
      status: "APPROVED",
      user: {
        isBanned: false,
        OR: [
          { name: { contains: query, mode: "insensitive" } },
          { email: { contains: query, mode: "insensitive" } },
        ],
      },
      tontineSession: {
        isPrivate: false,
      },
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          stars: true,
          avatar: true,
          image: true,
        },
      },
      tontineSession: {
        select: {
          id: true,
          title: true,
          type: true,
        },
      },
    },
    orderBy: { user: { name: "asc" } },
    take: 20,
  });

  // Deduplicate by user
  const map = new Map<
    string,
    {
      id: string;
      name: string;
      phone: string | null;
      email: string | null;
      publicSessionTitle: string;
      stars: number;
      avatar: string | null;
    }
  >();

  for (const m of publicMemberships) {
    if (!map.has(m.user.id)) {
      map.set(m.user.id, {
        id: m.user.id,
        name: m.user.name,
        phone: m.user.phone,
        email: maskEmail(m.user.email),
        publicSessionTitle: m.tontineSession.title || m.tontineSession.type,
        stars: m.user.stars ?? 5,
        avatar: m.user.avatar || m.user.image || null,
      });
    }
  }

  return NextResponse.json({ guarantors: Array.from(map.values()) });
}
