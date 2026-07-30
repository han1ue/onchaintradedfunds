import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Onchain Traded Funds",
  description: "Managed ERC-4626 portfolio vaults with immutable onchain safety limits.",
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
