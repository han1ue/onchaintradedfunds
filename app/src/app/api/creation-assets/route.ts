import { fakeEthUsdOracleAbi, otfLaunchManagerAbi, otfTokenAbi } from "@onchaintradedfunds/generated";
import { createPublicClient, http } from "viem";
import { robinhoodTestnetAddresses, robinhoodTestnetCreation } from "@/lib/deployment";
import { creationAssetsFromApi } from "@/lib/creation-model";
import { robinhoodChainTestnet } from "@/lib/chains";
import {
  configuredTestnetCreationAssets,
  marketCapUsdFromYahoo,
  protocolOtfCreationAsset,
  stockPriceUsdFromYahoo,
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

async function currentStockPriceUsd(symbol: string) {
  const endpoint = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`);
  endpoint.searchParams.set("range", "1d");
  endpoint.searchParams.set("interval", "1m");
  try {
    const response = await fetch(endpoint, {
      cache: "no-store",
      headers: { accept: "application/json", "user-agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return undefined;
    return stockPriceUsdFromYahoo(await response.json());
  } catch {
    return undefined;
  }
}

async function currentTestnetStockAssets() {
  const rows = await Promise.all(testnetCreationAssetConfigs.map(async (asset) => {
    const [price, marketCapUsd] = await Promise.all([
      currentStockPriceUsd(asset.symbol),
      currentMarketCapUsd(asset.symbol),
    ]);
    return {
      chainId: robinhoodChainTestnet.id,
      contractAddress: asset.address,
      decimals: asset.decimals,
      symbol: asset.symbol,
      name: asset.name,
      verified: true,
      latestPriceUsdExact: price?.priceUsd,
      latestPriceAt: price?.priceUpdatedAt,
      marketCapUsd,
    };
  }));
  return configuredTestnetCreationAssets({ data: rows }, {});
}

async function currentProtocolOtfAsset() {
  const { otfToken, launchManager, ethUsdOracle } = robinhoodTestnetAddresses;
  if (!otfToken || !launchManager || !ethUsdOracle) return undefined;
  try {
    const client = createPublicClient({
      chain: robinhoodChainTestnet,
      transport: http(
        process.env.RH_TESTNET_RPC_URL?.trim()
          || process.env.NEXT_PUBLIC_RH_TESTNET_RPC_URL?.trim()
          || robinhoodChainTestnet.rpcUrls.default.http[0],
      ),
    });
    const [totalSupply, priceWethWad, oracleRound] = await Promise.all([
      client.readContract({ address: otfToken, abi: otfTokenAbi, functionName: "totalSupply" }),
      client.readContract({ address: launchManager, abi: otfLaunchManagerAbi, functionName: "currentOtfPriceWethWad" }),
      client.readContract({ address: ethUsdOracle, abi: fakeEthUsdOracleAbi, functionName: "latestRoundData" }),
    ]);
    return protocolOtfCreationAsset({
      address: otfToken,
      totalSupply,
      priceWethWad,
      ethUsdAnswer: oracleRound[1],
    });
  } catch {
    return undefined;
  }
}

export async function GET(request: Request) {
  const chainId = Number(new URL(request.url).searchParams.get("chainId"));
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    return Response.json({ error: "INVALID_CHAIN_ID" }, { status: 400 });
  }
  if (chainId === robinhoodChainTestnet.id) {
    const [protocolOtf, stocks] = await Promise.all([
      currentProtocolOtfAsset(),
      currentTestnetStockAssets(),
    ]);
    const assets = [...(protocolOtf ? [protocolOtf] : []), ...stocks];
    if (!assets.length) {
      return Response.json({ error: "ASSET_DATA_UNAVAILABLE" }, { status: 503 });
    }
    return Response.json(
      { data: assets, marketCapSnapshotAt: new Date().toISOString() },
      { headers: { "cache-control": "no-store" } },
    );
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
    const assets = creationAssetsFromApi(payload, chainId);
    if (!assets.length) throw new Error("ASSET_DATA_EMPTY");
    return Response.json(
      { data: assets, marketCapSnapshotAt: new Date().toISOString() },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "ASSET_DATA_UNAVAILABLE" }, { status: 503 });
  }
}
