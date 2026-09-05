import type { Metadata } from "next";
import Script from "next/script";
import otfFavicon from "@onchaintradedfunds/brand/assets/otf-favicon.svg";
import "./globals.css";
import { AppTopBanner } from "@/components/AppTopBanner";
import { InputBehaviorGuard } from "@/components/InputBehaviorGuard";
import { PersistentAppShell } from "@/components/PersistentAppShell";
import { rootViewForHost } from "@/lib/app-host-routing";
import { headers } from "next/headers";

export const metadata: Metadata = {
  title: "Onchain Traded Funds",
  description: "Managed onchain traded funds with enforceable portfolio safety limits.",
  icons: { icon: { url: otfFavicon.src, type: "image/svg+xml", sizes: "any" } },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const requestHeaders = await headers();
  const showOperatingRoot = rootViewForHost(requestHeaders.get("host")) === "swap";

  return (
    <html lang="en" data-scroll-behavior="smooth">
      <head>
        <Script
          id="appearance-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: "try{const saved=localStorage.getItem('otf-theme');const theme=saved==='light'||saved==='dark'?saved:matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';document.documentElement.dataset.theme=theme}catch{}",
          }}
        />
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-7VY28DHL52"
          strategy="afterInteractive"
        />
        <Script
          id="gtag-init"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html:
              "window.dataLayer = window.dataLayer || [];function gtag(){dataLayer.push(arguments);}gtag('js', new Date());gtag('config', 'G-7VY28DHL52');",
          }}
        />
      </head>
      <body>
        <template
          data-impeccable-direction="user-pinned-no-roll"
          dangerouslySetInnerHTML={{
            __html: `<!--
THESIS: A stark entry plate where many market lines converge into one OTF; it refuses the former long marketing page and any card-based hero.
OWN-WORLD: A black Robinhood field, near-white lowercase Instrument Sans lockup, scarce lime flow geometry, and one lime entry control.
STORY: Read the product name, absorb “the standard for the new era,” then enter the existing app; no added claims or proof blocks.
FIRST VIEWPORT: Full viewport below the warning; title and tagline on the left, convergence field on the right, CTA lower-right on desktop and lower-left on mobile.
FORM: User-pinned minimal splash; code-led established-world extension; form 1 of 1; seed user-pinned-no-roll.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
-->`,
          }}
        />
        <InputBehaviorGuard />
        <AppTopBanner />
        <PersistentAppShell showOnRoot={showOperatingRoot}>{children}</PersistentAppShell>
      </body>
    </html>
  );
}
