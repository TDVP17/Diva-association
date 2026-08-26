import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// Authenticated only — a person must have an account before using
// "Contribute for a Relative" (per spec). Returns display-only info, never
// email/phone/financial data, so the code can be shared without leaking
// anything beyond what the payer needs to confirm they found the right
// person.
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
