import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { getSupabaseAdminClient } from "../src/lib/supabase-auth";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const SUPER_ADMIN_EMAIL = "admin@diva-associations.cm";
const SUPER_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Diva-SuperAdmin-2026!";

// Creates (or, if it already exists, resets the password of) the Supabase
// Auth account backing the seeded Super Admin, so the admin@diva-associations.cm
// Prisma row created below is actually loggable-into via the email-password
// provider — not just a database row. Non-fatal on failure: a Supabase
// outage shouldn't block seeding the rest of the demo data.
async function ensureSupabaseAuthAdmin() {
  const supabaseAdmin = getSupabaseAdminClient();
  try {
    const { error } = await supabaseAdmin.auth.admin.createUser({
      email: SUPER_ADMIN_EMAIL,
      password: SUPER_ADMIN_PASSWORD,
      email_confirm: true,
    });
    if (!error) return;

    const { data: list, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    if (listError) {
      console.error("[seed] Could not list Supabase Auth users:", listError.message);
      return;
    }
    const existing = list.users.find((u) => u.email === SUPER_ADMIN_EMAIL);
    if (!existing) {
      console.error("[seed] Could not create or find Supabase Auth admin user:", error.message);
      return;
    }
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(existing.id, {
      password: SUPER_ADMIN_PASSWORD,
    });
    if (updateError) {
      console.error("[seed] Could not reset Supabase Auth admin password:", updateError.message);
    }
  } catch (err) {
    console.error("[seed] Supabase Auth admin setup failed (Prisma row will still be created):", err);
  }
}

async function main() {
  await ensureSupabaseAuthAdmin();

  const admin = await prisma.user.upsert({
    where: { email: SUPER_ADMIN_EMAIL },
    update: {},
    create: {
      email: SUPER_ADMIN_EMAIL,
      name: "Admin DIVA",
      role: "ADMIN",
      accountStatus: "APPROVED",
      city: "Douala",
      neighborhood: "Bonapriso",
      phone: "237670000001",
      sponsorCode: "FOUNDER",
    },
  });

  const members = await Promise.all(
    [
      {
        email: "sarah.jenkins@example.com",
        name: "Sarah Jenkins",
        city: "Douala",
        neighborhood: "Akwa",
        phone: "237670000002",
        sponsorCode: "SPONSOR-01",
      },
      {
        email: "paul.mbarga@example.com",
        name: "Paul Mbarga",
        city: "Yaounde",
        neighborhood: "Bastos",
        phone: "237670000003",
        sponsorCode: "SPONSOR-01",
      },
      {
        email: "claire.fotso@example.com",
        name: "Claire Fotso",
        city: "Douala",
        neighborhood: "Bonanjo",
        phone: "237670000004",
        sponsorCode: "SPONSOR-01",
      },
    ].map((data) =>
      prisma.user.upsert({
        where: { email: data.email },
        update: {},
        create: { ...data, role: "MEMBER", accountStatus: "APPROVED" },
      }),
    ),
  );

  const [sarah, paul, claire] = members;

  // An active weekly session, fully drawn and ranked — shows the dashboard,
  // session detail, and member-status views. Seeded memberships are
  // pre-approved (they're demo data, not real join requests).
  const activeSession = await prisma.tontineSession.create({
    data: {
      type: "HEBDO_SUNDAY",
      amount: 2500,
      fee: 100,
      status: "ACTIVE",
      startDate: new Date(),
      limitTime: "18:30",
    },
  });
  await Promise.all(
    [admin, ...members].map((user, index) =>
      prisma.membership.create({
        data: {
          userId: user.id,
          tontineSessionId: activeSession.id,
          status: "APPROVED",
          officialPosition: index + 1,
          ballDrawn: index + 1,
        },
      }),
    ),
  );

  // A monthly session still in the drawing phase — shows the pseudo-draw UI.
  const drawingSession = await prisma.tontineSession.create({
    data: {
      type: "MONTHLY_28",
      amount: 20000,
      fee: 500,
      status: "DRAWING",
      startDate: new Date(),
      limitTime: "18:30",
    },
  });
  await Promise.all(
    [admin, ...members].map((user) =>
      prisma.membership.create({
        data: { userId: user.id, tontineSessionId: drawingSession.id, status: "APPROVED" },
      }),
    ),
  );

  // Some chat history + swap requests so /chat and the admin dashboard
  // aren't empty on first look.
  await prisma.chatMessage.createMany({
    data: [
      { senderId: sarah.id, receiverId: paul.id, content: "Hi! I noticed you're position #2 in the upcoming cycle." },
      {
        senderId: sarah.id,
        receiverId: paul.id,
        content: "Are we still confirming cycle #4? I have an urgent expense next month.",
      },
      { senderId: paul.id, receiverId: admin.id, content: "I submitted my contribution by bank transfer, ref #TRX-8921." },
      { senderId: admin.id, receiverId: paul.id, content: "Thanks, let me check the clearing account and update you." },
    ],
  });

  await prisma.positionSwapRequest.create({
    data: {
      requesterId: sarah.id,
      targetId: paul.id,
      tontineSessionId: activeSession.id,
      status: "PENDING_MEMBERSHIP",
    },
  });
  await prisma.positionSwapRequest.create({
    data: {
      requesterId: claire.id,
      targetId: sarah.id,
      tontineSessionId: activeSession.id,
      status: "PENDING_ADMIN",
    },
  });

  console.log("Seed complete:", {
    users: members.length + 1,
    sessions: [activeSession.id, drawingSession.id],
  });

  console.log("\n=== Super Admin login (Supabase Auth + Prisma) ===");
  console.log(`Email:    ${SUPER_ADMIN_EMAIL}`);
  console.log(`Password: ${SUPER_ADMIN_PASSWORD}`);
  console.log("====================================================\n");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
