import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Onchain Traded Funds",
  description: "Experimental onchain fund vault dashboard.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
