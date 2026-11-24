import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { saveFile } from "@/lib/storage";

const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "application/pdf": ".pdf",
};
const MAX_BYTES = 10 * 1024 * 1024; // 10MB

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const formData = await request.formData().catch(() => null);
    const file = formData?.get("file");
    const docType = formData?.get("type") || "doc";

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Aucun fichier fourni" }, { status: 400 });
    }

    let ext = ALLOWED_TYPES[file.type.toLowerCase()];
    if (!ext && file.name) {
      const match = file.name.match(/\.(jpe?g|png|webp|gif|heic|heif|pdf)$/i);
      if (match) {
        ext = match[0].toLowerCase();
        if (ext === ".jpeg") ext = ".jpg";
      }
    }

    if (!ext) {
      return NextResponse.json(
        { error: "Format non pris en charge. Veuillez téléverser une image (JPG, PNG, WebP) ou un PDF." },
        { status: 400 },
      );
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "La taille maximale autorisée est de 10 Mo." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const key = `private-kyc/${session.user.id}/${docType}-${Date.now()}${ext}`;
    await saveFile(key, buffer);

    const fileUrl = `/api/files/${key}`;
    return NextResponse.json({ ok: true, url: fileUrl, fileUrl });
  } catch (err) {
    console.error("[upload-doc] error:", err);
    return NextResponse.json({ error: "Erreur lors du téléversement du document." }, { status: 500 });
  }
}

