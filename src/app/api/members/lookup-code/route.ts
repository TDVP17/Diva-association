import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Deliberately no auth() call — a relative/friend without a DIVA account
// must be able to look a member up by their personal code and contribute
// on their behalf (see /pay, the public entry point). Returns display-only
// info, never email/phone/financial data, so the code can be shared
// without leaking anything beyond what the payer needs to confirm they
// found the right person.
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code")?.trim().toUpperCase();
  if (!code) {
    return NextResponse.json({ error: "Missing code" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { memberCode: code },
    select: { id: true, name: true, avatar: true, image: true },
  });
  if (!user) {
    return NextResponse.json({ error: "No member found with this code" }, { status: 404 });
  }

  const unpaidFines = await prisma.fine.aggregate({
    where: { membershipSlot: { membership: { userId: user.id } }, status: "UNPAID" },
    _sum: { amount: true },
  });

  return NextResponse.json({
    memberCode: code,
    name: user.name,
    avatar: user.avatar ?? user.image,
    hasUnpaidFines: Number(unpaidFines._sum.amount ?? 0) > 0,
    totalUnpaidFines: Number(unpaidFines._sum.amount ?? 0),
  });
}
