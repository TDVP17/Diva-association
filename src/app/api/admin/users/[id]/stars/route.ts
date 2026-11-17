import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/require-admin";
import { logAudit } from "@/lib/audit";

const starsSchema = z.object({
  stars: z.number().int().min(0).max(5),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = starsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Nombre d'étoiles invalide (doit être entre 0 et 5)." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, email: true, stars: true },
  });

  if (!user) {
    return NextResponse.json({ error: "Utilisateur non trouvé" }, { status: 404 });
  }

  const oldStars = user.stars ?? 0;
  const newStars = parsed.data.stars;

  const updated = await prisma.user.update({
    where: { id },
    data: { stars: newStars },
    select: { id: true, name: true, stars: true },
  });

  await logAudit({
    actorId: admin.user.id,
    actorRole: admin.user.role,
    action: "user_stars_manually_updated",
    targetType: "User",
    targetId: id,
    metadata: {
      userName: user.name,
      userEmail: user.email,
      oldStars,
      newStars,
    },
    request,
  });

  return NextResponse.json({
    ok: true,
    user: updated,
    message: `Note de ${user.name} mise à jour à ${newStars}/5 étoiles.`,
  });
}

