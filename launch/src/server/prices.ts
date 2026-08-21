import { inArray } from "drizzle-orm";
import { z } from "zod";
import type { PortfolioReturns } from "@/lib/types";
import { calculatePortfolioReturns } from "@/lib/returns";
import { requireDb, sqlClient } from "./db";
import { assetPriceSnapshots, eligibleAssets, priceCaptureRuns } from "./db/schema";
import { getCoinGeckoClient } from "./coingecko";
import { env } from "./env";

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

export type AssetPriceSource = "robinhood-bid" | "coinbase-eth-usd-bid" | "coingecko-usd";

type PriceAsset = {
  id: string;
  symbol: string;
  contractAddress: string;
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
  purpose: "entry" | "final" | "scoring";
};

export type PriceCaptureResult = {
  runId: string | null;
  sampledAt: Date;
  stored: number;
  complete: boolean;
  missing: string[];
  skipped?: boolean;
};

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

async function fetchCoinGeckoOnchainPrices(assets: PriceAsset[]): Promise<Map<string, SourceQuote>> {
  if (!env.COINGECKO_NETWORK_ID) throw new Error("COINGECKO_NETWORK_NOT_CONFIGURED");
  const addresses = [...new Set(assets.map((asset) => asset.contractAddress.toLowerCase()))];
  if (addresses.length === 0) return new Map();
  const attributes = (await getCoinGeckoClient().getTokenPrices(env.COINGECKO_NETWORK_ID, addresses)).data.attributes;
  return new Map(Object.entries(attributes.token_prices).flatMap(([address, bid]) => {
    if (!bid) return [];
    const tradedAt = attributes.last_trade_timestamp?.[address];
    if (!tradedAt) return [];
    return [[address.toLowerCase(), {
      bid,
      generatedAt: new Date(tradedAt * 1_000),
    }]];
  }));
}

export async function fetchAssetPriceQuotes(assets: PriceAsset[]): Promise<PriceFetchResult> {
  const requestedSources = new Set(assets.map((asset) => asset.priceSource));
  const requests: { source: AssetPriceSource; load: () => Promise<Map<string, SourceQuote>> }[] = [];
  if (requestedSources.has("robinhood-bid")) requests.push({ source: "robinhood-bid", load: fetchRobinhoodBids });
  if (requestedSources.has("coinbase-eth-usd-bid")) requests.push({ source: "coinbase-eth-usd-bid", load: fetchCoinbaseEthBid });
  if (requestedSources.has("coingecko-usd")) requests.push({
    source: "coingecko-usd",
    load: () => fetchCoinGeckoOnchainPrices(assets.filter((asset) => asset.priceSource === "coingecko-usd")),
  });

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
    for (const [identity, quote] of result.quotes ?? []) quotes.set(`${result.source}:${identity}`, quote);
  }
  return { quotes, errors };
}

const inFlightCaptures = new Map<string, Promise<PriceCaptureResult>>();

function captureKey(sampledAt: Date, purpose: PriceCaptureOptions["purpose"], assetIds?: string[]) {
  const scope = assetIds?.length ? [...assetIds].sort().join(",") : "all";
  if (purpose === "final") {
    const interval = 30 * 60_000;
    const bucket = Math.floor(sampledAt.getTime() / interval) * interval;
    return `final:${new Date(bucket).toISOString()}:${scope}`;
  }
  if (purpose !== "scoring") return `${purpose}:${sampledAt.toISOString()}:${scope}`;
  const interval = 30 * 60_000;
  const bucket = Math.floor((sampledAt.getTime() + interval / 2) / interval) * interval;
  return `${purpose}:${new Date(bucket).toISOString()}:${scope}`;
}

async function readCompleteFinalCapture(assetIds?: string[]): Promise<PriceCaptureResult | null> {
  if (!sqlClient) return null;
  const scope = assetIds?.length ? [...assetIds].sort().join(",") : "all";
  const rows = await sqlClient<{ id: string; sampledAt: string; missingSymbols: string[] }[]>`
    select id::text, sampled_at as "sampledAt", missing_symbols as "missingSymbols"
    from price_capture_runs
    where purpose = 'final' and status = 'complete' and capture_key like ${`final:%:${scope}`}
    order by sampled_at asc
    limit 1`;
  const existing = rows[0];
  if (!existing) return null;
  const stored = await sqlClient<{ count: string }[]>`
    select count(*)::text as count from asset_price_snapshots where capture_run_id = ${existing.id}::uuid`;
  return {
    runId: existing.id,
    sampledAt: new Date(existing.sampledAt),
    stored: Number(stored[0]?.count ?? 0),
    complete: true,
    missing: existing.missingSymbols ?? [],
    skipped: true,
  };
}

