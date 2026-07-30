import { AppRoute } from "@/components/AppRoute";

export default async function OTFPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  return <AppRoute initialView={slug.at(-1) === "manage" ? "manage" : "detail"} />;
}
