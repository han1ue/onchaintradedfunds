import type { Metadata } from "next";
import { AppRoute } from "@/components/AppRoute";

export const metadata: Metadata = {
  title: "Funds",
};

export default function FundsPage() {
  return <AppRoute initialView="vaults" />;
}
