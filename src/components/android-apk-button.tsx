import { translate, type Lang } from "@/lib/i18n/translations";

/**
 * No Android build toolchain exists in this environment (no Java/Android
 * SDK/signing tools), so no .apk is produced here. Once a real signed APK
 * exists (easiest path: paste the deployed site's URL into pwabuilder.com,
 * which reads the PWA manifest already in place at /manifest.json and
 * packages a signed Android app) and is hosted anywhere public, set
 * NEXT_PUBLIC_ANDROID_APK_URL to that file's URL — the button below then
 * goes live automatically. Until set, nothing is rendered rather than
 * shipping a dead/misleading link.
 */
const ANDROID_APK_URL = process.env.NEXT_PUBLIC_ANDROID_APK_URL;

export function AndroidApkButton({ lang }: { lang: Lang }) {
  if (!ANDROID_APK_URL) return null;
  const t = (key: Parameters<typeof translate>[1]) => translate(lang, key);

  return (
    <a
      href={ANDROID_APK_URL}
      download
      className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-white shadow-[0px_4px_20px_rgba(30,41,59,0.05)] border border-surface-variant hover:bg-surface-container-low transition-colors"
    >
      <span className="flex items-center gap-3">
        <span className="material-symbols-outlined text-primary">android</span>
        <span className="text-left">
          <span className="block font-label-md text-label-md text-on-surface">{t("downloadAndroidApk")}</span>
          <span className="block font-label-sm text-label-sm text-on-surface-variant">
            {t("downloadAndroidApkDescription")}
          </span>
        </span>
      </span>
      <span className="material-symbols-outlined text-outline">download</span>
    </a>
  );
}
