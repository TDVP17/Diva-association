import { redirect } from "next/navigation";
import { auth } from "@/auth";

/**
 * Public entry point for contributing on a member's behalf (e.g. from WhatsApp links).
 * Strictly requires the user to be signed in or registered.
 * Seamlessly redirects authenticated users into the in-app relative pay flow
 * at /contribute-for-relative with the target member code pre-loaded.
 */
export default async function PublicPayPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  const target = code
    ? `/contribute-for-relative?code=${encodeURIComponent(code)}`
    : "/contribute-for-relative";

  const session = await auth();
  if (!session?.user) {
    redirect(`/login?callbackUrl=${encodeURIComponent(target)}&authRequired=1`);
  }

  redirect(target);
}
