/**
 * One-off backfill — NOT part of the build or any cron. Run manually once
 * via `npx tsx scripts/backfill-member-codes.ts` (e.g. right after
 * deploying the "generate memberCode at registration" change) to assign a
 * code to every existing user who doesn't have one yet — previously,
 * memberCode was only generated at a user's first membership approval, so
 * older/never-approved accounts can still be null.
 */
import { prisma } from "@/lib/prisma";
import { ensureMemberCode } from "@/lib/member-code";

async function main() {
  const users = await prisma.user.findMany({
    where: { memberCode: null },
    select: { id: true, email: true },
  });

  console.log(`Found ${users.length} user(s) without a member code.`);

  let succeeded = 0;
  let failed = 0;
  for (const user of users) {
    try {
      const code = await ensureMemberCode(user.id);
      console.log(`  ${user.email} -> ${code}`);
      succeeded++;
    } catch (err) {
      console.error(`  FAILED for ${user.email}:`, err);
      failed++;
    }
  }

  console.log(`Done. ${succeeded} succeeded, ${failed} failed.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
