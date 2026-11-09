import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/require-admin";
import { logAudit } from "@/lib/audit";
import {
  getFallbackPaymentConfig,
  setFallbackPaymentConfig,
} from "@/lib/fallback-payment-config";

const updateSchema = z.object({
  isEnabled: z.boolean().optional().default(true),
  orangeUssdCode: z.string().max(120).optional().default(""),
  orangeBeneficiaryName: z.string().max(160).optional().default(""),
  mtnUssdCode: z.string().max(120).optional().default(""),
  mtnBeneficiaryName: z.string().max(160).optional().default(""),
  isOrangeSuspended: z.boolean().optional().default(false),
  orangeSuspendedReason: z.string().max(300).optional().default(""),
  isMtnSuspended: z.boolean().optional().default(false),
  mtnSuspendedReason: z.string().max(300).optional().default(""),
});

export async function GET() {
  try {
    const config = await getFallbackPaymentConfig();
    return NextResponse.json(config);
  } catch (err) {
    console.error("[fallback-config GET] unexpected error:", err);
    return NextResponse.json(
      {
        isEnabled: true,
        orangeUssdCode: "",
        orangeBeneficiaryName: "",
        mtnUssdCode: "",
        mtnBeneficiaryName: "",
        isOrangeSuspended: false,
        orangeSuspendedReason: "",
        isMtnSuspended: false,
        mtnSuspendedReason: "",
      },
      { status: 200 },
    );
  }
}

export async function PUT(request: Request) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const before = await getFallbackPaymentConfig();
    const saved = await setFallbackPaymentConfig(parsed.data, admin.user.id);

    await logAudit({
      actorId: admin.user.id,
      actorRole: admin.user.role,
      action: "fallback_payment_config_updated",
      targetType: "SecuritySettings",
      targetId: "singleton",
      payloadBefore: JSON.parse(JSON.stringify(before)),
      payloadAfter: JSON.parse(JSON.stringify(saved)),
      request,
    });

    revalidatePath("/admin/settings");
    return NextResponse.json({ ok: true, config: saved });
  } catch (err) {
    console.error("[fallback-config PUT] unexpected error:", err);
    return NextResponse.json(
      { error: "Impossible d'enregistrer la configuration de secours." },
      { status: 500 },
    );
  }
}

