import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { saveFile } from "@/lib/storage";

const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};
const MAX_BYTES = 3 * 1024 * 1024; // 3MB

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData().catch(() => null);
    const file = formData?.get("avatar");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    const ext = ALLOWED_TYPES[file.type];
    if (!ext) {
      return NextResponse.json(
        { error: "Please upload a JPEG, PNG, or WebP image" },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Image must be under 3MB" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const key = `avatars/${session.user.id}/${Date.now()}${ext}`;
    await saveFile(key, buffer);

    const avatarUrl = `/api/files/${key}`;
    await prisma.user.update({
      where: { id: session.user.id },
      data: { avatar: avatarUrl },
    });

    return NextResponse.json({ avatarUrl });
  } catch (err) {
    console.error("[profile/avatar] unexpected error:", err);
    return NextResponse.json(
      { error: "Could not upload your photo. Please try again." },
      { status: 500 },
    );
  }
}
