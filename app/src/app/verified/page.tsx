import type { Metadata } from "next";
import { AppRoute } from "@/components/AppRoute";

export const metadata: Metadata = {
  title: "Verified Assets",
};

export default function VerifiedPage() {
  return <AppRoute initialView="verified" />;
}
