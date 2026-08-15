import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { PortfolioReturns } from "@/lib/types";
import { PublicApiError } from "@/lib/errors";
import { calculatePortfolioReturns } from "@/lib/returns";
import { requireDb, sqlClient } from "./db";
import { assetPriceSnapshots, eligibleAssets, priceCaptureRuns, proposalAssets, proposals } from "./db/schema";

const pricesResponseSchema = z.object({
  quotes: z.array(z.object({
    tokenSymbol: z.string(),
    bid: z.string(),
    generatedAt: z.string().datetime({ offset: true }),
  }).passthrough()),
});

export type PriceCaptureOptions = {
  assetIds?: string[];
  sampledAt?: Date;
};

export type PriceCaptureResult = {
  runId: string | null;
  sampledAt: Date;
  stored: number;
  complete: boolean;
  missing: string[];
};

export function assertCompleteProposalPriceCapture(result: PriceCaptureResult, assets: { symbol: string }[]) {
  if (!result.complete || !result.runId || result.stored !== assets.length) {
    throw new PublicApiError("PROPOSAL_PRICE_UNAVAILABLE", { missingSymbols: result.missing });
  }
  return result.runId;
}

export async function captureAssetPrices(options: PriceCaptureOptions = {}): Promise<PriceCaptureResult> {
  const database = requireDb();
  const sampledAt = options.sampledAt ?? new Date();
  const assets = options.assetIds
    ? await database.select({ id: eligibleAssets.id, symbol: eligibleAssets.symbol }).from(eligibleAssets).where(inArray(eligibleAssets.id, options.assetIds))
    : await database.selectDistinct({ id: eligibleAssets.id, symbol: eligibleAssets.symbol })
      .from(eligibleAssets)
      .innerJoin(proposalAssets, eq(proposalAssets.assetId, eligibleAssets.id))
      .innerJoin(proposals, and(eq(proposals.id, proposalAssets.proposalId), eq(proposals.status, "accepted")));
  if (assets.length === 0) return { runId: null, sampledAt, stored: 0, complete: true, missing: [] as string[] };

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
      sampledAt,
      quoteGeneratedAt: new Date(quote.generatedAt),
      bidUsd: quote.bid,
    }];
  });

  const [run, stored] = await database.transaction(async (transaction) => {
    const [captureRun] = await transaction.insert(priceCaptureRuns).values({
      sampledAt,
      status: missing.length ? "partial" : "complete",
      requestedAssetIds: assets.map((asset) => asset.id),
      missingSymbols: missing,
    }).returning({ id: priceCaptureRuns.id });
    const captured = values.length
      ? await transaction.insert(assetPriceSnapshots).values(values.map((value) => ({ ...value, captureRunId: captureRun.id }))).onConflictDoNothing().returning({ assetId: assetPriceSnapshots.assetId })
      : [];
    return [captureRun, captured] as const;
  });
  if (missing.length) console.error("Robinhood price capture missing proposal assets", { captureRunId: run.id, missingSymbols: missing });
  return { runId: run.id, sampledAt, stored: stored.length, complete: missing.length === 0, missing };
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

  const [initial] = await sqlClient<{ sampledAt: string }[]>`
    select pcr.sampled_at as "sampledAt"
    from proposals p
    join price_capture_runs pcr on pcr.id = p.initial_price_capture_run_id
    where p.id = ${proposalId}::uuid and pcr.status = 'complete'
    limit 1`;
  const trackingFloor = initial?.sampledAt ?? proposedAt;

  const rows = await sqlClient<{ assetId: string; sampledAt: string; bidUsd: number }[]>`
    select aps.asset_id::text as "assetId", aps.sampled_at as "sampledAt", aps.bid_usd::float8 as "bidUsd"
    from asset_price_snapshots aps
    join proposal_assets pa on pa.asset_id = aps.asset_id
    where pa.proposal_id = ${proposalId}::uuid
      and aps.asset_id in ${sqlClient(assetIds)}
      and aps.sampled_at >= ${trackingFloor}::timestamptz
    order by aps.sampled_at asc, aps.asset_id asc`;
  const points = calculatePortfolioReturns(allocations, rows);
  return { proposedAt, trackingStartedAt: points[0]?.timestamp ?? null, points };
}
