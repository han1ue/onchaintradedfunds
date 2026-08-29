import type { Metadata } from "next";
import Script from "next/script";
import { OTF_FAVICON_DATA_URL } from "@onchaintradedfunds/brand";
import "@onchaintradedfunds/brand/styles.css";
import "./globals.css";
import { AppTopBanner } from "@/components/AppTopBanner";
import { InputBehaviorGuard } from "@/components/InputBehaviorGuard";

export const metadata: Metadata = {
  title: "Onchain Traded Funds",
  description: "Oracleless market-cap-at-formation onchain traded funds.",
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
        <InputBehaviorGuard />
        <AppTopBanner />
        {children}
      </body>
    </html>
  );
}
