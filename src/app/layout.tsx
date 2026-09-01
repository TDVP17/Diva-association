import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { RegisterServiceWorker } from "@/components/register-service-worker";
import { getLang } from "@/lib/i18n/get-lang";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const APP_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
const SITE_TITLE = "DIVA Association";
const SITE_DESCRIPTION = "Automated, secure management for traditional tontine (cotisation) savings groups.";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: { default: SITE_TITLE, template: `%s — ${SITE_TITLE}` },
  description: SITE_DESCRIPTION,
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: "/",
    siteName: SITE_TITLE,
    type: "website",
    // Image itself comes from the opengraph-image.tsx file-convention route
    // at the app root — Next.js wires its <meta> tags in automatically.
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const lang = await getLang();
  return (
    <html lang={lang} className={`${inter.variable} h-full antialiased`}>
      <head>
        {/* Speeds up the icon-font fetch below (DNS+TLS ahead of the actual
            request) — without this, dozens of material-symbols-outlined
            spans across icon-heavy pages (e.g. the admin dashboard) all pop
            in from invisible to their real glyph in the same frame once the
            font finally arrives, forcing a single large layout recompute. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- App Router layout is the single shared root, unlike pages/_app.js which this rule targets */}
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
        <meta name="theme-color" content="#003528" />
      </head>
      <body className="min-h-full flex flex-col">
        <RegisterServiceWorker />
        {children}
      </body>
    </html>
  );
}
