import { AppRoute } from "@/components/AppRoute";
import { rootViewForHost } from "@/lib/app-host-routing";
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host");

  return <AppRoute initialView={rootViewForHost(host)} />;
}
