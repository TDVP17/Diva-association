import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const admin = await prisma.user.upsert({
    where: { email: "admin@diva-associations.cm" },
    update: {},
    create: {
      email: "admin@diva-associations.cm",
      name: "Admin DIVA",
      role: "ADMIN",
      kycStatus: "APPROVED",
      city: "Douala",
      neighborhood: "Bonapriso",
    },
  });

  const members = await Promise.all(
    [
      { email: "sarah.jenkins@example.com", name: "Sarah Jenkins", city: "Douala", neighborhood: "Akwa" },
      { email: "paul.mbarga@example.com", name: "Paul Mbarga", city: "Yaounde", neighborhood: "Bastos" },
      { email: "claire.fotso@example.com", name: "Claire Fotso", city: "Douala", neighborhood: "Bonanjo" },
    ].map((data) =>
      prisma.user.upsert({
        where: { email: data.email },
        update: {},
        create: { ...data, role: "MEMBER", kycStatus: "APPROVED" },
      }),
    ),
  );

  const session = await prisma.tontineSession.create({
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
          tontineSessionId: session.id,
          officialPosition: index + 1,
          ballDrawn: index + 1,
        },
      }),
    ),
  );

  console.log("Seed complete:", {
    users: members.length + 1,
    session: session.id,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
