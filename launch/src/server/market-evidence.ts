import { eq } from "drizzle-orm";
import {
  evaluateMarketEvidence,
  type MarketEvidenceInput,
} from "@/lib/market-evidence-policy";
import { getCoinGeckoClient } from "./coingecko";
import { requireDb } from "./db";
import { assetEligibilitySnapshots, assetMarkets, competitions, eligibleAssets } from "./db/schema";
import { env } from "./env";
type MarketRow = {
  id: string;
  marketId: string;
  poolAddress: string;
  factoryAddress: string;
  quoteTokenAddress: string;
  feeTier: number;
  assetAddress: string;
};

function finiteNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function fetchProviderEvidence(market: MarketRow) {
  const providerErrors: string[] = [];
  let tokenData: Awaited<ReturnType<ReturnType<typeof getCoinGeckoClient>["getToken"]>> | null = null;
  let tokenInfo: Awaited<ReturnType<ReturnType<typeof getCoinGeckoClient>["getTokenInfo"]>> | null = null;
  let poolData: Awaited<ReturnType<ReturnType<typeof getCoinGeckoClient>["getPool"]>> | null = null;
  const safeLoad = async <T>(label: string, load: () => Promise<T>) => {
    try { return await load(); }
    catch (error) {
      providerErrors.push(`${label}:${error instanceof Error ? error.message : "UNKNOWN"}`);
      return null;
    }
  };

  if (env.COINGECKO_NETWORK_ID) {
    const client = getCoinGeckoClient();
    [tokenData, tokenInfo, poolData] = await Promise.all([
      safeLoad("token-data", () => client.getToken(env.COINGECKO_NETWORK_ID!, market.assetAddress)),
      safeLoad("token-info", () => client.getTokenInfo(env.COINGECKO_NETWORK_ID!, market.assetAddress)),
      safeLoad("pool-data", () => client.getPool(env.COINGECKO_NETWORK_ID!, market.poolAddress)),
    ]);
  } else {
    providerErrors.push("configuration:COINGECKO_NETWORK_NOT_CONFIGURED");
  }
  return { tokenData, tokenInfo, poolData, providerErrors };
}

export async function captureMarketEvidence(sampledAt = new Date()) {
  const database = requireDb();
  const [competition] = await database.select({ startsAt: competitions.startsAt }).from(competitions).limit(1);
  const markets = await database.select({
    id: assetMarkets.id,
    marketId: assetMarkets.marketId,
    poolAddress: assetMarkets.poolAddress,
    factoryAddress: assetMarkets.factoryAddress,
    quoteTokenAddress: assetMarkets.quoteTokenAddress,
    feeTier: assetMarkets.feeTier,
    assetAddress: eligibleAssets.contractAddress,
  }).from(assetMarkets).innerJoin(
    eligibleAssets,
    eq(eligibleAssets.id, assetMarkets.assetId),
  ).where(eq(assetMarkets.active, true));

  const results = [];
  for (const market of markets) {
    const provider = await fetchProviderEvidence(market);
    const marketCap = finiteNumber(provider.tokenData?.data.attributes.market_cap_usd);
    const poolCreatedAtValue = provider.poolData?.data.attributes.pool_created_at;
    const poolCreatedAt = poolCreatedAtValue && !Number.isNaN(new Date(poolCreatedAtValue).getTime())
      ? new Date(poolCreatedAtValue)
      : null;
    const evidence: MarketEvidenceInput = {
      sampledAt,
      competitionStartsAt: competition?.startsAt ?? null,
      liquidityUsd: finiteNumber(provider.poolData?.data.attributes.reserve_in_usd),
      marketCapUsd: marketCap,
      // CoinGecko documents null market_cap_usd for unverified values. FDV is intentionally ignored.
      marketCapVerified: provider.tokenData ? marketCap !== null : null,
      poolCreatedAt,
      gtVerified: provider.tokenInfo?.data.attributes.gt_verified ?? null,
      gtScore: finiteNumber(provider.tokenInfo?.data.attributes.gt_score),
      isHoneypot: provider.tokenInfo?.data.attributes.is_honeypot ?? null,
      lockedLiquidityPct: finiteNumber(provider.poolData?.data.attributes.locked_liquidity_percentage),
    };
    const evaluated = evaluateMarketEvidence(evidence);
    await database.transaction(async (transaction) => {
      await transaction.insert(assetEligibilitySnapshots).values({
        marketId: market.id,
        sampledAt,
        status: evaluated.status,
        liquidityUsd: evidence.liquidityUsd?.toString(),
        marketCapUsd: evidence.marketCapUsd?.toString(),
        marketCapVerified: evidence.marketCapVerified,
        gtVerified: evidence.gtVerified,
        gtScore: evidence.gtScore?.toString(),
        isHoneypot: evidence.isHoneypot,
        lockedLiquidityPct: evidence.lockedLiquidityPct?.toString(),
        reasons: evaluated.reasons,
        providerMetadata: { errors: provider.providerErrors },
      }).onConflictDoNothing();
      await transaction.update(assetMarkets).set({
        poolCreatedAt,
        updatedAt: sampledAt,
      }).where(eq(assetMarkets.id, market.id));
    });
    results.push({ marketId: market.marketId, status: evaluated.status, reasons: evaluated.reasons });
  }
  return { sampledAt: sampledAt.toISOString(), markets: results };
}
