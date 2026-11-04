import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { saveFile } from "@/lib/storage";
import { getContributionTotal } from "@/lib/tontine-engine";
import { resolveDueDateForSlot } from "@/lib/initiate-slot-payment";
import { normalizeCameroonPhone } from "@/lib/fapshi";
import { sendPushToUser } from "@/lib/push/send";

const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function extractSlotIds(formData: FormData): string[] {
  const ids = new Set<string>();

  for (const entry of formData.getAll("membershipSlotIds")) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (typeof item === "string" && item.trim()) ids.add(item.trim());
          }
          continue;
        }
      } catch {
        // treat as plain id
      }
    }
    ids.add(trimmed);
  }

  const single = formData.get("membershipSlotId");
  if (typeof single === "string" && single.trim()) {
    ids.add(single.trim());
  }

  return [...ids];
}

function extractProofFiles(formData: FormData): File[] {
  const raw = [...formData.getAll("files"), ...formData.getAll("file")];
  const files: File[] = [];
  for (const item of raw) {
    if (item instanceof File && item.size > 0) {
      files.push(item);
    }
  }
  return files;
}

export async function POST(request: Request) {
  const session = await auth();

  try {
    const formData = await request.formData();
    const slotIds = extractSlotIds(formData);
    const dueDateStr = formData.get("dueDate") as string | null;
    const rawPhone = (formData.get("phone") as string | null)?.trim() || null;
    const files = extractProofFiles(formData);

    if (slotIds.length === 0 || files.length === 0) {
      return NextResponse.json(
        { error: "Veuillez sélectionner au moins un nom et une capture d'écran." },
        { status: 400 },
      );
    }

    if (slotIds.length > 20) {
      return NextResponse.json(
        { error: "Trop de noms sélectionnés en une seule fois." },
        { status: 400 },
      );
    }

    if (files.length > MAX_IMAGES) {
      return NextResponse.json(
        { error: `Vous pouvez envoyer au maximum ${MAX_IMAGES} images à la fois.` },
        { status: 400 },
      );
    }

    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        return NextResponse.json(
          { error: "Veuillez téléverser uniquement des images (PNG, JPEG, WebP)." },
          { status: 400 },
        );
      }
      if (file.size > MAX_IMAGE_BYTES) {
        return NextResponse.json(
          { error: "Chaque image ne doit pas dépasser 8 Mo." },
          { status: 400 },
        );
      }
    }

    const slots = await prisma.membershipSlot.findMany({
      where: { id: { in: slotIds } },
      include: {
        membership: {
          include: {
            tontineSession: true,
            user: true,
          },
        },
      },
    });

    if (slots.length !== slotIds.length) {
      return NextResponse.json({ error: "Nom(s) introuvable(s)." }, { status: 404 });
    }

    for (const s of slots) {
      if (
        s.membership.status !== "APPROVED" ||
        !["DRAWING", "ACTIVE"].includes(s.membership.tontineSession.status)
      ) {
        return NextResponse.json(
          { error: "Cette cotisation n'accepte pas de paiement pour le moment." },
          { status: 409 },
        );
      }
    }

    const ownerFolder = session?.user?.id ?? slots[0].membership.userId ?? "public";
    const batchTimestamp = Date.now();
    const proofImageUrls: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const mime = file.type;
      const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
      const key = `payment-proofs/${ownerFolder}/${slots[0].id}_${batchTimestamp}_${i}.${ext}`;
      const arrayBuffer = await file.arrayBuffer();
      await saveFile(key, Buffer.from(arrayBuffer));
      proofImageUrls.push(`/api/files/${key}`);
    }

    const proofImageUrl = proofImageUrls[0];
    const uploadedAt = new Date(batchTimestamp);
    const normalizedPhone = rawPhone ? normalizeCameroonPhone(rawPhone) ?? rawPhone : null;

    const updatedContributionIds: string[] = [];
    const bySession = new Map<
      string,
      { sessionId: string; sessionTitle: string; memberName: string; beneficiaryNames: string[] }
    >();

    for (const slot of slots) {
      const tontineSession = slot.membership.tontineSession;
      const explicitDueDate = slotIds.length === 1 && dueDateStr ? dueDateStr : null;
      const dueDate = await resolveDueDateForSlot(slot.id, tontineSession, explicitDueDate);

      const existing = await prisma.contribution.findUnique({
        where: { membershipSlotId_dueDate: { membershipSlotId: slot.id, dueDate } },
      });
      if (existing?.status === "PAID") {
        continue;
      }

      const { amount, fee } = getContributionTotal({
        amount: Number(tontineSession.amount),
        fee: Number(tontineSession.fee),
      });

      const contribution = await prisma.contribution.upsert({
        where: { membershipSlotId_dueDate: { membershipSlotId: slot.id, dueDate } },
        create: {
          membershipSlotId: slot.id,
          dueDate,
          amountPaid: amount,
          feePaid: fee,
          finePaid: 0,
          status: "PENDING",
          proofImageUrl,
          proofImageUrls,
          proofUploadedAt: uploadedAt,
          payerPhone: normalizedPhone,
          paidByUserId: session?.user?.id ?? null,
          failureReason: null,
        },
        update: {
          amountPaid: amount,
          feePaid: fee,
          status: "PENDING",
          proofImageUrl,
          proofImageUrls,
          proofUploadedAt: uploadedAt,
          payerPhone: normalizedPhone ?? undefined,
          paidByUserId: session?.user?.id ?? undefined,
          failureReason: null,
        },
      });

      updatedContributionIds.push(contribution.id);

      const group = bySession.get(tontineSession.id) ?? {
        sessionId: tontineSession.id,
        sessionTitle: tontineSession.title || tontineSession.type,
        memberName: slot.membership.user.name,
        beneficiaryNames: [],
      };
      group.beneficiaryNames.push(slot.beneficiaryName);
      bySession.set(tontineSession.id, group);
    }

    if (updatedContributionIds.length === 0) {
      return NextResponse.json(
        { error: "Ces noms sont déjà enregistrés comme payés pour ce tour." },
        { status: 409 },
      );
    }

    const admins = await prisma.user.findMany({
      where: { role: { in: ["ADMIN", "PRESIDENT"] } },
      select: { id: true },
    });

    if (admins.length > 0) {
      const notifRows: Array<{
        userId: string;
        tontineSessionId: string;
        channel: "IN_APP";
        type: "ADMIN_BROADCAST";
        message: string;
        actionUrl: string;
        status: "SENT";
      }> = [];

      for (const group of bySession.values()) {
        const namesLabel = group.beneficiaryNames.join(", ");
        const actionUrl = `/admin/contributions/${group.sessionId}?tab=payments`;
        const message = `Preuve de paiement (${proofImageUrls.length} image${proofImageUrls.length > 1 ? "s" : ""}) reçue pour ${namesLabel} (${group.memberName}) — ${group.sessionTitle}. Cliquez pour vérifier et cocher.`;

        for (const admin of admins) {
          notifRows.push({
            userId: admin.id,
            tontineSessionId: group.sessionId,
            channel: "IN_APP",
            type: "ADMIN_BROADCAST",
            message,
            actionUrl,
            status: "SENT",
          });
        }

        // Best-effort instant Web Push to admins
        void Promise.all(
          admins.map((admin) =>
            sendPushToUser(admin.id, {
              title: "Nouvelle preuve de paiement reçue",
              body: `${namesLabel} (${group.memberName}) — ${group.sessionTitle}`,
              url: actionUrl,
            }).catch(() => {}),
          ),
        );
      }

      if (notifRows.length > 0) {
        await prisma.notification.createMany({ data: notifRows });
      }
    }

    return NextResponse.json({
      ok: true,
      contributionId: updatedContributionIds[0],
      contributionIds: updatedContributionIds,
      proofImageUrl,
      proofImageUrls,
    });
  } catch (err) {
    console.error("[payments/proof] error uploading proof:", err);
    return NextResponse.json(
      { error: "Impossible d'envoyer la capture pour le moment. Veuillez réessayer." },
      { status: 500 },
    );
  }
}
