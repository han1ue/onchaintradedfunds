import type { Metadata } from "next";
import Script from "next/script";
import { OTF_FAVICON_DATA_URL } from "@onchaintradedfunds/brand";
import "@onchaintradedfunds/brand/styles.css";
import "./globals.css";
import { AppTopBanner } from "@/components/AppTopBanner";
import { InputBehaviorGuard } from "@/components/InputBehaviorGuard";

export const metadata: Metadata = {
  title: "Onchain Traded Funds",
  description: "Managed onchain traded funds with enforceable portfolio safety limits.",
  icons: { icon: OTF_FAVICON_DATA_URL },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <head>
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
OWN-WORLD: A blue-black field, near-white lowercase Instrument Sans lockup, scarce teal flow geometry, and one pale rectangular entry control.
STORY: Read the product name, absorb “the standard for the new era,” then enter the existing app; no added claims or proof blocks.
FIRST VIEWPORT: Full viewport below the warning; title and tagline on the left, convergence field on the right, CTA lower-right on desktop and lower-left on mobile.
FORM: User-pinned minimal splash; code-led established-world extension; form 1 of 1; seed user-pinned-no-roll.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
-->`,
          }}
        />
        <InputBehaviorGuard />
        <AppTopBanner />
        {children}
      </body>
    </html>
  );
}
