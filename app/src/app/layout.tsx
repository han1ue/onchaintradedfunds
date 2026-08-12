import type { Metadata } from "next";
import { OTF_FAVICON_DATA_URL } from "@onchaintradedfunds/brand";
import "@onchaintradedfunds/brand/styles.css";
import "./globals.css";
import { AppTopBanner } from "@/components/AppTopBanner";
import { InputBehaviorGuard } from "@/components/InputBehaviorGuard";

export const metadata: Metadata = {
  title: "Onchain Traded Funds",
  description: "Managed onchain traded funds with immutable portfolio safety limits.",
  icons: { icon: OTF_FAVICON_DATA_URL },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script async src="https://www.googletagmanager.com/gtag/js?id=G-7VY28DHL52" />
        <script
          id="gtag-init"
          dangerouslySetInnerHTML={{
            __html:
              "window.dataLayer = window.dataLayer || [];function gtag(){dataLayer.push(arguments);}gtag('js', new Date());gtag('config', 'G-7VY28DHL52');",
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('otf-theme');document.documentElement.dataset.theme=t==='light'||t==='dark'?t:matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';document.documentElement.dataset.palette=localStorage.getItem('otf-palette')==='robinhood'?'robinhood':'default'}catch(e){}",
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
