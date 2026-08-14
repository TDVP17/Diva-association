import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { saveFile } from "@/lib/storage";

const ACCEPTED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024;

const addressSchema = z.object({
  city: z.string().trim().min(1, "City is required").max(120),
  neighborhood: z.string().trim().min(1, "Neighborhood is required").max(120),
  phone: z
    .string()
    .trim()
    .min(1, "WhatsApp number is required")
    .max(20)
    .regex(/^[\d\s+()-]+$/, "Enter a valid phone number"),
});

function validateImage(file: File | null, field: string): string {
  if (!file || file.size === 0) throw new Error(`${field} is required`);
  if (file.size > MAX_FILE_SIZE_BYTES) throw new Error(`${field} is too large (max 8MB)`);
  const ext = ACCEPTED_IMAGE_TYPES[file.type];
  if (!ext) throw new Error(`${field} must be a JPEG, PNG, or WEBP image`);
  return ext;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const idFront = formData.get("idFront");
  const idBack = formData.get("idBack");
  const selfie = formData.get("selfie");

  const parsedAddress = addressSchema.safeParse({
    city: formData.get("city"),
    neighborhood: formData.get("neighborhood"),
    phone: formData.get("phone"),
  });
  if (!parsedAddress.success) {
    return NextResponse.json(
      { error: parsedAddress.error.issues[0]?.message ?? "Invalid address" },
      { status: 400 },
    );
  }

  try {
    const idFrontFile = idFront instanceof File ? idFront : null;
    const idBackFile = idBack instanceof File ? idBack : null;
    const selfieFile = selfie instanceof File ? selfie : null;

    const idFrontExt = validateImage(idFrontFile, "Front of ID");
    const idBackExt = validateImage(idBackFile, "Back of ID");
    const selfieExt = validateImage(selfieFile, "Selfie");

    const userId = session.user.id;
    const [cniFrontUrl, cniBackUrl, selfieUrl] = await Promise.all([
      saveFile(
        `kyc/${userId}/id-front.${idFrontExt}`,
        Buffer.from(await idFrontFile!.arrayBuffer()),
      ),
      saveFile(
        `kyc/${userId}/id-back.${idBackExt}`,
        Buffer.from(await idBackFile!.arrayBuffer()),
      ),
      saveFile(
        `kyc/${userId}/selfie.${selfieExt}`,
        Buffer.from(await selfieFile!.arrayBuffer()),
      ),
    ]);

    await prisma.user.update({
      where: { id: userId },
      data: {
        cniFrontUrl,
        cniBackUrl,
        selfieUrl,
        city: parsedAddress.data.city,
        neighborhood: parsedAddress.data.neighborhood,
        phone: parsedAddress.data.phone,
        kycStatus: "PENDING",
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Submission failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
