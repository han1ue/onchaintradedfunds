import type { Metadata } from "next";
import { LiquidityRoute } from "@/components/LiquidityRoute";

export const metadata: Metadata = {
  title: "Liquidity Markets · Onchain Traded Funds",
  description: "Discover OTF liquidity markets and open the network liquidity venue to manage positions.",
};

export default function LiquidityPage() {
  return <LiquidityRoute />;
}
