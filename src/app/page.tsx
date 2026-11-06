import { getLang } from "@/lib/i18n/get-lang";
import { LandingPage } from "@/components/landing/landing-page";

export const dynamic = "force-static";
export const revalidate = 3600;

export default async function Home() {
  const lang = await getLang();
  return <LandingPage lang={lang} />;
}
