import type { Metadata } from "next";
import { AppRoute } from "@/components/AppRoute";

export const metadata: Metadata = {
  title: "Liquidity Markets · Onchain Traded Funds",
  description: "Discover OTF liquidity markets and open the network liquidity venue to manage positions.",
};

export default function LiquidityPage() {
  return <AppRoute initialView="liquidity" />;
}
