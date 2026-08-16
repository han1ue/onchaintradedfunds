import { inArray } from "drizzle-orm";
import { z } from "zod";
import { requireDb } from "./db";
import { assetPriceSnapshots, eligibleAssets, priceCaptureRuns } from "./db/schema";
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

const coinGeckoOnchainPriceSchema = z.object({
  data: z.object({ attributes: z.object({
    token_prices: z.record(z.string().nullable()),
    last_trade_timestamp: z.record(z.number().int().nullable()).optional(),
  }) }),
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
  purpose: "entry" | "final";
};

export type PriceCaptureResult = {
  runId: string | null;
  sampledAt: Date;
  stored: number;
  complete: boolean;
  missing: string[];
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
  const apiRoot = env.COINGECKO_PRO_API_KEY
    ? "https://pro-api.coingecko.com/api/v3/onchain"
    : "https://api.geckoterminal.com/api/v2";
  const response = await fetch(
    `${apiRoot}/simple/networks/${encodeURIComponent(env.COINGECKO_NETWORK_ID)}/token_price/${addresses.map(encodeURIComponent).join(",")}`,
    {
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...(env.COINGECKO_PRO_API_KEY ? { "x-cg-pro-api-key": env.COINGECKO_PRO_API_KEY } : {}),
      },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) throw new Error(`COINGECKO_PRICES_${response.status}`);
  const attributes = coinGeckoOnchainPriceSchema.parse(await response.json()).data.attributes;
  const fallbackTimestamp = new Date();
  return new Map(Object.entries(attributes.token_prices).flatMap(([address, bid]) => {
    if (!bid) return [];
    const tradedAt = attributes.last_trade_timestamp?.[address];
    return [[address.toLowerCase(), {
      bid,
      generatedAt: tradedAt ? new Date(tradedAt * 1_000) : fallbackTimestamp,
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

export async function captureAssetPrices(options: PriceCaptureOptions): Promise<PriceCaptureResult> {
  const database = requireDb();
  const sampledAt = options.sampledAt ?? new Date();
  const purpose = options.purpose;
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
    if (!quote || !Number.isFinite(bid) || bid <= 0) {
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
      status: missing.length ? "partial" : "complete",
      requestedAssetIds: assets.map((asset) => asset.id),
      missingSymbols: missing,
      provider,
      purpose,
    }).returning({ id: priceCaptureRuns.id });
    const captured = values.length
      ? await transaction.insert(assetPriceSnapshots).values(values.map((value) => ({ ...value, captureRunId: captureRun.id }))).onConflictDoNothing().returning({ assetId: assetPriceSnapshots.assetId })
      : [];
    return [captureRun, captured] as const;
  });
  if (missing.length) console.error("Price capture missing proposal assets", { captureRunId: run.id, missingSymbols: missing, provider });
  return { runId: run.id, sampledAt, stored: stored.length, complete: missing.length === 0, missing };
}
