import type { Metadata } from "next";
import { OTF_FAVICON_DATA_URL } from "@onchaintradedfunds/brand";
import "@onchaintradedfunds/brand/styles.css";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  title: { default: "OTF Launch Competition", template: "%s · OTF Launch" },
  description: "Propose, verify and rank the next Onchain Traded Funds.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3001"),
  icons: { icon: OTF_FAVICON_DATA_URL }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><body>
    {/* <!-- DIRECTION
    1. Intent: Operate — compare proposed OTFs, cast progressively unlocked votes, and audit provisional or final XP without conflating it with launch rank.
    2. Composition: A dominant ranked launch leaderboard and a separate dense XP ledger, each using compact evidence rows and focused status summaries.
    3. Typography: The incumbent OTF system stack, compact labels, tabular numerals, and restrained hierarchy.
    4. Color: Dark teal product palette with flat bordered surfaces; status color is sparse and semantic.
    5. Constraints: FORM seed 20c17c66. XP remains separate from launch order; no public launch dates, no decorative raster, 1360px shell, 56px sticky nav, 24/14px gutters, responsive at 1120/760/440px.
    FINISHING-REVIEW: pending
    --> */}
    <Header /><main>{children}</main><Footer />
  </body></html>;
}
