import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { normalizeCameroonPhone } from "@/lib/fapshi";
import { detectMobileMoneyProvider } from "@/lib/mobile-money-provider";

const MAX_SAVED_METHODS = 4;

// Scoped to the caller's own userId on every query in this file — a saved
// payer number is exactly the kind of personal payment detail that must
// never be visible to (or editable by) anyone but its owner.
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const methods = await prisma.savedPaymentMethod.findMany({
    where: { userId: session.user.id },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    select: { id: true, provider: true, label: true, phone: true, isDefault: true },
  });
  return NextResponse.json({ methods });
}

const bodySchema = z.object({
  phone: z.string().min(1),
  label: z.string().trim().max(40).optional(),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const normalizedPhone = normalizeCameroonPhone(parsed.data.phone);
  if (!normalizedPhone) {
    return NextResponse.json(
      { error: "Please enter a valid Mobile Money / Orange Money number", errorKey: "invalidMobileMoneyPhone" },
      { status: 400 },
    );
  }

  // Never trust a client-supplied provider — always re-derive from the
  // number itself, the one thing that's actually true regardless of what
  // the UI happened to send.
  const provider = detectMobileMoneyProvider(normalizedPhone);
  if (!provider) {
    return NextResponse.json(
      {
        error: "This number doesn't match a known Orange Money or MTN Mobile Money range",
        errorKey: "unrecognizedMobileMoneyProvider",
      },
      { status: 400 },
    );
  }

  try {
    const existingCount = await prisma.savedPaymentMethod.count({ where: { userId: session.user.id } });
    if (existingCount >= MAX_SAVED_METHODS) {
      return NextResponse.json(
        {
          error: `You can save up to ${MAX_SAVED_METHODS} payer numbers`,
          errorKey: "savedPaymentMethodLimitReached",
          errorVars: { max: String(MAX_SAVED_METHODS) },
        },
        { status: 409 },
      );
    }

    const isFirst = existingCount === 0;
    const method = await prisma.savedPaymentMethod.create({
      data: {
        userId: session.user.id,
        provider,
        phone: normalizedPhone,
        label: parsed.data.label || null,
        // The very first saved number becomes the default automatically —
        // there's nothing to choose between yet.
        isDefault: isFirst,
      },
      select: { id: true, provider: true, label: true, phone: true, isDefault: true },
    });
    return NextResponse.json({ method });
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as { code?: string }).code === "P2002") {
      return NextResponse.json(
        { error: "This number is already saved", errorKey: "savedPaymentMethodDuplicate" },
        { status: 409 },
      );
    }
    console.error("[profile/payment-methods] unexpected error:", err);
    return NextResponse.json({ error: "Could not save this payer number" }, { status: 500 });
  }
}
