import { prisma } from "../src/lib/prisma";

async function main() {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE app_settings 
    ADD COLUMN IF NOT EXISTS withdrawal_approval_threshold NUMERIC(12, 2) NOT NULL DEFAULT 50000;
  `);
  console.log("app_settings.withdrawal_approval_threshold added successfully.");

  await prisma.$executeRawUnsafe(`
    ALTER TABLE fines 
    ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;
  `);
  console.log("fines.paid_amount added successfully.");

  const setting = await prisma.appSetting.findFirst();
  console.log("Current appSetting:", setting);
}

main()
  .catch((e) => {
    console.error("Migration error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

