import { redirect } from "next/navigation";
import { auth, updateSession } from "@/auth";
import { prisma } from "@/lib/prisma";

async function saveSponsorCode(formData: FormData) {
  "use server";

  const session = await auth();
  if (!session?.user) redirect("/login");

  const sponsorCode = String(formData.get("sponsorCode") ?? "").trim();
  if (!sponsorCode) return;

  await prisma.user.update({
    where: { id: session.user.id },
    data: { sponsorCode },
  });

  await updateSession({ user: { sponsorCode } });
  redirect("/dashboard");
}

export default async function SponsorOnboardingPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.sponsorCode) redirect("/dashboard");

  return (
    <main className="flex-grow flex flex-col items-center justify-center p-container-padding bg-background min-h-screen">
      <div className="w-full max-w-[440px] bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] p-section-margin">
        <h1 className="font-headline-lg-mobile text-headline-lg-mobile text-primary mb-stack-gap-sm">
          One last step
        </h1>
        <p className="font-body-md text-body-md text-on-surface-variant mb-stack-gap-lg">
          Enter the sponsor or garant code you were given to finish creating
          your account.
        </p>
        <form action={saveSponsorCode} className="space-y-stack-gap-md">
          <div className="floating-label-group">
            <input
              className="floating-input"
              id="sponsorCode"
              name="sponsorCode"
              placeholder=" "
              required
              type="text"
            />
            <label className="floating-label" htmlFor="sponsorCode">
              Sponsor/Garant Code or Phone
            </label>
          </div>
          <button
            type="submit"
            className="w-full py-3 px-4 rounded-lg bg-primary text-on-primary font-label-md text-label-md text-center shadow-md hover:opacity-90 active:scale-95 transition-all"
          >
            Continue
          </button>
        </form>
      </div>
    </main>
  );
}