async function readExistingCapture(key: string): Promise<PriceCaptureResult | null> {
  if (!sqlClient) return null;
  const rows = await sqlClient<{ id: string; sampledAt: string; status: "complete" | "partial"; missingSymbols: string[] }[]>`
    select id::text, sampled_at as "sampledAt", status, missing_symbols as "missingSymbols"
    from price_capture_runs where capture_key = ${key} limit 1`;
  const existing = rows[0];
  if (!existing) return null;
  const stored = await sqlClient<{ count: string }[]>`
    select count(*)::text as count from asset_price_snapshots where capture_run_id = ${existing.id}::uuid`;
  return {
    runId: existing.id,
    sampledAt: new Date(existing.sampledAt),
    stored: Number(stored[0]?.count ?? 0),
    complete: existing.status === "complete",
    missing: existing.missingSymbols ?? [],
    skipped: true,
  };
}

async function withPriceCaptureLock<T>(key: string, work: () => Promise<T>): Promise<T | null> {
  if (!sqlClient) return work();
  const connection = await sqlClient.reserve();
  const lockKey = `otf-launch:price-capture:${key}`;
  try {
    const [lock] = await connection<{ locked: boolean }[]>`select pg_try_advisory_lock(hashtext(${lockKey})) as locked`;
    if (!lock?.locked) return null;
    try {
      return await work();
    } finally {
      await connection`select pg_advisory_unlock(hashtext(${lockKey}))`;
    }
  } finally {
    connection.release();
  }
}

async function captureAssetPricesOnce(options: PriceCaptureOptions, sampledAt: Date, key: string): Promise<PriceCaptureResult> {
  const database = requireDb();
  const purpose = options.purpose;
  const existing = await readExistingCapture(key);
  if (existing) return existing;
  const assets = options.assetIds
    ? await database.select({ id: eligibleAssets.id, symbol: eligibleAssets.symbol, contractAddress: eligibleAssets.contractAddress, priceSource: eligibleAssets.priceSource }).from(eligibleAssets).where(inArray(eligibleAssets.id, options.assetIds))
    : await database.select({ id: eligibleAssets.id, symbol: eligibleAssets.symbol, contractAddress: eligibleAssets.contractAddress, priceSource: eligibleAssets.priceSource }).from(eligibleAssets);
  if (assets.length === 0) return { runId: null, sampledAt, stored: 0, complete: true, missing: [] as string[] };

  const typedAssets = assets as PriceAsset[];
  const priceFetch = await fetchAssetPriceQuotes(typedAssets);
  if (priceFetch.errors.length) console.error("Price source capture failed", { errors: priceFetch.errors });
  const missing: string[] = [];
  const values = typedAssets.flatMap((asset) => {
    const identity = asset.priceSource === "coingecko-usd"
      ? asset.contractAddress.toLowerCase()
      : asset.symbol.toUpperCase();
    const quote = priceFetch.quotes.get(`${asset.priceSource}:${identity}`);
    const bid = quote ? Number(quote.bid) : Number.NaN;
    if (!quote || !Number.isFinite(bid) || bid <= 0 || !isPriceQuoteFresh(quote.generatedAt, sampledAt, PRICE_CAPTURE_QUOTE_FRESHNESS_MS)) {
      missing.push(asset.symbol);
      return [];
    }
    return [{
      assetId: asset.id,
      sampledAt,
      quoteGeneratedAt: quote.generatedAt,
      bidUsd: quote.bid,
      twapWindowSeconds: 0,
    }];
  });

  const provider = [...new Set(typedAssets.map((asset) => asset.priceSource))].sort().join("+");

  const [run, stored] = await database.transaction(async (transaction) => {
    const [captureRun] = await transaction.insert(priceCaptureRuns).values({
      sampledAt,
      captureKey: key,
      status: missing.length ? "partial" : "complete",
      requestedAssetIds: assets.map((asset) => asset.id),
      missingSymbols: missing,
      provider,
      purpose,
    }).onConflictDoNothing({ target: priceCaptureRuns.captureKey }).returning({ id: priceCaptureRuns.id });
    if (!captureRun) throw new Error("PRICE_CAPTURE_ALREADY_EXISTS");
    const captured = values.length
      ? await transaction.insert(assetPriceSnapshots).values(values.map((value) => ({ ...value, captureRunId: captureRun.id }))).onConflictDoNothing().returning({ assetId: assetPriceSnapshots.assetId })
      : [];
    return [captureRun, captured] as const;
  });
  if (missing.length) console.error("Price capture missing proposal assets", { captureRunId: run.id, missingSymbols: missing, provider });
  return { runId: run.id, sampledAt, stored: stored.length, complete: missing.length === 0, missing };
}

