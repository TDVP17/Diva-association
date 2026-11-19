import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { settlePendingFapshiDeposit } from "@/lib/wallet-reconcile";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const transId = searchParams.get("transId");
  if (!transId) {
    return NextResponse.json({ error: "transId manquant" }, { status: 400 });
  }

  try {
    const result = await settlePendingFapshiDeposit(transId);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/wallet/topup/status GET] error:", err);
    return NextResponse.json(
      { error: "Erreur lors de la vérification de la transaction" },
      { status: 500 },
    );
  }
}

