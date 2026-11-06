import { prisma } from "../src/lib/prisma";

async function main() {
  console.log("Checking RLS status on all public tables...");
  
  // 1. Fetch all public tables
  const tables = await prisma.$queryRaw<Array<{ tablename: string; rowsecurity: boolean }>>`
    SELECT tablename, rowsecurity 
    FROM pg_tables 
    WHERE schemaname = 'public'
    ORDER BY tablename ASC;
  `;

  console.log(`Found ${tables.length} tables in schema 'public'.`);

  // 2. Enable RLS on every table that doesn't have it enabled yet
  for (const table of tables) {
    if (!table.rowsecurity) {
      console.log(`Enabling RLS on: "${table.tablename}"...`);
      // Table name is an identifier from pg_tables, safe to quote
      await prisma.$executeRawUnsafe(`ALTER TABLE "public"."${table.tablename}" ENABLE ROW LEVEL SECURITY;`);
    }
  }

  // 3. Final verification: Check that 100% of public tables have rowsecurity = true
  const updatedTables = await prisma.$queryRaw<Array<{ tablename: string; rowsecurity: boolean }>>`
    SELECT tablename, rowsecurity 
    FROM pg_tables 
    WHERE schemaname = 'public'
    ORDER BY tablename ASC;
  `;

  console.log("\n================ RLS AUDIT REPORT ================");
  let allEnabled = true;
  for (const t of updatedTables) {
    console.log(`[${t.rowsecurity ? "SECURE / RLS ACTIVE" : "UNSECURE"}] ${t.tablename}`);
    if (!t.rowsecurity) allEnabled = false;
  }
  console.log("=================================================");
  console.log(`Total tables: ${updatedTables.length}`);
  console.log(`Tables with RLS active: ${updatedTables.filter(t => t.rowsecurity).length}`);
  console.log(`Tables without RLS: ${updatedTables.filter(t => !t.rowsecurity).length}`);
  console.log(`100% RLS Coverage: ${allEnabled ? "SUCCESS (100%)" : "FAILED"}`);

  if (!allEnabled) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Error enforcing RLS:", err);
  process.exit(1);
});
