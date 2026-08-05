import type { Metadata } from "next";
import { LiquidityRoute } from "@/components/LiquidityRoute";

export const metadata: Metadata = {
  title: "Testnet Liquidity · Onchain Traded Funds",
  description: "Add or remove full-range Synthra V3 liquidity on Robinhood Chain Testnet.",
};

export default function LiquidityPage() {
  return <LiquidityRoute />;
}
