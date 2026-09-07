import type { Metadata } from "next";
import { AppRoute } from "@/components/AppRoute";

export const metadata: Metadata = {
  title: "Launch OTF",
};

export default function LaunchOTFPage() {
  return <AppRoute initialView="launch" />;
}
