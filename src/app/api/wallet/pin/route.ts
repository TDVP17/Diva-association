import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hashWalletPin, verifyWalletPin, isValidWalletPin } from "@/lib/wallet-pin";
import { logAudit } from "@/lib/audit";

const setPinSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, "Le code PIN doit contenir exactement 4 chiffres."),
  currentPin: z.string().optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { walletPinHash: true, walletPinSetAt: true },
  });

  return NextResponse.json({
    hasPin: Boolean(user?.walletPinHash),
    setAt: user?.walletPinSetAt?.toISOString() ?? null,
  });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = setPinSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Code PIN invalide (4 chiffres requis)." },
      { status: 400 },
    );
  }

  const { pin, currentPin } = parsed.data;
  if (!isValidWalletPin(pin)) {
    return NextResponse.json({ error: "Le code PIN doit contenir exactement 4 chiffres." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, walletPinHash: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });
  }

  // If user already has a PIN, verify currentPin before changing
  if (user.walletPinHash) {
    if (!currentPin || !verifyWalletPin(currentPin, user.walletPinHash)) {
      return NextResponse.json(
        { error: "Votre code PIN actuel est incorrect." },
        { status: 403 },
      );
    }
  }

  const pinHash = hashWalletPin(pin);
  const now = new Date();
  await prisma.user.update({
    where: { id: user.id },
    data: { walletPinHash: pinHash, walletPinSetAt: now },
  });

  await logAudit({
    actorId: user.id,
    actorRole: session.user.role,
    action: user.walletPinHash ? "wallet_pin_changed" : "wallet_pin_created",
    targetType: "User",
    targetId: user.id,
    request,
  });

  return NextResponse.json({
    ok: true,
    hasPin: true,
    setAt: now.toISOString(),
    message: user.walletPinHash
      ? "Votre code PIN de retrait a été mis à jour avec succès."
      : "Votre code PIN de retrait à 4 chiffres a été activé !",
  });
}

