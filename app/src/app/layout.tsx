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
              "try{document.documentElement.dataset.theme=localStorage.getItem('otf-theme')==='light'?'light':'dark'}catch(e){}",
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
