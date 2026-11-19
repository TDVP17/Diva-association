-- AlterTable
ALTER TABLE "fallback_payment_configs" ADD COLUMN IF NOT EXISTS "orangeCashInEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "fallback_payment_configs" ADD COLUMN IF NOT EXISTS "orangeCashOutEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "fallback_payment_configs" ADD COLUMN IF NOT EXISTS "orangeCashInDisabledReason" TEXT NOT NULL DEFAULT '';
ALTER TABLE "fallback_payment_configs" ADD COLUMN IF NOT EXISTS "orangeCashOutDisabledReason" TEXT NOT NULL DEFAULT '';
ALTER TABLE "fallback_payment_configs" ADD COLUMN IF NOT EXISTS "mtnCashInEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "fallback_payment_configs" ADD COLUMN IF NOT EXISTS "mtnCashOutEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "fallback_payment_configs" ADD COLUMN IF NOT EXISTS "mtnCashInDisabledReason" TEXT NOT NULL DEFAULT '';
ALTER TABLE "fallback_payment_configs" ADD COLUMN IF NOT EXISTS "mtnCashOutDisabledReason" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE IF NOT EXISTS "notification_clicks" (
    "id" TEXT NOT NULL,
    "notification_id" TEXT,
    "user_id" TEXT,
    "destination" TEXT NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "clicked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_clicks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "notification_clicks_notification_id_idx" ON "notification_clicks"("notification_id");
CREATE INDEX IF NOT EXISTS "notification_clicks_user_id_idx" ON "notification_clicks"("user_id");
CREATE INDEX IF NOT EXISTS "notification_clicks_clicked_at_idx" ON "notification_clicks"("clicked_at");
