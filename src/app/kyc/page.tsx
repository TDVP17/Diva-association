import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { KycWizard } from "./kyc-wizard";

export default async function KycPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      kycStatus: true,
      city: true,
      neighborhood: true,
      phone: true,
      cniFrontUrl: true,
      cniBackUrl: true,
      selfieUrl: true,
    },
  });
  if (!user) redirect("/login");

  if (user.kycStatus === "APPROVED") {
    redirect("/dashboard");
  }

  const alreadySubmitted =
    user.kycStatus === "PENDING" && !!(user.cniFrontUrl && user.cniBackUrl && user.selfieUrl);

  if (alreadySubmitted) {
    return (
      <main className="px-container-padding pt-stack-gap-lg pb-section-margin max-w-md mx-auto min-h-screen flex flex-col items-center justify-center text-center gap-stack-gap-md">
        <span className="material-symbols-outlined text-primary text-5xl">hourglass_top</span>
        <h1 className="font-title-md text-title-md text-primary">Verification in progress</h1>
        <p className="font-body-md text-body-md text-on-surface-variant">
          Your documents were submitted and are awaiting review. We&rsquo;ll
          notify you as soon as your account is approved.
        </p>
      </main>
    );
  }

  return (
    <KycWizard
      rejected={user.kycStatus === "REJECTED"}
      initialCity={user.city ?? ""}
      initialNeighborhood={user.neighborhood ?? ""}
      initialPhone={user.phone ?? ""}
    />
  );
}
