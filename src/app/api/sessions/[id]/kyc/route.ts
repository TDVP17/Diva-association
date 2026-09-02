import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { assertJoinable, sumRegisteredSlots } from "@/lib/session-joinability";
import { isAdminRole } from "@/lib/constants";
import { saveFile } from "@/lib/storage";
import { scheduleInAppNotifications } from "@/lib/notifications/dispatch";

const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

// The client (see compress-image.ts) compresses every photo to ~400KB
// before upload, so these limits are deliberately much tighter than an
// arbitrary "ID photo" size. Three UNCOMPRESSED phone photos can total
// 30-45MB, which blows past Vercel's ~4.5MB serverless request body limit
// — previously that surfaced only as an opaque 500 with no indication of
// which file (or that size was even the problem). MAX_BYTES_PER_FILE
// leaves generous headroom over the ~400KB target; MAX_COMBINED_BYTES is
// the real guard against the platform limit.
const MAX_BYTES_PER_FILE = 1.5 * 1024 * 1024;
const MAX_COMBINED_BYTES = 4 * 1024 * 1024;

type DocumentFieldName = "documentImage" | "documentBackImage" | "selfieImage";

function formatBytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function readImageFile(formData: FormData, field: string): File | null {
  const file = formData.get(field);
  return file instanceof File && file.size > 0 ? file : null;
}

