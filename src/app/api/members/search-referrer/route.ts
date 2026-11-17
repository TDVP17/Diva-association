import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { detectSqlInjection, extractClientInfo, logSecurityEvent } from "@/lib/security";
import { TONTINE_TYPE_LABELS } from "@/lib/tontine-labels";

function maskEmail(email: string | null): string {
  if (!email || !email.includes("@")) return "";
  const [local, domain] = email.split("@");
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local.slice(0, 2)}***${local.slice(-1)}@${domain}`;
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawQ = new URL(request.url).searchParams.get("q") ?? "";
  const query = rawQ.trim();
  const { ip, userAgent } = extractClientInfo(request);

  if (query && detectSqlInjection(query)) {
    await logSecurityEvent({
      type: "injection_attempt",
      emailEssaye: null,
      ip,
      userAgent,
      details: { target: "search_referrer", payload: query },
    });
    return NextResponse.json(
      { error: "Paramètre de recherche invalide." },
      { status: 400 },
    );
  }

  if (query.length < 2) {
    return NextResponse.json({ results: [], total: 0, found: false });
  }

  // Find approved members who are part of at least one approved cotisation
  const users = await prisma.user.findMany({
    where: {
      isBanned: false,
      id: { not: session.user.id }, // cannot refer oneself
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { email: { contains: query, mode: "insensitive" } },
      ],
      memberships: {
        some: { status: "APPROVED" },
      },
    },
    select: {
      id: true,
      name: true,
      email: true,
      avatar: true,
      image: true,
      memberships: {
        where: { status: "APPROVED" },
        select: {
          tontineSession: {
            select: { title: true, type: true },
          },
        },
        take: 1,
      },
    },
    take: 5,
  });

  const formatted = users.map((u) => {
    const s = u.memberships[0]?.tontineSession;
    const sessionLabel = s ? s.title || TONTINE_TYPE_LABELS[s.type] || s.type : null;
    return {
      id: u.id,
      name: u.name,
      maskedEmail: maskEmail(u.email),
      sessionLabel,
      image: u.avatar || u.image || null,
    };
  });

  return NextResponse.json({
    results: formatted,
    total: formatted.length,
    found: formatted.length > 0,
  });
}

