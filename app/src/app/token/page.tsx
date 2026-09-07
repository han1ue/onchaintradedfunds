import type { Metadata } from "next";
import { AppRoute } from "@/components/AppRoute";

export const metadata: Metadata = {
  title: "$OTF",
};

export default function TokenPage() {
  return <AppRoute initialView="token" />;
}
