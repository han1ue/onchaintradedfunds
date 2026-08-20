import { createClient } from "redis";
import { env } from "./env";

export const ASSET_VALIDATION_CACHE_TTL_MS = 30 * 60_000;
export const ASSET_VALIDATION_MEMORY_CACHE_MAX_ENTRIES = 500;
export const ASSET_VALIDATION_MAX_IN_FLIGHT = 100;

type CacheEntry = { expiresAt: number; value: unknown };
type RedisClient = ReturnType<typeof createClient>;

const memoryCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();
const globalForValidationCache = globalThis as unknown as {
  launchValidationRedis?: RedisClient;
  launchValidationRedisPromise?: Promise<RedisClient>;
};

async function getRedis() {
  if (!env.REDIS_URL) return null;
  if (globalForValidationCache.launchValidationRedis?.isReady) return globalForValidationCache.launchValidationRedis;
  if (!globalForValidationCache.launchValidationRedisPromise) {
    const client = createClient({ url: env.REDIS_URL });
    client.on("error", () => undefined);
    globalForValidationCache.launchValidationRedisPromise = client.connect().then(() => {
      globalForValidationCache.launchValidationRedis = client;
      return client;
    }).catch((error) => {
      globalForValidationCache.launchValidationRedisPromise = undefined;
      throw error;
    });
  }
  return globalForValidationCache.launchValidationRedisPromise;
}

function namespacedKey(key: string) {
  return `otf-launch:asset-validation:${key}`;
}

function storeInMemory(key: string, entry: CacheEntry) {
  const now = Date.now();
  for (const [cachedKey, cached] of memoryCache) {
    if (cached.expiresAt <= now) memoryCache.delete(cachedKey);
  }
  memoryCache.delete(key);
  while (memoryCache.size >= ASSET_VALIDATION_MEMORY_CACHE_MAX_ENTRIES) {
    const oldest = memoryCache.keys().next().value;
    if (oldest === undefined) break;
    memoryCache.delete(oldest);
  }
  memoryCache.set(key, entry);
}

async function readCache<T>(key: string): Promise<T | null> {
  const local = memoryCache.get(key);
  if (local) {
    if (local.expiresAt > Date.now()) {
      storeInMemory(key, local);
      return local.value as T;
    }
    memoryCache.delete(key);
  }
  try {
    const redis = await getRedis();
    if (!redis) return null;
    const value = await redis.get(key);
    if (!value) return null;
    const parsed = JSON.parse(value) as T;
    storeInMemory(key, { expiresAt: Date.now() + 60_000, value: parsed });
    return parsed;
  } catch {
    return null;
  }
}

async function writeCache(key: string, value: unknown) {
  storeInMemory(key, { expiresAt: Date.now() + ASSET_VALIDATION_CACHE_TTL_MS, value });
  try {
    const redis = await getRedis();
    if (redis) await redis.setEx(key, Math.ceil(ASSET_VALIDATION_CACHE_TTL_MS / 1_000), JSON.stringify(value));
  } catch {
    // Redis is an optimization. The in-memory cache remains available when it is unavailable.
  }
}

export async function cachedAssetValidation<T>(key: string, load: () => Promise<T>) {
  const cacheKey = namespacedKey(key);
  const cached = await readCache<T>(cacheKey);
  if (cached !== null) return cached;
  const existing = inFlight.get(cacheKey);
  if (existing) return existing as Promise<T>;
  if (inFlight.size >= ASSET_VALIDATION_MAX_IN_FLIGHT) throw new Error("ASSET_MARKET_VALIDATION_UNAVAILABLE");
  const request = load().then(async (value) => {
    await writeCache(cacheKey, value);
    return value;
  }).finally(() => inFlight.delete(cacheKey));
  inFlight.set(cacheKey, request);
  return request;
}
