import { createHmac } from "node:crypto";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { env } from "./env";

const redis = env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
  ? new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN }) : null;

const limiters = redis ? {
  write: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(8, "10 m"), prefix: "otf-launch:write" }),
  proof: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(12, "10 m"), prefix: "otf-launch:proof" })
} : null;

export async function enforceRateLimit(kind: "write" | "proof", request: Request, actorId?: string) {
  if (!limiters) return;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const secret = env.IP_HASH_SECRET ?? env.AUTH_SECRET ?? "local-development-only";
  const ipHash = createHmac("sha256", secret).update(`${new Date().toISOString().slice(0, 10)}:${forwarded}`).digest("hex");
  const key = `${actorId ?? "anonymous"}:${ipHash}`;
  const result = await limiters[kind].limit(key);
  if (!result.success) throw new Error("RATE_LIMITED");
}

export async function verifyTurnstile(token: string | undefined, request: Request) {
  if (!env.TURNSTILE_SECRET_KEY) return;
  if (!token) throw new Error("TURNSTILE_REQUIRED");
  const body = new FormData();
  body.set("secret", env.TURNSTILE_SECRET_KEY);
  body.set("response", token);
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (ip) body.set("remoteip", ip);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  const result = await response.json() as { success: boolean };
  if (!result.success) throw new Error("TURNSTILE_FAILED");
}
