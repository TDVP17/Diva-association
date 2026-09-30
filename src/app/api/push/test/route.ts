import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { sendPushToUser } from "@/lib/push/send";

export async function POST() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await sendPushToUser(session.user.id, {
    title: "DIVA Association",
    body: "🔔 Notification de test réussie ! Les notifications push et les alertes fonctionnent sur votre téléphone.",
    url: "/notifications",
    badgeCount: 1,
  });

  return NextResponse.json({
    ok: true,
    sent: result.sent,
    failed: result.failed,
  });
}
