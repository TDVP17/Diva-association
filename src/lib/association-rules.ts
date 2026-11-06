import { prisma } from "@/lib/prisma";
import { unstable_cache, revalidateTag } from "next/cache";

const SINGLETON_ID = "singleton";

export const getAssociationRules = unstable_cache(
  async (): Promise<string> => {
    const row = await prisma.associationRules.findUnique({ where: { id: SINGLETON_ID } });
    return row?.content ?? "";
  },
  ["association-rules"],
  {
    revalidate: 3600,
    tags: ["association-rules"],
  }
);

export async function setAssociationRules(content: string, adminId: string): Promise<void> {
  await prisma.associationRules.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, content, updatedByAdminId: adminId },
    update: { content, updatedByAdminId: adminId },
  });
  revalidateTag("association-rules", "max");
}
