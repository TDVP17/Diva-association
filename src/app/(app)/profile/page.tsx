import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";

export default async function ProfilePage() {
  const session = await auth();
  const user = await prisma.user.findUnique({
    where: { id: session!.user.id },
    select: { name: true, email: true, avatar: true, image: true, phone: true, city: true, neighborhood: true, kycStatus: true, role: true },
  });
  if (!user) return null;

  const rows: Array<[string, string]> = [
    ["Email", user.email],
    ["Phone", user.phone ?? "Not set"],
    ["City", user.city ?? "—"],
    ["Neighborhood", user.neighborhood ?? "—"],
    ["KYC Status", user.kycStatus],
    ["Role", user.role],
  ];

  return (
    <main className="px-container-padding py-stack-gap-lg max-w-md mx-auto">
      <div className="flex flex-col items-center mb-stack-gap-lg">
        <div className="w-24 h-24 rounded-full border-2 border-secondary-fixed-dim overflow-hidden bg-surface-variant flex items-center justify-center mb-3">
          {user.avatar || user.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.avatar ?? user.image!} alt={user.name} className="w-full h-full object-cover" />
          ) : (
            <span className="material-symbols-outlined text-4xl text-outline">person</span>
          )}
        </div>
        <h1 className="font-title-md text-title-md text-primary">{user.name}</h1>
      </div>

      <div className="bg-white rounded-xl shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant overflow-hidden mb-stack-gap-lg">
        {rows.map(([label, value], i) => (
          <div
            key={label}
            className={`flex justify-between items-center px-4 py-3 ${i < rows.length - 1 ? "border-b border-surface-variant" : ""}`}
          >
            <span className="font-label-sm text-label-sm text-on-surface-variant">{label}</span>
            <span className="font-label-md text-label-md text-on-surface">{value}</span>
          </div>
        ))}
      </div>

      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/login" });
        }}
      >
        <button
          type="submit"
          className="w-full py-3 rounded-lg border-2 border-error text-error font-label-md text-label-md hover:bg-error/5 active:scale-95 transition-all"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
