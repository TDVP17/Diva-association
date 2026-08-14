import { cookies } from "next/headers";
import { signIn } from "@/auth";
import { SPONSOR_CODE_COOKIE } from "@/lib/constants";

async function signInWithProvider(
  provider: "google" | "apple",
  callbackUrl: string,
  formData: FormData,
) {
  "use server";

  const sponsorCode = String(formData.get("sponsorCode") ?? "").trim();
  if (!sponsorCode) return;

  const cookieStore = await cookies();
  cookieStore.set(SPONSOR_CODE_COOKIE, sponsorCode, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 10,
    path: "/",
  });

  await signIn(provider, { redirectTo: callbackUrl });
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl = "/dashboard" } = await searchParams;
  const signInWithGoogle = signInWithProvider.bind(null, "google", callbackUrl);
  const signInWithApple = signInWithProvider.bind(null, "apple", callbackUrl);

  return (
    <main className="flex-grow flex flex-col items-center justify-center p-container-padding bg-background min-h-screen">
      <div className="w-full max-w-[440px] glass-card rounded-[24px] p-stack-gap-lg sm:p-section-margin relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-secondary-container rounded-full blur-[80px] opacity-20 -mr-10 -mt-10" />
        <div className="absolute bottom-0 left-0 w-32 h-32 bg-primary-container rounded-full blur-[80px] opacity-10 -ml-10 -mb-10" />

        <div className="flex justify-center mb-stack-gap-lg relative z-10">
          <div className="h-24 flex items-center font-headline-lg text-headline-lg text-primary tracking-tight">
            DIVA
          </div>
        </div>

        <div className="text-center mb-section-margin relative z-10">
          <h1 className="font-headline-lg-mobile text-headline-lg-mobile md:font-headline-lg md:text-headline-lg text-on-surface mb-stack-gap-sm">
            Welcome to the Community
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant">
            Sign in to manage your tontines securely.
          </p>
        </div>

        <form className="space-y-stack-gap-md relative z-10">
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

          <div className="relative flex items-center py-stack-gap-sm">
            <div className="flex-grow border-t border-outline-variant" />
            <span className="flex-shrink-0 mx-4 font-label-sm text-label-sm text-outline">
              OR CONTINUE WITH
            </span>
            <div className="flex-grow border-t border-outline-variant" />
          </div>

          <div className="space-y-stack-gap-sm">
            <button
              formAction={signInWithGoogle}
              className="w-full flex items-center justify-center gap-stack-gap-sm bg-white border border-outline-variant rounded-lg py-3 px-4 hover:bg-surface-container-low transition-colors active:scale-[0.98]"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              <span className="font-label-md text-label-md text-on-surface">
                Continue with Google
              </span>
            </button>

            <button
              formAction={signInWithApple}
              className="w-full flex items-center justify-center gap-stack-gap-sm bg-on-background text-white rounded-lg py-3 px-4 hover:opacity-90 transition-opacity active:scale-[0.98]"
            >
              <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.09 2.31-.86 3.65-.74 1.74.15 2.92.8 3.73 1.99-3.25 1.83-2.63 5.96.65 7.21-.76 1.63-1.68 3.12-3.11 3.71zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.02 4.43-3.74 4.25z" />
              </svg>
              <span className="font-label-md text-label-md">Continue with Apple</span>
            </button>
          </div>
        </form>

        <div className="mt-section-margin pt-stack-gap-md border-t border-outline-variant/30 flex items-center justify-center gap-unit text-center relative z-10">
          <span className="material-symbols-outlined text-secondary text-[16px]">lock</span>
          <p className="font-label-sm text-label-sm text-on-surface-variant flex items-center gap-1">
            End-to-end encrypted &amp; KYC verified community platform
          </p>
        </div>
      </div>
    </main>
  );
}