/**
 * Members submit their ID document + selfie photo directly (no third-party
 * verification service) — an admin reviews them by hand in
 * /admin/membership-requests, the same way a membership request is already
 * approved/rejected. Replaces the previous Didit-hosted flow, which billed
 * per verification; not viable for this association's budget.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (isAdminRole(session.user.role)) {
    return NextResponse.json({ error: "Admin accounts cannot join tontine sessions" }, { status: 403 });
  }

  const { id: tontineSessionId } = await params;

  try {
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (err) {
      // Most likely cause: the request body exceeded the platform's size
      // limit (Vercel serverless functions cap request bodies at ~4.5MB).
      // The client-side compression + pre-upload size guard are meant to
      // stop this before it's ever sent, so reaching here means a bypass
      // (JS disabled, a stale cached bundle) — still worth a precise
      // message instead of falling through to the generic 500 below.
      console.error("[sessions/kyc] failed to parse multipart form data (likely oversized body):", err);
      return NextResponse.json(
        {
          error: "Upload too large — the combined photos exceeded the server's request size limit",
          errorKey: "kycCombinedTooLarge",
          errorVars: { size: "?", max: formatBytes(MAX_COMBINED_BYTES) },
        },
        { status: 413 },
      );
    }

    const fields: { field: DocumentFieldName; file: File | null }[] = [
      { field: "documentImage", file: readImageFile(formData, "documentImage") },
      { field: "documentBackImage", file: readImageFile(formData, "documentBackImage") },
      { field: "selfieImage", file: readImageFile(formData, "selfieImage") },
    ];

    for (const { field, file } of fields) {
      if (!file) {
        return NextResponse.json(
          { error: `Missing required file: ${field}`, errorKey: "kycMissingDocument", errorVars: { field } },
          { status: 400 },
        );
      }
      if (!ALLOWED_TYPES[file.type]) {
        return NextResponse.json(
          {
            error: `Invalid file type for ${field}: ${file.type || "unknown"}`,
            errorKey: "kycInvalidDocumentType",
            errorVars: { field, type: file.type || "?" },
          },
          { status: 400 },
        );
      }
      if (file.size > MAX_BYTES_PER_FILE) {
        return NextResponse.json(
          {
            error: `${field} is ${formatBytes(file.size)}, over the ${formatBytes(MAX_BYTES_PER_FILE)} limit`,
            errorKey: "kycDocumentTooLarge",
            errorVars: { field, size: formatBytes(file.size), max: formatBytes(MAX_BYTES_PER_FILE) },
          },
          { status: 400 },
        );
      }
    }

    const documentFrontFile = fields[0].file!;
    const documentBackFile = fields[1].file!;
    const selfieFile = fields[2].file!;

    const referrerName = (formData.get("referrerName") as string | null)?.trim() ?? "";
    if (!referrerName) {
      return NextResponse.json(
        { error: "Missing referrer name", errorKey: "kycMissingReferrerName" },
        { status: 400 },
      );
    }
    const referrerPhoneRaw = (formData.get("referrerPhone") as string | null)?.trim() ?? "";
    const referrerPhoneDigits = referrerPhoneRaw.replace(/\D/g, "");
    if (referrerPhoneDigits.length < 8 || referrerPhoneDigits.length > 15) {
      return NextResponse.json(
        { error: "Invalid referrer phone number", errorKey: "kycInvalidReferrerPhone" },
        { status: 400 },
      );
    }

    const combinedSize = documentFrontFile.size + documentBackFile.size + selfieFile.size;
    if (combinedSize > MAX_COMBINED_BYTES) {
      return NextResponse.json(
        {
          error: `Combined upload size ${formatBytes(combinedSize)} exceeds ${formatBytes(MAX_COMBINED_BYTES)}`,
          errorKey: "kycCombinedTooLarge",
          errorVars: { size: formatBytes(combinedSize), max: formatBytes(MAX_COMBINED_BYTES) },
        },
        { status: 400 },
      );
    }

    const tontineSession = await prisma.tontineSession.findUnique({
      where: { id: tontineSessionId },
      include: { memberships: { select: { status: true, slotCount: true } } },
    });
    if (!tontineSession) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const joinable = assertJoinable(
      { ...tontineSession, maxSlots: tontineSession.maxSlots ? Number(tontineSession.maxSlots) : null },
      sumRegisteredSlots(tontineSession.memberships),
    );
    if (!joinable.ok) {
      return NextResponse.json({ error: joinable.error }, { status: joinable.status });
    }

    const existingMembership = await prisma.membership.findUnique({
      where: { userId_tontineSessionId: { userId: session.user.id, tontineSessionId } },
    });
    if (existingMembership && existingMembership.status !== "REJECTED") {
      return NextResponse.json({ status: existingMembership.status });
    }

    const stamp = Date.now();
    const documentFrontKey = `kyc-documents/${session.user.id}/${stamp}-document-front${ALLOWED_TYPES[documentFrontFile.type]}`;
    const documentBackKey = `kyc-documents/${session.user.id}/${stamp}-document-back${ALLOWED_TYPES[documentBackFile.type]}`;
    const selfieKey = `kyc-documents/${session.user.id}/${stamp}-selfie${ALLOWED_TYPES[selfieFile.type]}`;

    // Uploaded one at a time (not Promise.all) so a storage failure can be
    // attributed to the specific document that failed, instead of a vague
    // "something went wrong with one of your 3 files".
    const uploads: { field: DocumentFieldName; key: string; file: File }[] = [
      { field: "documentImage", key: documentFrontKey, file: documentFrontFile },
      { field: "documentBackImage", key: documentBackKey, file: documentBackFile },
      { field: "selfieImage", key: selfieKey, file: selfieFile },
    ];
    for (const { field, key, file } of uploads) {
      try {
        await saveFile(key, Buffer.from(await file.arrayBuffer()));
      } catch (err) {
        console.error(`[sessions/kyc] storage upload failed for ${field} (key=${key}):`, err);
        return NextResponse.json(
          { error: `Could not upload ${field} to storage`, errorKey: "kycUploadFailed", errorVars: { field } },
          { status: 502 },
        );
      }
    }

    // The uploads above take real time on a slow connection, which widens
    // the gap since the existence check at the top of this handler — two
    // submits (double-tap, or a client retry after a slow/timed-out
    // response) can both pass that check before either has written
    // anything, each creating its own Membership/KycVerification/
    // notification. A Postgres advisory lock keyed on (userId,
    // tontineSessionId) serializes concurrent requests for the same pair
    // even though no Membership row may exist yet to row-lock directly —
    // the second request then sees the first one's already-PENDING row and
    // exits without duplicating anything.
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`${session.user.id}:${tontineSessionId}`}))`;

      const fresh = await tx.membership.findUnique({
        where: { userId_tontineSessionId: { userId: session.user.id, tontineSessionId } },
      });
      if (fresh && fresh.status !== "REJECTED") {
        return { alreadyPending: true as const, status: fresh.status };
      }

      const membership = await tx.membership.upsert({
        where: { userId_tontineSessionId: { userId: session.user.id, tontineSessionId } },
        create: { userId: session.user.id, tontineSessionId, status: "PENDING" },
        update: { status: "PENDING" },
      });

      await tx.kycVerification.create({
        data: {
          userId: session.user.id,
          tontineSessionId,
          membershipId: membership.id,
          documentType: "CNI",
          status: "PENDING",
          documentImageUrl: `/api/files/${documentFrontKey}`,
          documentBackImageUrl: `/api/files/${documentBackKey}`,
          selfieImageUrl: `/api/files/${selfieKey}`,
          referrerName,
          referrerPhone: referrerPhoneDigits,
        },
      });

      return { alreadyPending: false as const };
    });

    if (result.alreadyPending) {
      return NextResponse.json({ status: result.status });
    }

    const admins = await prisma.user.findMany({
      where: { role: { in: ["ADMIN", "PRESIDENT"] } },
      select: { id: true },
    });
    await scheduleInAppNotifications({
      tontineSessionId,
      type: "NEW_MEMBERSHIP_REQUEST",
      recipients: admins.map((a) => ({
        userId: a.id,
        message: `${session.user.name ?? "A member"} requested to join a cotisation.`,
        messageKey: "newMembershipRequestMessage",
        messageVars: { name: session.user.name ?? "A member" },
        actionUrl: "/admin/membership-requests",
      })),
    });

    return NextResponse.json({ ok: true, status: "PENDING" });
  } catch (err) {
    console.error("[sessions/kyc] unexpected error:", err);
    return NextResponse.json(
      { error: "Could not submit your documents. Please try again." },
      { status: 500 },
    );
  }
}