export async function captureAssetPrices(options: PriceCaptureOptions): Promise<PriceCaptureResult> {
  const sampledAt = options.sampledAt ?? new Date();
  const key = captureKey(sampledAt, options.purpose, options.assetIds);
  if (options.purpose === "final") {
    const completed = await readCompleteFinalCapture(options.assetIds);
    if (completed) return completed;
  }
  const existing = await readExistingCapture(key);
  if (existing) return existing;
  const running = inFlightCaptures.get(key);
  if (running) return running;
  const promise = (async () => {
    const lockKey = options.purpose === "final"
      ? `final:${options.assetIds?.length ? [...options.assetIds].sort().join(",") : "all"}`
      : key;
    const captured = await withPriceCaptureLock(lockKey, async () => {
      if (options.purpose === "final") {
        const completed = await readCompleteFinalCapture(options.assetIds);
        if (completed) return completed;
      }
      const lockedExisting = await readExistingCapture(key);
      if (lockedExisting) return lockedExisting;
      return captureAssetPricesOnce(options, sampledAt, key);
    });
    return captured ?? { runId: null, sampledAt, stored: 0, complete: false, missing: [], skipped: true };
  })().finally(() => inFlightCaptures.delete(key));
  inFlightCaptures.set(key, promise);
  return promise;
}

export const PRICE_CHECKPOINT_FRESHNESS_MS = 90 * 60_000;
export const PRICE_CAPTURE_QUOTE_FRESHNESS_MS = 45 * 60_000;

export function isPriceQuoteFresh(quoteGeneratedAt: Date, referenceTime: Date, freshnessMs: number) {
  const quoteTime = quoteGeneratedAt.getTime();
  const reference = referenceTime.getTime();
  return Number.isFinite(quoteTime) && quoteTime >= reference - freshnessMs;
}

export async function getNewestPriceCheckpointForAssets(assetIds: string[], acceptedAt: Date) {
  const requiredAssetIds = [...new Set(assetIds)];
  if (!sqlClient || requiredAssetIds.length === 0) throw new Error("PRICE_CHECKPOINT_UNAVAILABLE");
  const rows = await sqlClient<{ id: string; sampledAt: string }[]>`
    select pcr.id::text, pcr.sampled_at as "sampledAt"
    from price_capture_runs pcr
    join asset_price_snapshots aps on aps.capture_run_id = pcr.id
    where pcr.purpose = 'scoring'
      and pcr.sampled_at <= ${acceptedAt.toISOString()}::timestamptz
      and pcr.sampled_at >= ${new Date(acceptedAt.getTime() - PRICE_CHECKPOINT_FRESHNESS_MS).toISOString()}::timestamptz
      and aps.quote_generated_at >= ${new Date(acceptedAt.getTime() - PRICE_CHECKPOINT_FRESHNESS_MS).toISOString()}::timestamptz
      and aps.asset_id in ${sqlClient(requiredAssetIds)}
    group by pcr.id, pcr.sampled_at
    having count(distinct aps.asset_id) = ${requiredAssetIds.length}
    order by pcr.sampled_at desc
    limit 1`;
  if (!rows[0]) throw new Error("PRICE_CHECKPOINT_UNAVAILABLE");
  return { runId: rows[0].id, sampledAt: new Date(rows[0].sampledAt) };
}

