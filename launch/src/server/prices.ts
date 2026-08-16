import { inArray } from "drizzle-orm";
import { z } from "zod";
import type { PortfolioReturns } from "@/lib/types";
import { PublicApiError } from "@/lib/errors";
import { calculatePortfolioReturns } from "@/lib/returns";
import { requireDb, sqlClient } from "./db";
import { assetPriceSnapshots, eligibleAssets, priceCaptureRuns } from "./db/schema";

const pricesResponseSchema = z.object({
  quotes: z.array(z.object({
    tokenSymbol: z.string(),
    bid: z.string(),
    generatedAt: z.string().datetime({ offset: true }),
  }).passthrough()),
});

const coinbaseTickerSchema = z.object({
  bid: z.string(),
  time: z.string().datetime({ offset: true }),
});

export type AssetPriceSource = "robinhood-bid" | "coinbase-eth-usd-bid";

type PriceAsset = {
  id: string;
  symbol: string;
  priceSource: AssetPriceSource;
};

type SourceQuote = {
  bid: string;
  generatedAt: Date;
};

type PriceFetchResult = {
  quotes: Map<string, SourceQuote>;
  errors: { source: AssetPriceSource; message: string }[];
};

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

async function fetchRobinhoodBids(): Promise<Map<string, SourceQuote>> {
  const response = await fetch("https://api.robinhood.com/rhj/prices", {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`ROBINHOOD_PRICES_${response.status}`);
  const payload = pricesResponseSchema.parse(await response.json());
  return new Map(payload.quotes.map((quote) => [quote.tokenSymbol.toUpperCase(), {
    bid: quote.bid,
    generatedAt: new Date(quote.generatedAt),
  }]));
}

async function fetchCoinbaseEthBid(): Promise<Map<string, SourceQuote>> {
  const response = await fetch("https://api.exchange.coinbase.com/products/ETH-USD/ticker", {
    cache: "no-store",
    headers: { accept: "application/json", "cache-control": "no-cache" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`COINBASE_ETH_USD_${response.status}`);
  const payload = coinbaseTickerSchema.parse(await response.json());
  return new Map([["ETH", { bid: payload.bid, generatedAt: new Date(payload.time) }]]);
}

export async function fetchAssetPriceQuotes(assets: PriceAsset[]): Promise<PriceFetchResult> {
  const requestedSources = new Set(assets.map((asset) => asset.priceSource));
  const requests: { source: AssetPriceSource; load: () => Promise<Map<string, SourceQuote>> }[] = [];
  if (requestedSources.has("robinhood-bid")) requests.push({ source: "robinhood-bid", load: fetchRobinhoodBids });
  if (requestedSources.has("coinbase-eth-usd-bid")) requests.push({ source: "coinbase-eth-usd-bid", load: fetchCoinbaseEthBid });

  const settled = await Promise.all(requests.map(async ({ source, load }) => {
    try {
      return { source, quotes: await load() };
    } catch (error) {
      return { source, error: error instanceof Error ? error.message : "UNKNOWN_PRICE_SOURCE_ERROR" };
    }
  }));
  const quotes = new Map<string, SourceQuote>();
  const errors: PriceFetchResult["errors"] = [];
  for (const result of settled) {
    if (result.error !== undefined) {
      errors.push({ source: result.source, message: result.error });
      continue;
    }
    for (const [symbol, quote] of result.quotes ?? []) quotes.set(`${result.source}:${symbol}`, quote);
  }
  return { quotes, errors };
}

export async function captureAssetPrices(options: PriceCaptureOptions = {}): Promise<PriceCaptureResult> {
  const database = requireDb();
  const sampledAt = options.sampledAt ?? new Date();
  const assets = options.assetIds
    ? await database.select({ id: eligibleAssets.id, symbol: eligibleAssets.symbol, priceSource: eligibleAssets.priceSource }).from(eligibleAssets).where(inArray(eligibleAssets.id, options.assetIds))
    : await database.select({ id: eligibleAssets.id, symbol: eligibleAssets.symbol, priceSource: eligibleAssets.priceSource }).from(eligibleAssets);
  if (assets.length === 0) return { runId: null, sampledAt, stored: 0, complete: true, missing: [] as string[] };

  const typedAssets = assets as PriceAsset[];
  const priceFetch = await fetchAssetPriceQuotes(typedAssets);
  if (priceFetch.errors.length) console.error("Price source capture failed", { errors: priceFetch.errors });
  const missing: string[] = [];
  const values = typedAssets.flatMap((asset) => {
    const quote = priceFetch.quotes.get(`${asset.priceSource}:${asset.symbol.toUpperCase()}`);
    const bid = quote ? Number(quote.bid) : Number.NaN;
    if (!quote || !Number.isFinite(bid) || bid <= 0) {
      missing.push(asset.symbol);
      return [];
    }
    return [{
      assetId: asset.id,
      sampledAt,
      quoteGeneratedAt: quote.generatedAt,
      bidUsd: quote.bid,
    }];
  });

  const provider = [...new Set(typedAssets.map((asset) => asset.priceSource))].sort().join("+");

  const [run, stored] = await database.transaction(async (transaction) => {
    const [captureRun] = await transaction.insert(priceCaptureRuns).values({
      sampledAt,
      status: missing.length ? "partial" : "complete",
      requestedAssetIds: assets.map((asset) => asset.id),
      missingSymbols: missing,
      provider,
    }).returning({ id: priceCaptureRuns.id });
    const captured = values.length
      ? await transaction.insert(assetPriceSnapshots).values(values.map((value) => ({ ...value, captureRunId: captureRun.id }))).onConflictDoNothing().returning({ assetId: assetPriceSnapshots.assetId })
      : [];
    return [captureRun, captured] as const;
  });
  if (missing.length) console.error("Price capture missing proposal assets", { captureRunId: run.id, missingSymbols: missing, provider });
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
