import { prisma } from "@/lib/prisma";

const SINGLETON_ID = "singleton";

export async function getAssociationRules(): Promise<string> {
  const row = await prisma.associationRules.findUnique({ where: { id: SINGLETON_ID } });
  return row?.content ?? "";
}

export async function setAssociationRules(content: string, adminId: string): Promise<void> {
  await prisma.associationRules.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, content, updatedByAdminId: adminId },
    update: { content, updatedByAdminId: adminId },
  });
}
