import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sessions = await prisma.tontineSession.findMany({
    include: {
      memberships: {
        where: { status: "APPROVED" },
        include: {
          user: { select: { id: true, name: true, avatar: true, image: true, phone: true } },
          slots: { orderBy: [{ officialPosition: "asc" }, { ballDrawn: "asc" }, { createdAt: "asc" }] },
        },
      },
    },
    orderBy: { startDate: "desc" },
  });

  return NextResponse.json({
    sessions: sessions.map((s) => {
      const registeredSlots = s.memberships.reduce(
        (sum, m) => sum + (m.slotCount ? Number(m.slotCount) : 0),
        0,
      );
      return {
        id: s.id,
        title: s.title,
        type: s.type,
        status: s.status,
        startDate: s.startDate.toISOString(),
        maxSlots: s.maxSlots ? Number(s.maxSlots) : null,
        registeredSlots,
        slots: s.memberships.flatMap((m) =>
          m.slots.map((slot) => ({
            id: slot.id,
            membershipId: m.id,
            userId: m.userId,
            beneficiaryName: slot.beneficiaryName,
            name: m.user.name,
            avatar: m.user.avatar ?? m.user.image,
            hasPhone: !!m.user.phone,
            officialPosition: slot.officialPosition,
            ballDrawn: slot.ballDrawn,
          })),
        ),
      };
    }),
  });
}

const createSessionSchema = z.object({
  title: z.string().trim().min(1).max(200),
  type: z.enum(["HEBDO_SUNDAY", "MONTHLY_25", "MONTHLY_28"]),
  amount: z.coerce.number().positive(),
  fee: z.coerce.number().nonnegative(),
  rules: z.string().trim().max(5000).optional(),
  startDate: z.coerce.date(),
  limitTime: z.string().trim().min(1).max(100),
  maxSlots: z.coerce.number().positive().optional(),
});

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = createSessionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const tontineSession = await prisma.tontineSession.create({
      data: { ...parsed.data, status: "DRAFT" },
    });
    return NextResponse.json({ id: tontineSession.id });
  } catch (err) {
    console.error("[admin/sessions POST] unexpected error:", err);
    return NextResponse.json({ error: "Could not create the cotisation. Please try again." }, { status: 500 });
  }
}
