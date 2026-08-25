import Link from "next/link";

export function TopAppBar({
  userName,
  userImage,
  accountApproved,
}: {
  userName: string;
  userImage: string | null;
  accountApproved: boolean;
}) {
  return (
    <header className="w-full top-0 sticky shadow-sm bg-surface flex items-center justify-between px-container-padding h-16 z-40 shadow-[0px_4px_20px_rgba(30,41,59,0.05)]">
      <Link href="/profile" className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full border-2 border-secondary-fixed-dim overflow-hidden bg-surface-variant flex items-center justify-center flex-shrink-0">
          {userImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={userImage} alt={userName} className="w-full h-full object-cover" />
          ) : (
            <span className="material-symbols-outlined text-outline">person</span>
          )}
        </div>
        <span className="font-title-md text-title-md text-primary hidden sm:block">{userName}</span>
      </Link>
      <span className="font-headline-lg-mobile text-headline-lg-mobile font-bold text-primary tracking-tight sm:hidden">
        DIVA
      </span>
      <span
        className={accountApproved ? "text-primary" : "text-outline"}
        title={accountApproved ? "Account Verified" : "Account Pending"}
      >
        <span
          className="material-symbols-outlined text-2xl"
          style={accountApproved ? { fontVariationSettings: "'FILL' 1" } : undefined}
        >
          verified
        </span>
      </span>
    </header>
  );
}
