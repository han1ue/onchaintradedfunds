import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { PortfolioReturns } from "@/lib/types";
import { calculatePortfolioReturns } from "@/lib/returns";
import { requireDb, sqlClient } from "./db";
import { assetPriceSnapshots, eligibleAssets, proposalAssets, proposals } from "./db/schema";

const pricesResponseSchema = z.object({
  quotes: z.array(z.object({
    tokenSymbol: z.string(),
    bid: z.string(),
    generatedAt: z.string().datetime({ offset: true }),
  }).passthrough()),
});

function hourlyBucket(date: Date) {
  const bucket = new Date(date);
  bucket.setUTCMinutes(0, 0, 0);
  return bucket;
}

export async function captureAssetPrices(sampledAt = new Date(), useHourlyBucket = true) {
  const database = requireDb();
  const assets = await database.selectDistinct({ id: eligibleAssets.id, symbol: eligibleAssets.symbol })
    .from(eligibleAssets)
    .innerJoin(proposalAssets, eq(proposalAssets.assetId, eligibleAssets.id))
    .innerJoin(proposals, and(eq(proposals.id, proposalAssets.proposalId), eq(proposals.status, "accepted")));
  if (assets.length === 0) return { stored: 0, missing: [] as string[] };

  const response = await fetch("https://api.robinhood.com/rhj/prices", {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`ROBINHOOD_PRICES_${response.status}`);

  const payload = pricesResponseSchema.parse(await response.json());
  const quotesBySymbol = new Map(payload.quotes.map((quote) => [quote.tokenSymbol.toUpperCase(), quote]));
  const missing: string[] = [];
  const values = assets.flatMap((asset) => {
    const quote = quotesBySymbol.get(asset.symbol.toUpperCase());
    const bid = quote ? Number(quote.bid) : Number.NaN;
    if (!quote || !Number.isFinite(bid) || bid <= 0) {
      missing.push(asset.symbol);
      return [];
    }
    return [{
      assetId: asset.id,
      sampledAt: useHourlyBucket ? hourlyBucket(sampledAt) : sampledAt,
      quoteGeneratedAt: new Date(quote.generatedAt),
      bidUsd: quote.bid,
    }];
  });

  const stored = values.length
    ? await database.insert(assetPriceSnapshots).values(values).onConflictDoNothing().returning({ assetId: assetPriceSnapshots.assetId })
    : [];
  return { stored: stored.length, missing };
}

export async function getProposalReturns(
  proposalId: string,
  proposedAt: string,
  allocations: { assetId: string; symbol: string; name: string; weightBps: number }[]
): Promise<PortfolioReturns> {
  if (!sqlClient) {
    const start = new Date(proposedAt).getTime();
    const shape = [0, 0.42, 0.18, 0.86, 0.61, 1.24, 1.08, 1.73, 1.51, 2.06, 1.88, 2.34];
    const direction = proposalId.length % 2 === 0 ? 1 : -1;
    const points = shape.map((returnPct, index) => ({
      timestamp: new Date(start + index * 12 * 60 * 60_000).toISOString(),
      returnPct: returnPct * direction,
    }));
    return { proposedAt, trackingStartedAt: points[0].timestamp, points };
  }
  const assetIds = allocations.map((allocation) => allocation.assetId);
  if (assetIds.length === 0) return { proposedAt, trackingStartedAt: null, points: [] };

  const rows = await sqlClient<{ assetId: string; sampledAt: string; bidUsd: number }[]>`
    select aps.asset_id::text as "assetId", aps.sampled_at as "sampledAt", aps.bid_usd::float8 as "bidUsd"
    from asset_price_snapshots aps
    join proposal_assets pa on pa.asset_id = aps.asset_id
    where pa.proposal_id = ${proposalId}::uuid
      and aps.asset_id in ${sqlClient(assetIds)}
      and aps.sampled_at >= ${proposedAt}::timestamptz
    order by aps.sampled_at asc, aps.asset_id asc`;
  const points = calculatePortfolioReturns(allocations, rows);
  return { proposedAt, trackingStartedAt: points[0]?.timestamp ?? null, points };
}
