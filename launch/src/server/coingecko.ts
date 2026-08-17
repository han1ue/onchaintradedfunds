import { createClient } from "redis";
import { z } from "zod";
import { env } from "./env";

const publicRoot = "https://api.geckoterminal.com/api/v2";
const demoRoot = "https://api.coingecko.com/api/v3/onchain";
const requestTimeoutMs = 10_000;
const maxAttemptsPerProvider = 2;
const retryDelayMs = 150;

const tokenPricesSchema = z.object({
  data: z.object({ attributes: z.object({
    token_prices: z.record(z.string().nullable()),
    last_trade_timestamp: z.record(z.number().int().nullable()).optional(),
  }).passthrough() }).passthrough(),
}).passthrough();

const poolSchema = z.object({
  data: z.object({ attributes: z.object({
    reserve_in_usd: z.union([z.string(), z.number()]).nullable().optional(),
    locked_liquidity_percentage: z.union([z.string(), z.number()]).nullable().optional(),
    pool_created_at: z.string().nullable().optional(),
  }).passthrough() }).passthrough(),
}).passthrough();

const tokenSchema = z.object({
  data: z.object({ attributes: z.object({
    market_cap_usd: z.union([z.string(), z.number()]).nullable().optional(),
  }).passthrough() }).passthrough(),
}).passthrough();

const tokenInfoSchema = z.object({
  data: z.object({ attributes: z.object({
    gt_score: z.union([z.number(), z.string()]).nullable().optional(),
    gt_verified: z.boolean().nullable().optional(),
    is_honeypot: z.boolean().nullable().optional(),
  }).passthrough() }).passthrough(),
}).passthrough();

export type CoinGeckoTokenPrices = z.infer<typeof tokenPricesSchema>;
export type CoinGeckoPool = z.infer<typeof poolSchema>;
export type CoinGeckoToken = z.infer<typeof tokenSchema>;
export type CoinGeckoTokenInfo = z.infer<typeof tokenInfoSchema>;

type RedisClient = ReturnType<typeof createClient>;
type CacheEntry = { expiresAt: number; value: unknown };

const memoryCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();
const providerCalls = { public: 0, demo: 0 };
const globalForCoinGecko = globalThis as unknown as {
  launchCoinGeckoRedis?: RedisClient;
  launchCoinGeckoRedisPromise?: Promise<RedisClient>;
};

async function getRedis() {
  if (!env.REDIS_URL) return null;
  if (globalForCoinGecko.launchCoinGeckoRedis?.isReady) return globalForCoinGecko.launchCoinGeckoRedis;
  if (!globalForCoinGecko.launchCoinGeckoRedisPromise) {
    const client = createClient({ url: env.REDIS_URL });
    client.on("error", () => undefined);
    globalForCoinGecko.launchCoinGeckoRedisPromise = client.connect().then(() => {
      globalForCoinGecko.launchCoinGeckoRedis = client;
      return client;
    }).catch((error) => {
      globalForCoinGecko.launchCoinGeckoRedisPromise = undefined;
      throw error;
    });
  }
  return globalForCoinGecko.launchCoinGeckoRedisPromise;
}

function cacheKey(path: string) {
  return `otf-launch:coingecko:${path}`;
}

async function readCache<T>(key: string): Promise<T | null> {
  const local = memoryCache.get(key);
  if (local) {
    if (local.expiresAt > Date.now()) return local.value as T;
    memoryCache.delete(key);
  }
  try {
    const redis = await getRedis();
    if (!redis) return null;
    const value = await redis.get(key);
    if (!value) return null;
    const parsed = JSON.parse(value) as T;
    memoryCache.set(key, { expiresAt: Date.now() + 60_000, value: parsed });
    return parsed;
  } catch {
    return null;
  }
}

async function writeCache(key: string, value: unknown, ttlMs: number) {
  memoryCache.set(key, { expiresAt: Date.now() + ttlMs, value });
  try {
    const redis = await getRedis();
    if (redis) await redis.setEx(key, Math.max(1, Math.ceil(ttlMs / 1_000)), JSON.stringify(value));
  } catch {
    // Redis is an optimization. The bounded local cache remains usable when it is unavailable.
  }
}

