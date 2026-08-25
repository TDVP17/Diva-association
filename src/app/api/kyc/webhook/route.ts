import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionDecision } from "@/lib/didit";
import { sendWhatsAppMessageSafe } from "@/lib/whatsapp/evolution";

const MAX_TIMESTAMP_SKEW_SECONDS = 300;

/**
 * Verifies Didit's `X-Signature-Simple` envelope signature — confirms the
 * request really came from Didit and names a real session, but doesn't
 * authenticate the full decision payload. That's fine here: the handler
 * below never trusts the payload's own decision data either way, it always
 * re-fetches authoritative status via the signed getSessionDecision() call.
 */
function verifySignature(payload: {
  timestamp: string | null;
  signature: string | null;
  sessionId: string;
  status: string;
  webhookType: string;
}): boolean {
  const secret = process.env.DIDIT_WEBHOOK_SECRET ?? "";
  if (!payload.timestamp || !payload.signature || !secret) return false;

  const timestampNum = Number(payload.timestamp);
  if (!Number.isFinite(timestampNum)) return false;
  if (Math.abs(Date.now() / 1000 - timestampNum) > MAX_TIMESTAMP_SKEW_SECONDS) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${payload.timestamp}:${payload.sessionId}:${payload.status}:${payload.webhookType}`)
    .digest("hex");

  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(payload.signature, "hex");
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const sessionId = body?.session_id;
    const status = body?.status;
    const webhookType = body?.webhook_type;
    if (typeof sessionId !== "string" || !sessionId) {
      return NextResponse.json({ error: "Missing session_id" }, { status: 400 });
    }

    const valid = verifySignature({
      timestamp: request.headers.get("x-timestamp"),
      signature: request.headers.get("x-signature-simple"),
      sessionId,
      status: String(status ?? ""),
      webhookType: String(webhookType ?? ""),
    });
    if (!valid) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const record = await prisma.kycVerification.findUnique({ where: { diditSessionId: sessionId } });
    if (!record) {
      return NextResponse.json({ error: "Unknown session" }, { status: 404 });
    }
    if (record.status !== "PENDING") {
      return NextResponse.json({ ok: true, alreadyProcessed: true });
    }

    // Never trust the payload's own status/decision — re-verify against
    // Didit's own API before granting anything, same defensive pattern as
    // the Fapshi payment webhook.
    const verified = await getSessionDecision(sessionId);

    if (verified.status === "Approved") {
      await prisma.$transaction(async (tx) => {
        const membership = await tx.membership.upsert({
          where: { userId_tontineSessionId: { userId: record.userId, tontineSessionId: record.tontineSessionId } },
          create: { userId: record.userId, tontineSessionId: record.tontineSessionId, status: "PENDING" },
          update: { status: "PENDING" },
        });
        await tx.kycVerification.update({
          where: { id: record.id },
          data: {
            status: "VERIFIED",
            membershipId: membership.id,
            matchConfidence: verified.face_matches?.[0]?.score ?? null,
            verifiedAt: new Date(),
          },
        });
      });

      const user = await prisma.user.findUnique({ where: { id: record.userId } });
      await sendWhatsAppMessageSafe(
        user?.phone ?? null,
        `Your identity verification was successful. Your request to join the cotisation is now awaiting admin approval.`,
      );
    } else {
      await prisma.kycVerification.update({ where: { id: record.id }, data: { status: "FAILED" } });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[kyc/webhook] unexpected error:", err);
    return NextResponse.json({ error: "Could not process verification result" }, { status: 500 });
  }
}
