import type { Metadata } from "next";
import { OTF_FAVICON_DATA_URL } from "@onchaintradedfunds/brand";
import "@onchaintradedfunds/brand/styles.css";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { PUBLIC_SITE_ORIGIN } from "@/config/site";
import { PrelaunchGate } from "@/components/PrelaunchGate";
import { isCompetitionUpcoming } from "@/lib/competition";
import { getCompetition } from "@/server/data";

export const metadata: Metadata = {
  title: { default: "OTF Launch Competition", template: "%s · OTF Launch" },
  description: "Propose, verify and rank the next Onchain Traded Funds.",
  metadataBase: new URL(PUBLIC_SITE_ORIGIN),
  icons: { icon: OTF_FAVICON_DATA_URL }
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const competition = await getCompetition();
  const upcoming = isCompetitionUpcoming(competition.startsAt);

  return <html lang="en" suppressHydrationWarning><body>
    {/* <!-- DIRECTION
    1. Intent: Operate — compare proposed OTFs, cast progressively unlocked votes, and understand the XP allocation model.
    2. Composition: A dominant ranked launch leaderboard and a separate explanation-first XP allocation page with one pool graph and compact formula rows.
    3. Typography: The incumbent OTF system stack, compact labels, tabular numerals, and restrained hierarchy.
    4. Color: Dark teal product palette with flat bordered surfaces; status color is sparse and semantic.
    5. Constraints: FORM seed 20c17c66. No provisional XP calculations or balances; XP remains separate from launch order; no public launch dates, no decorative raster, 1360px shell, 56px sticky nav, 24/14px gutters, responsive at 1120/760/440px.
    FINISHING-REVIEW: pending
    --> */}
    {upcoming
      ? <PrelaunchGate startsAt={competition.startsAt} />
      : <><Header /><main>{children}</main><Footer /></>}
  </body></html>;
}