export async function getProposalReturns(
  proposalId: string,
  proposedAt: string,
  allocations: { assetId: string; symbol: string; name: string; weightBps: number }[],
): Promise<PortfolioReturns> {
  if (!sqlClient) {
    const start = new Date(proposedAt).getTime();
    const shape = [0, 0.42, 0.18, 0.86, 0.61, 1.24, 1.08, 1.73, 1.51, 2.06, 1.88, 2.34];
    const direction = proposalId.length % 2 === 0 ? 1 : -1;
    const points = shape.map((returnPct, index) => ({
      timestamp: new Date(start + index * 6 * 60 * 60_000).toISOString(),
      returnPct: returnPct * direction,
    }));
    return { proposedAt, trackingStartedAt: points[0].timestamp, points };
  }
  const assetIds = allocations.map((allocation) => allocation.assetId);
  if (assetIds.length === 0) return { proposedAt, trackingStartedAt: null, points: [] };

  const rows = await sqlClient<{ assetId: string; sampledAt: string; bidUsd: number }[]>`
    select aps.asset_id::text as "assetId", aps.sampled_at::text as "sampledAt", aps.bid_usd::float8 as "bidUsd"
    from asset_price_snapshots aps
    join price_capture_runs pcr on pcr.id = aps.capture_run_id and pcr.purpose = 'scoring'
    join proposal_assets pa on pa.asset_id = aps.asset_id
    where pa.proposal_id = ${proposalId}::uuid
      and aps.asset_id in ${sqlClient(assetIds)}
      and aps.sampled_at >= ${proposedAt}::timestamptz
    order by aps.sampled_at asc, aps.asset_id asc`;
  const points = calculatePortfolioReturns(allocations, rows);
  return { proposedAt, trackingStartedAt: points[0]?.timestamp ?? null, points };
}

export type VoterProposalPerformance = {
  proposalId: string;
  proposalStatus: "draft" | "confirmed" | "deleted";
  returnPct: number | null;
  latestCheckpointAt: string | null;
};

export async function getVoterProposalPerformance(
  competitionId: string,
  voterUserId: string,
  asOf: Date,
): Promise<VoterProposalPerformance[]> {
  if (!sqlClient) return [];
  return sqlClient<VoterProposalPerformance[]>`
    with tranche_returns as (
      select vt.id, vt.proposal_id, vt.quantity, p.status as proposal_status,
        latest.sampled_at as latest_checkpoint_at,
        case when count(pa.asset_id) = count(entry_price.asset_id)
          and count(pa.asset_id) = count(current_price.asset_id)
          then ((sum((pa.weight_bps::numeric / 10000) * (current_price.bid_usd / nullif(entry_price.bid_usd, 0))) - 1) * 100)::float8
          else null
        end as return_pct
      from vote_tranches vt
      join ballots b on b.id = vt.ballot_id and b.status = 'valid'
      join tweet_evidence te on te.id = vt.evidence_id and te.status = 'valid'
      join proposals p on p.id = vt.proposal_id
      join proposal_assets pa on pa.proposal_id = vt.proposal_id
      left join lateral (
        select pcr.id, pcr.sampled_at
        from price_capture_runs pcr
        where pcr.purpose = 'scoring'
          and pcr.sampled_at <= ${asOf.toISOString()}::timestamptz
          and not exists (
            select 1 from proposal_assets required
            where required.proposal_id = vt.proposal_id
              and not exists (
                select 1 from asset_price_snapshots available
                where available.capture_run_id = pcr.id and available.asset_id = required.asset_id
              )
          )
        order by pcr.sampled_at desc
        limit 1
      ) latest on true
      left join asset_price_snapshots entry_price
        on entry_price.capture_run_id = vt.entry_price_capture_run_id and entry_price.asset_id = pa.asset_id
      left join asset_price_snapshots current_price
        on current_price.capture_run_id = latest.id and current_price.asset_id = pa.asset_id
      where vt.competition_id = ${competitionId}::uuid and vt.voter_user_id = ${voterUserId}
      group by vt.id, vt.proposal_id, vt.quantity, p.status, latest.sampled_at
    )
    select proposal_id::text as "proposalId", proposal_status as "proposalStatus",
      case when proposal_status = 'confirmed' and count(return_pct) = count(*)
        then (sum(quantity * return_pct) / sum(quantity))::float8
        else null
      end as "returnPct",
      max(latest_checkpoint_at)::text as "latestCheckpointAt"
    from tranche_returns
    group by proposal_id, proposal_status`;
}
