import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "L'échange de position a été retiré du système.", errorKey: "swapDisabled" },
    { status: 410 },
  );
}


