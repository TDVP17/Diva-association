import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const bodySchema = z.object({
  endpoint: z.string().min(1),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

/**
 * Upserts by endpoint (unique) rather than by userId — the same endpoint
 * re-subscribing (e.g. the browser refreshed the subscription) just updates
 * its keys/owner in place instead of accumulating duplicate rows.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    await prisma.pushSubscription.upsert({
      where: { endpoint: parsed.data.endpoint },
      create: {
        userId: session.user.id,
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
        userAgent: request.headers.get("user-agent") ?? undefined,
      },
      update: {
        userId: session.user.id,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
        userAgent: request.headers.get("user-agent") ?? undefined,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[push/subscribe] unexpected error:", err);
    return NextResponse.json({ error: "Could not save push subscription" }, { status: 500 });
  }
}
