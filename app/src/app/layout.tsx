import type { Metadata } from "next";
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
      <body>{children}</body>
    </html>
  );
}
