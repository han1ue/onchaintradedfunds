import type { Metadata } from "next";
import { AppRoute } from "@/components/AppRoute";

export const metadata: Metadata = {
  title: "Wallet",
};

export default function WalletPage() {
  return <AppRoute initialView="wallet" />;
}
