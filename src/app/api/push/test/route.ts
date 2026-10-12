import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sendPushToUser } from "@/lib/push/send";

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await sendPushToUser(session.user.id, {
      title: "DIVA Asso.",
      body: "Vos notifications sur le téléphone sont parfaitement activées ! ✨",
      url: "/notifications",
    });

    return NextResponse.json({ ok: true, sent: result.sent, failed: result.failed });
  } catch (err) {
    console.error("[push/test] test notification failed:", err);
    return NextResponse.json({ error: "Failed to send test push" }, { status: 500 });
  }
}
