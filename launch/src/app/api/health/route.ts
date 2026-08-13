import { NextResponse } from "next/server";
import { getInfrastructureHealth } from "@/server/infrastructure-health";

export const dynamic = "force-dynamic";

export async function GET() {
  const health = await getInfrastructureHealth();
  return NextResponse.json(health, {
    headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" },
  });
}
