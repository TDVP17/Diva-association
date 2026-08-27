import { getLang } from "@/lib/i18n/get-lang";
import { AppLoadingScreen } from "@/components/app-loading-screen";

export default async function AppSegmentLoading() {
  const lang = await getLang();
  return <AppLoadingScreen lang={lang} />;
}
