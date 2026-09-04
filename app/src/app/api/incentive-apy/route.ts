import { otfLaunchManagerAbi } from "@onchaintradedfunds/generated";
import { createPublicClient, formatUnits, http } from "viem";
import { robinhoodChainTestnet } from "@/lib/chains";
import {
  robinhoodTestnetAddresses,
  robinhoodTestnetRewardsDeployedAtMs,
} from "@/lib/deployment";
import {
  coinGeckoEthUsd,
  incentiveWeekAt,
  OTF_INCENTIVE_WEEKS,
  weeklyEmissionBucketsOtf,
} from "@/lib/incentive-apy";

export const dynamic = "force-dynamic";

async function currentEthUsd() {
  const endpoint = new URL("https://api.coingecko.com/api/v3/simple/price");
  endpoint.searchParams.set("ids", "ethereum");
  endpoint.searchParams.set("vs_currencies", "usd");
  endpoint.searchParams.set("include_last_updated_at", "true");
  const response = await fetch(endpoint, {
    headers: { accept: "application/json" },
    next: { revalidate: 30 },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`COINGECKO_${response.status}`);
  const quote = coinGeckoEthUsd(await response.json());
  if (!quote) throw new Error("COINGECKO_ETH_USD_INVALID");
  return quote;
}

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const chainId = Number(searchParams.get("chainId"));
  const includePrice = searchParams.get("includePrice") !== "false";
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    return Response.json({ error: "INVALID_CHAIN_ID" }, { status: 400 });
  }
  const launchManager = robinhoodTestnetAddresses.launchManager;
  if (chainId !== robinhoodChainTestnet.id || robinhoodTestnetRewardsDeployedAtMs === undefined) {
    return Response.json({ error: "INCENTIVE_APY_UNAVAILABLE" }, { status: 503 });
  }

  const calculatedWeek = incentiveWeekAt(robinhoodTestnetRewardsDeployedAtMs, Date.now());
  if (calculatedWeek === undefined) {
    return Response.json({ error: "INCENTIVE_SCHEDULE_NOT_STARTED" }, { status: 503 });
  }
  const ended = calculatedWeek > OTF_INCENTIVE_WEEKS;
  const buckets = ended
    ? { total: 0, depositors: 0, creators: 0 }
    : weeklyEmissionBucketsOtf(calculatedWeek);
  const schedule = {
    week: ended ? OTF_INCENTIVE_WEEKS : calculatedWeek,
    weeklyEmissionOtf: buckets.total,
    weeklyDepositorEmissionOtf: buckets.depositors,
    weeklyCreatorEmissionOtf: buckets.creators,
    ended,
  };
  if (!includePrice) {
    return Response.json(schedule, { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=60" } });
  }
  if (!launchManager) {
    return Response.json({ error: "INCENTIVE_APY_UNAVAILABLE" }, { status: 503 });
  }

  try {
    const client = createPublicClient({
      chain: robinhoodChainTestnet,
      transport: http(
        process.env.RH_TESTNET_RPC_URL?.trim()
          || process.env.NEXT_PUBLIC_RH_TESTNET_RPC_URL?.trim()
          || robinhoodChainTestnet.rpcUrls.default.http[0],
      ),
    });
    const [otfPriceWethWad, ethUsd] = await Promise.all([
      client.readContract({ address: launchManager, abi: otfLaunchManagerAbi, functionName: "currentOtfPriceWethWad" }),
      currentEthUsd(),
    ]);
    const otfPriceWeth = Number(formatUnits(otfPriceWethWad, 18));
    if (!Number.isFinite(otfPriceWeth) || otfPriceWeth <= 0) throw new Error("OTF_PRICE_INVALID");
    return Response.json({
      ...schedule,
      otfPriceUsd: otfPriceWeth * ethUsd.priceUsd,
      ethUsd: ethUsd.priceUsd,
      priceUpdatedAt: ethUsd.updatedAt,
    }, { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=60" } });
  } catch {
    return Response.json({ error: "INCENTIVE_APY_UNAVAILABLE" }, { status: 503 });
  }
}