function isRetryable(error: unknown) {
  if (!(error instanceof Error)) return true;
  return /_(408|425|429|5\d\d)$/.test(error.message) || error.name === "TimeoutError";
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchProvider(provider: "public" | "demo", path: string) {
  const root = provider === "public" ? publicRoot : demoRoot;
  const response = await fetch(`${root}${path}`, {
    cache: "no-store",
    headers: {
      accept: "application/json",
      ...(provider === "demo" && env.COINGECKO_DEMO_API_KEY
        ? { "x-cg-demo-api-key": env.COINGECKO_DEMO_API_KEY }
        : {}),
    },
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  if (!response.ok) throw new Error(`COINGECKO_${provider.toUpperCase()}_${response.status}`);
  return response.json() as Promise<unknown>;
}

async function requestValidated<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  let lastError: unknown = new Error("COINGECKO_UNAVAILABLE");
  const providers: ("public" | "demo")[] = env.COINGECKO_DEMO_API_KEY ? ["public", "demo"] : ["public"];
  for (const provider of providers) {
    for (let attempt = 0; attempt < maxAttemptsPerProvider; attempt += 1) {
      providerCalls[provider] += 1;
      try {
        const parsed = schema.safeParse(await fetchProvider(provider, path));
        if (!parsed.success) throw new Error(`COINGECKO_${provider.toUpperCase()}_INVALID_RESPONSE`);
        return parsed.data;
      } catch (error) {
        lastError = error;
        if (attempt + 1 < maxAttemptsPerProvider && isRetryable(error)) await wait(retryDelayMs * (attempt + 1));
        else break;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("COINGECKO_UNAVAILABLE");
}

async function cachedRequest<T>(path: string, schema: z.ZodType<T>, ttlMs: number) {
  const key = cacheKey(path);
  const cached = await readCache<T>(key);
  if (cached !== null) return cached;
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  const request = requestValidated(path, schema).then(async (value) => {
    await writeCache(key, value, ttlMs);
    return value;
  }).finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

export class CoinGeckoClient {
  async getTokenPrices(network: string, addresses: string[]) {
    const uniqueAddresses = [...new Set(addresses.map((address) => address.toLowerCase()))].sort();
    if (uniqueAddresses.length === 0) return tokenPricesSchema.parse({ data: { attributes: { token_prices: {} } } });
    const encodedNetwork = encodeURIComponent(network);
    const encodedAddresses = uniqueAddresses.map(encodeURIComponent).join(",");
    return cachedRequest(
      `/simple/networks/${encodedNetwork}/token_price/${encodedAddresses}`,
      tokenPricesSchema,
      20 * 60_000,
    );
  }

  async getPool(network: string, poolAddress: string) {
    return cachedRequest(
      `/networks/${encodeURIComponent(network)}/pools/${encodeURIComponent(poolAddress.toLowerCase())}`,
      poolSchema,
      15 * 60_000,
    );
  }

  async getToken(network: string, assetAddress: string) {
    return cachedRequest(
      `/networks/${encodeURIComponent(network)}/tokens/${encodeURIComponent(assetAddress.toLowerCase())}`,
      tokenSchema,
      15 * 60_000,
    );
  }

  async getTokenInfo(network: string, assetAddress: string) {
    return cachedRequest(
      `/networks/${encodeURIComponent(network)}/tokens/${encodeURIComponent(assetAddress.toLowerCase())}/info`,
      tokenInfoSchema,
      15 * 60_000,
    );
  }
}

let client: CoinGeckoClient | undefined;
export function getCoinGeckoClient() {
  return client ??= new CoinGeckoClient();
}

export function getCoinGeckoProviderCallCounts() {
  return { ...providerCalls };
}

export function resetCoinGeckoProviderCallCounts() {
  providerCalls.public = 0;
  providerCalls.demo = 0;
}
