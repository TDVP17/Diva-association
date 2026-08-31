import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { logAudit } from "@/lib/audit";
import { ALL_TONTINE_TYPES } from "@/lib/tontine-engine";
import type { TontineType } from "@/generated/prisma/enums";

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
        description: s.description,
        type: s.type,
        status: s.status,
        amount: Number(s.amount),
        fee: Number(s.fee),
        fineAmountPerPeriod: s.fineAmountPerPeriod ? Number(s.fineAmountPerPeriod) : null,
        fineIntervalHours: s.fineIntervalHours,
        limitTime: s.limitTime,
        startDate: s.startDate.toISOString(),
        drawDate: s.drawDate ? s.drawDate.toISOString() : null,
        maxSlots: s.maxSlots ? Number(s.maxSlots) : null,
        isPaused: s.isPaused,
        lockedAt: s.lockedAt ? s.lockedAt.toISOString() : null,
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
  description: z.string().trim().max(5000).optional(),
  type: z.enum(ALL_TONTINE_TYPES as [TontineType, ...TontineType[]]),
  amount: z.coerce.number().positive(),
  fee: z.coerce.number().nonnegative(),
  fineAmountPerPeriod: z.coerce.number().nonnegative(),
  fineIntervalHours: z.coerce.number().int().positive(),
  startDate: z.coerce.date(),
  limitTime: z.string().trim().min(1).max(100),
  maxSlots: z.coerce.number().positive().optional(),
  drawDate: z.coerce.date(),
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
    await logAudit({
      actorId: admin.user.id,
      action: "contribution_created",
      targetType: "TontineSession",
      targetId: tontineSession.id,
      tontineSessionId: tontineSession.id,
    });
    return NextResponse.json({ id: tontineSession.id });
  } catch (err) {
    console.error("[admin/sessions POST] unexpected error:", err);
    return NextResponse.json({ error: "Could not create the cotisation. Please try again." }, { status: 500 });
  }
}
