import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  evaluateMarketEvidence,
  type MarketEvidenceInput,
} from "@/lib/market-evidence-policy";
import { requireDb } from "./db";
import { assetEligibilitySnapshots, assetMarkets, competitions, eligibleAssets } from "./db/schema";
import { env } from "./env";

const tokenDataSchema = z.object({
  data: z.object({ attributes: z.object({ market_cap_usd: z.string().nullable() }).passthrough() }),
});
const tokenInfoSchema = z.object({
  data: z.object({ attributes: z.object({
    gt_score: z.number().nullable(),
    gt_verified: z.boolean().nullable(),
    is_honeypot: z.boolean().nullable(),
  }).passthrough() }),
});
const poolDataSchema = z.object({
  data: z.object({ attributes: z.object({
    reserve_in_usd: z.string().nullable(),
    locked_liquidity_percentage: z.string().nullable(),
    pool_created_at: z.string().datetime({ offset: true }).nullable(),
  }).passthrough() }),
});
type MarketRow = {
  id: string;
  marketId: string;
  poolAddress: string;
  factoryAddress: string;
  quoteTokenAddress: string;
  feeTier: number;
  assetAddress: string;
};

function finiteNumber(value: string | null | undefined) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function coinGecko(path: string) {
  if (!env.COINGECKO_PRO_API_KEY || !env.COINGECKO_NETWORK_ID) return null;
  const response = await fetch(`https://pro-api.coingecko.com/api/v3/onchain/networks/${encodeURIComponent(env.COINGECKO_NETWORK_ID)}/${path}`, {
    headers: { accept: "application/json", "x-cg-pro-api-key": env.COINGECKO_PRO_API_KEY },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`COINGECKO_${response.status}`);
  return response.json();
}

async function fetchProviderEvidence(market: MarketRow) {
  const providerErrors: string[] = [];
  let tokenData: z.infer<typeof tokenDataSchema> | null = null;
  let tokenInfo: z.infer<typeof tokenInfoSchema> | null = null;
  let poolData: z.infer<typeof poolDataSchema> | null = null;
  const safeLoad = async <T>(label: string, load: () => Promise<T>) => {
    try { return await load(); }
    catch (error) {
      providerErrors.push(`${label}:${error instanceof Error ? error.message : "UNKNOWN"}`);
      return null;
    }
  };

  tokenData = await safeLoad("token-data", async () => tokenDataSchema.parse(await coinGecko(`tokens/${market.assetAddress}`)));
  tokenInfo = await safeLoad("token-info", async () => tokenInfoSchema.parse(await coinGecko(`tokens/${market.assetAddress}/info`)));
  poolData = await safeLoad("pool-data", async () => poolDataSchema.parse(await coinGecko(`pools/${market.poolAddress}`)));
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
    const poolCreatedAt = provider.poolData?.data.attributes.pool_created_at
      ? new Date(provider.poolData.data.attributes.pool_created_at)
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
      gtScore: provider.tokenInfo?.data.attributes.gt_score ?? null,
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
