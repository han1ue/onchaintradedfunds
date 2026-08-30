import { robinhoodTestnetCreation } from "@/lib/deployment";
import { creationAssetsFromApi } from "@/lib/creation-model";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const chainId = Number(new URL(request.url).searchParams.get("chainId"));
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    return Response.json({ error: "INVALID_CHAIN_ID" }, { status: 400 });
  }
  const endpoint = robinhoodTestnetCreation.assetDataEndpoint;
  if (!endpoint) return Response.json({ error: "ASSET_DATA_UNAVAILABLE" }, { status: 503 });

  try {
    const response = await fetch(endpoint, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`ASSET_DATA_${response.status}`);
    const assets = creationAssetsFromApi(await response.json(), chainId);
    return Response.json(
      { data: assets, marketCapSnapshotAt: new Date().toISOString() },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "ASSET_DATA_UNAVAILABLE" }, { status: 503 });
  }
}
