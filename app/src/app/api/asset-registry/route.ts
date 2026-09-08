import { readRegistry } from "@/server/registry";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const chainId = Number(params.get("chainId"));
  if (![4663,46630].includes(chainId)) return Response.json({ error: "INVALID_CHAIN_ID" }, { status: 400 });
  try {
    const registry = await readRegistry(chainId);
    const includeUnverified = params.get("includeUnverified") === "true";
    const assets = registry.assets.filter(asset => asset.enabled && (includeUnverified || asset.verified));
    const included=new Set(assets.map(asset=>asset.address.toLowerCase()));
    return Response.json({ assets, pools: registry.pools.filter(pool => pool.enabled && pool.approved && included.has(pool.assetA.address.toLowerCase()) && included.has(pool.assetB.address.toLowerCase())) }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "REGISTRY_UNAVAILABLE", message: "Asset registry unavailable. Refresh to try again." }, { status: 503 });
  }
}
