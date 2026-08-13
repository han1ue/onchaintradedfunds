import { createHmac } from "node:crypto";
import { createClient } from "redis";
import { env } from "./env";

type LaunchRedisClient = ReturnType<typeof createClient>;
const globalForRedis = globalThis as unknown as { launchRedis?: LaunchRedisClient; launchRedisPromise?: Promise<LaunchRedisClient> };

async function getRedis() {
  if (!env.REDIS_URL) return null;
  if (globalForRedis.launchRedis?.isReady) return globalForRedis.launchRedis;
  if (!globalForRedis.launchRedisPromise) {
    const client = createClient({ url: env.REDIS_URL });
    client.on("error", () => undefined);
    globalForRedis.launchRedisPromise = client.connect().then(() => {
      globalForRedis.launchRedis = client;
      return client;
    }).catch((error) => {
      globalForRedis.launchRedisPromise = undefined;
      throw error;
    });
  }
  return globalForRedis.launchRedisPromise;
}

export async function pingRedis() {
  const redis = await getRedis();
  if (!redis) return false;
  return (await redis.ping()) === "PONG";
}

const limits = { write: 8, post: 6 } as const;
const windowSeconds = 10 * 60;
const incrementWithExpiry = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
  return count
`;

export async function enforceRateLimit(kind: "write" | "post", request: Request, actorId?: string) {
  const redis = await getRedis().catch(() => { throw new Error("RATE_LIMIT_UNAVAILABLE"); });
  if (!redis) return;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const secret = env.IP_HASH_SECRET ?? env.AUTH_SECRET ?? "local-development-only";
  const day = new Date().toISOString().slice(0, 10);
  const ipHash = createHmac("sha256", secret).update(`${day}:${forwarded}`).digest("hex");
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = `otf-launch:${kind}:${bucket}:${actorId ?? "anonymous"}:${ipHash}`;
  const count = Number(await redis.eval(incrementWithExpiry, { keys: [key], arguments: [String(windowSeconds)] }).catch(() => { throw new Error("RATE_LIMIT_UNAVAILABLE"); }));
  if (count > limits[kind]) throw new Error("RATE_LIMITED");
}

export async function verifyTurnstile(token: string | undefined, request: Request, expectedAction: "submit_otf" | "vote_otf") {
  if (!env.TURNSTILE_SECRET_KEY) return;
  const expectedHostnames = new Set((env.TURNSTILE_HOSTNAMES ?? "").split(",").map((hostname) => hostname.trim()).filter(Boolean));
  if (!token || token.length > 2_048) throw new Error("TURNSTILE_REQUIRED");
  if (!expectedHostnames.size) throw new Error("TURNSTILE_FAILED");
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (ip) body.set("remoteip", ip);
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("TURNSTILE_FAILED");
    const result = await response.json() as { success?: boolean; action?: string; hostname?: string };
    if (!result.success || result.action !== expectedAction || !result.hostname || !expectedHostnames.has(result.hostname)) throw new Error("TURNSTILE_FAILED");
  } catch {
    throw new Error("TURNSTILE_FAILED");
  }
}
