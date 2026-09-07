import type { Metadata } from "next";
import { AppRoute } from "@/components/AppRoute";

export const metadata: Metadata = {
  title: "OTF",
};

export default function FundPage() {
  return <AppRoute initialView="detail" />;
}
