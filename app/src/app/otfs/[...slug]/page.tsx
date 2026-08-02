import { AppRoute } from "@/components/AppRoute";

export default async function OTFPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const lastSegment = slug.at(-1);
  const initialView = lastSegment === "manage"
    ? "manage"
    : lastSegment === "created"
      ? "created"
      : "detail";
  return <AppRoute initialView={initialView} />;
}
