import { NextResponse } from "next/server";
import { z } from "zod";
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
const MAX_BYTES = 5 * 1024 * 1024; // 5MB — ID photos can be a bit larger than an avatar

const bodySchema = z.object({ documentType: z.enum(["CNI", "PASSPORT"]) });

function readImageFile(formData: FormData, field: string): File | null {
  const file = formData.get(field);
  return file instanceof File ? file : null;
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
    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const parsed = bodySchema.safeParse({ documentType: formData.get("documentType") });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const documentFrontFile = readImageFile(formData, "documentImage");
    const documentBackFile = readImageFile(formData, "documentBackImage");
    const selfieFile = readImageFile(formData, "selfieImage");
    const isCni = parsed.data.documentType === "CNI";
    if (!documentFrontFile || !selfieFile || (isCni && !documentBackFile)) {
      return NextResponse.json(
        {
          error: isCni
            ? "Please provide the front and back of your CNI, and a selfie"
            : "Please provide your passport photo page and a selfie",
        },
        { status: 400 },
      );
    }
    const filesToValidate = [documentFrontFile, selfieFile, ...(documentBackFile ? [documentBackFile] : [])];
    for (const file of filesToValidate) {
      if (!ALLOWED_TYPES[file.type]) {
        return NextResponse.json(
          { error: "Please upload JPEG, PNG, or WebP images" },
          { status: 400 },
        );
      }
      if (file.size > MAX_BYTES) {
        return NextResponse.json({ error: "Each photo must be under 5MB" }, { status: 400 });
      }
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
    const selfieKey = `kyc-documents/${session.user.id}/${stamp}-selfie${ALLOWED_TYPES[selfieFile.type]}`;
    const documentBackKey = documentBackFile
      ? `kyc-documents/${session.user.id}/${stamp}-document-back${ALLOWED_TYPES[documentBackFile.type]}`
      : null;

    const uploads = [
      saveFile(documentFrontKey, Buffer.from(await documentFrontFile.arrayBuffer())),
      saveFile(selfieKey, Buffer.from(await selfieFile.arrayBuffer())),
      ...(documentBackFile && documentBackKey
        ? [saveFile(documentBackKey, Buffer.from(await documentBackFile.arrayBuffer()))]
        : []),
    ];
    await Promise.all(uploads);

    const membership = await prisma.membership.upsert({
      where: { userId_tontineSessionId: { userId: session.user.id, tontineSessionId } },
      create: { userId: session.user.id, tontineSessionId, status: "PENDING" },
      update: { status: "PENDING" },
    });

    await prisma.kycVerification.create({
      data: {
        userId: session.user.id,
        tontineSessionId,
        membershipId: membership.id,
        documentType: parsed.data.documentType,
        status: "PENDING",
        documentImageUrl: `/api/files/${documentFrontKey}`,
        documentBackImageUrl: documentBackKey ? `/api/files/${documentBackKey}` : null,
        selfieImageUrl: `/api/files/${selfieKey}`,
      },
    });

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
