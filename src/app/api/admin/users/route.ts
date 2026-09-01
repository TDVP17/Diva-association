import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";

/** Every registered account, searchable by name/email/phone/member code — the admin's global user directory. */
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const q = new URL(request.url).searchParams.get("q")?.trim();

  const where = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { email: { contains: q, mode: "insensitive" as const } },
          { phone: { contains: q } },
          { memberCode: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : undefined;

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        avatar: true,
        image: true,
        role: true,
        memberCode: true,
        city: true,
        neighborhood: true,
        createdAt: true,
        _count: { select: { memberships: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    // Unfiltered (q=undefined) this is the platform's true total registered
    // user count, independent of the take:200 cap above — the admin
    // dashboard's "All Users" stat reads this, not users.length.
    prisma.user.count({ where }),
  ]);

  return NextResponse.json({
    total,
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      avatar: u.avatar ?? u.image,
      role: u.role,
      memberCode: u.memberCode,
      city: u.city,
      neighborhood: u.neighborhood,
      membershipCount: u._count.memberships,
      createdAt: u.createdAt.toISOString(),
    })),
  });
}
