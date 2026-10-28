import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import localFont from "next/font/local";
import "../globals.css";
import "../app.css";
import { I18nProvider } from "@/components/I18n";
import { clientDict } from "@/lib/i18n/meta";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { ServiceWorker } from "@/components/ServiceWorker";
import { ExtensionHandoff } from "@/components/ExtensionHandoff";
import { PointerLight } from "@/components/PointerLight";
import { AppShell } from "@/components/AppShell";
import { EGRESS_SCRIPT } from "@/lib/egress";
import { Welcome } from "@/components/Welcome";
import { PageTransition } from "@/components/PageTransition";
import { CommandBar } from "@/components/CommandBar";
import { InstallSheet } from "@/components/InstallGuide";
import { getDictionary } from "@/lib/i18n/dictionary";
import { hasLocale, isRtl, LOCALE_CODES } from "@/lib/i18n/locales";
import { BRAND, SITE_URL } from "@/lib/brand";
import { THEME_SCRIPT } from "@/lib/theme";
import { DEVICE_SCRIPT } from "@/lib/device";

// Committed in src/app/fonts, so builds never reach out to a font CDN.
const sans = localFont({ src: "../fonts/Geist-Variable.woff2", variable: "--font-geist-sans", weight: "100 900" });
const mono = localFont({ src: "../fonts/GeistMono-Variable.woff2", variable: "--font-geist-mono", weight: "100 900" });
// Handwriting, for the app's welcome (src/components/Welcome.tsx): fetched only there.
const hand = localFont({ src: "../fonts/Caveat-Variable.woff2", variable: "--font-hand", weight: "400 700", preload: false });

export function generateStaticParams() {
  return LOCALE_CODES.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: LayoutProps<"/[lang]">): Promise<Metadata> {
  const { lang } = await params;
  if (!hasLocale(lang)) return {};
  const t = await getDictionary(lang);
  // Canonical and language links are per page (src/lib/seo.ts).
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: `${BRAND.name}: ${t["home.title"]}`, template: `%s · ${BRAND.name}` },
    description: t["home.subtitle"],
    applicationName: BRAND.name,
    icons: {
      icon: [{ url: "/favicon.ico", sizes: "48x48" }, { url: "/icon.svg", type: "image/svg+xml" }],
      apple: "/apple-touch-icon.png",
    },
    manifest: "/manifest.webmanifest",
    // Opened from an iPhone's or iPad's home screen: full screen, the page
    // under a see-through status bar (app.css keeps clear of it).
    appleWebApp: { capable: true, title: BRAND.name, statusBarStyle: "black-translucent" },
  };
}

export const viewport: Viewport = {
  // Edge to edge on phones with rounded corners and notches; the app's bars
  // pad themselves with the safe-area insets.
  viewportFit: "cover",
  themeColor: [
    // Dark unless light was chosen (src/lib/theme.ts), whatever the device says.
    { media: "(prefers-color-scheme: light)", color: "#000000" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default async function RootLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dict = await getDictionary(lang);
  return (
    // Dark as built; THEME_SCRIPT sets the chosen theme before the first paint
    // (suppressHydrationWarning: so data-theme can differ from what React built).
    <html lang={lang} dir={isRtl(lang) ? "rtl" : "ltr"} data-theme="dark" className={`${sans.variable} ${mono.variable} ${hand.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: DEVICE_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: EGRESS_SCRIPT }} />
      </head>
      <body className="flex min-h-dvh flex-col">
        {/* Soft light drifting behind the page (globals.css .ambient). */}
        <div aria-hidden className="ambient"><i /><i /></div>
        <I18nProvider locale={lang} dict={clientDict(dict)}>
          <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2">
            {dict["nav.skip"]}
          </a>
          <Header />
          {/* Decoration hangs past the edges; clip it without making a scroll container (sticky still works). */}
          <main id="main" className="flex-1 overflow-x-clip">
            <ExtensionHandoff />
            <PageTransition>{children}</PageTransition>
          </main>
          <Footer />
          <ServiceWorker />
          <PointerLight />
          <AppShell />
          <Welcome />
          <CommandBar />
          <InstallSheet />
        </I18nProvider>
      </body>
    </html>
  );
}
