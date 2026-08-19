import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { readStoredFile } from "@/lib/storage";
import { mimeTypeFor } from "@/lib/mime";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { path: segments } = await params;
  // Every stored file lives under {category}/{ownerId}/{filename} — only the
  // owner or an admin may read it back.
  const [category, ownerId, ...rest] = segments;
  if (!category || !ownerId || rest.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const isOwner = session.user.id === ownerId;
  const isAdmin = session.user.role === "ADMIN";
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const key = segments.join("/");
  try {
    const data = await readStoredFile(key);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": mimeTypeFor(key),
        "Cache-Control": "private, max-age=0, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
