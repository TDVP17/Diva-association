import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getLang } from "@/lib/i18n/get-lang";
import { getDashboardData } from "@/lib/dashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const lang = await getLang();
    const data = await getDashboardData(session.user.id, lang);
    return NextResponse.json(data);
  } catch (error) {
    console.error("[api/dashboard/summary] Error:", error);
    return NextResponse.json(
      { error: "Impossible de charger les données du tableau de bord" },
      { status: 500 },
    );
  }
}
