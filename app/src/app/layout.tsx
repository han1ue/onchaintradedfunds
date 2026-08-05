import type { Metadata } from "next";
import { AlertTriangle } from "lucide-react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Onchain Traded Funds",
  description: "Managed onchain traded funds with immutable portfolio safety limits.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('otf-theme');document.documentElement.dataset.theme=t==='light'||t==='dark'?t:matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';document.documentElement.dataset.palette=localStorage.getItem('otf-palette')==='robinhood'?'robinhood':'default'}catch(e){}",
          }}
        />
      </head>
      <body>
        <aside className="testnetWarningBanner" aria-label="Testnet risk warning">
          <div>
            <AlertTriangle aria-hidden="true" size={13} strokeWidth={2.2} />
            <strong>Testnet</strong>
            <span className="testnetWarningDesktop">
              Contracts may be redeployed. Assets may be lost.
            </span>
            <span className="testnetWarningMobile">
              Contracts may be redeployed. Assets may be lost.
            </span>
          </div>
        </aside>
        {children}
      </body>
    </html>
  );
}
