import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { detectSqlInjection, extractClientInfo, logSecurityEvent } from "@/lib/security";

const searchSchema = z.object({
  q: z.string().trim().max(100),
});

export async function GET(request: Request) {
  const rawQ = new URL(request.url).searchParams.get("q") ?? "";
  const { ip, userAgent } = extractClientInfo(request);

  // 1. Détection proactive des attaques par injection SQL (intercepte et consigne l'IP avant toute chose)
  if (rawQ.trim() && detectSqlInjection(rawQ)) {
    await logSecurityEvent({
      type: "injection_attempt",
      emailEssaye: null,
      ip,
      userAgent,
      details: { target: "admin_users_search", payload: rawQ },
    });
    return NextResponse.json(
      { error: "Tentative d'injection SQL détectée et bloquée." },
      { status: 400 },
    );
  }

  // 2. Contrôle strict des droits administrateur
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (!rawQ.trim()) return NextResponse.json({ users: [] });

  // 3. Validation stricte du schéma Zod
  const parsed = searchSchema.safeParse({ q: rawQ });
  if (!parsed.success) {
    return NextResponse.json({ error: "Paramètre de recherche invalide." }, { status: 400 });
  }

  const { q } = parsed.data;

  // 4. Requête paramétrée Prisma ORM
  const users = await prisma.user.findMany({
    where: {
      role: "MEMBER",
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
      ],
    },
    select: { id: true, name: true, email: true, phone: true, avatar: true },
    take: 10,
  });

  return NextResponse.json({ users });
}
