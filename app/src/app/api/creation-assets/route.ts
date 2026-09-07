import { fakeEthUsdOracleAbi, otfLaunchManagerAbi, otfTokenAbi } from "@onchaintradedfunds/generated";
import { createPublicClient, http } from "viem";
import { protocolDeploymentForChain } from "@/lib/deployment";
import { creationAssetsFromApi } from "@/lib/creation-model";
import { mainnetStockAssetsFromRobinhood } from "@/lib/mainnet-creation-assets";
import { fundAssetsVerified } from "@/lib/fund-composition";
import mainnetConfig from "@/config/robinhood-mainnet.json";
import { robinhoodChain, robinhoodChainTestnet } from "@/lib/chains";
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

async function currentProtocolOtfAsset(chainId: number) {
  const { otfToken, launchManager, ethUsdOracle } = protocolDeploymentForChain(chainId)?.addresses ?? {};
  if (!otfToken || !launchManager || !ethUsdOracle) return undefined;
  try {
    const client = createPublicClient({
      chain: chainId === robinhoodChainTestnet.id ? robinhoodChainTestnet : robinhoodChain,
      transport: http(
        chainId === robinhoodChainTestnet.id
          ? process.env.RH_TESTNET_RPC_URL?.trim() || robinhoodChainTestnet.rpcUrls.default.http[0]
          : process.env.RH_MAINNET_RPC_URL?.trim() || robinhoodChain.rpcUrls.default.http[0],
      ),
    });
    const [totalSupply, priceWethWad, oracleRound, oracleDecimals] = await Promise.all([
      client.readContract({ address: otfToken, abi: otfTokenAbi, functionName: "totalSupply" }),
      client.readContract({ address: launchManager, abi: otfLaunchManagerAbi, functionName: "currentOtfPriceWethWad" }),
      client.readContract({ address: ethUsdOracle, abi: fakeEthUsdOracleAbi, functionName: "latestRoundData" }),
      client.readContract({ address: ethUsdOracle, abi: fakeEthUsdOracleAbi, functionName: "decimals" }),
    ]);
    const now = BigInt(Math.floor(Date.now() / 1_000));
    if (oracleDecimals !== 8 || oracleRound[1] <= 0n) return undefined;
    if (chainId === robinhoodChain.id && (oracleRound[3] === 0n || oracleRound[3] > now
      || now - oracleRound[3] > BigInt(mainnetConfig.oracleValidation.maxAgeSeconds))) return undefined;
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
      currentProtocolOtfAsset(chainId),
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

  const endpoint = protocolDeploymentForChain(chainId)?.assetDataEndpoint;
  if (!endpoint) return Response.json({ error: "ASSET_DATA_UNAVAILABLE" }, { status: 503 });

  try {
    const response = await fetch(endpoint, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`ASSET_DATA_${response.status}`);
    const payload = await response.json();
    const [protocolOtf, rows] = await Promise.all([
      currentProtocolOtfAsset(chainId),
      Promise.all(mainnetStockAssetsFromRobinhood(payload).map(async (asset) => {
        const [price, marketCapUsd] = await Promise.all([currentStockPriceUsd(asset.symbol), currentMarketCapUsd(asset.symbol)]);
        return { chainId, contractAddress: asset.address, decimals: asset.decimals, symbol: asset.symbol,
          name: asset.name, verified: fundAssetsVerified(chainId, [asset.address]), latestPriceUsdExact: price?.priceUsd, latestPriceAt: price?.priceUpdatedAt, marketCapUsd };
      })),
    ]);
    const assets = [...(protocolOtf ? [protocolOtf] : []), ...creationAssetsFromApi({ data: rows }, chainId)];
    if (!assets.length) throw new Error("ASSET_DATA_EMPTY");
    return Response.json(
      { data: assets, marketCapSnapshotAt: new Date().toISOString() },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "ASSET_DATA_UNAVAILABLE" }, { status: 503 });
  }
}
