import { robinhoodTestnetCreation } from "@/lib/deployment";
import { creationAssetsFromApi } from "@/lib/creation-model";
import { robinhoodChainTestnet } from "@/lib/chains";
import {
  configuredTestnetCreationAssets,
  marketCapUsdFromYahoo,
  testnetCreationAssetConfigs,
} from "@/lib/testnet-creation-assets";

export const dynamic = "force-dynamic";

async function currentMarketCapUsd(symbol: string): Promise<string | undefined> {
  const nowSeconds = Math.floor(Date.now() / 1_000);
  const period1 = nowSeconds - 400 * 24 * 60 * 60;
  const endpoint = new URL(`https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${symbol}`);
  endpoint.searchParams.set("symbol", symbol);
  endpoint.searchParams.set("type", "quarterlyMarketCap,trailingMarketCap");
  endpoint.searchParams.set("period1", String(period1));
  endpoint.searchParams.set("period2", String(nowSeconds + 24 * 60 * 60));
  try {
    const response = await fetch(endpoint, {
      cache: "no-store",
      headers: { accept: "application/json", "user-agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return undefined;
    return marketCapUsdFromYahoo(await response.json());
  } catch {
    return undefined;
  }
}

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
    const payload = await response.json();
    const assets = chainId === robinhoodChainTestnet.id
      ? configuredTestnetCreationAssets(
        payload,
        Object.fromEntries(await Promise.all(testnetCreationAssetConfigs.map(async (asset) => (
          [asset.symbol, await currentMarketCapUsd(asset.symbol)] as const
        )))),
      )
      : creationAssetsFromApi(payload, chainId);
    if (!assets.length) throw new Error("ASSET_DATA_EMPTY");
    return Response.json(
      { data: assets, marketCapSnapshotAt: new Date().toISOString() },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "ASSET_DATA_UNAVAILABLE" }, { status: 503 });
  }
}
