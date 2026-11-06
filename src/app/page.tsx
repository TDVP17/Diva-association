import { getLang } from "@/lib/i18n/get-lang";
import { LandingPage } from "@/components/landing/landing-page";
import { EmergencyLockedScreen } from "@/components/emergency-locked-screen";
import { isAppLocked } from "@/lib/security";

export default async function Home() {
  const lang = await getLang();
  const locked = await isAppLocked();
  if (locked) {
    return <EmergencyLockedScreen lang={lang} />;
  }
  return <LandingPage lang={lang} />;
}
