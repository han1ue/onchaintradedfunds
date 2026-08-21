import { z } from "zod";

const optionalUrl = z.string().url().optional().or(z.literal(""));

const schema = z.object({
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().optional(),
  AUTH_SECRET: z.string().min(32).optional(),
  AUTH_X_CONSUMER_KEY: z.string().optional(),
  AUTH_X_CONSUMER_SECRET: z.string().optional(),
  TWITTERAPI_IO_API_KEY: z.string().optional(),
  DATABASE_URL: optionalUrl,
  REDIS_URL: z.string().regex(/^rediss?:\/\//).optional().or(z.literal("")),
  TURNSTILE_SECRET_KEY: z.string().optional(),
  CRON_SECRET: z.string().min(16).optional(),
  IP_HASH_SECRET: z.string().min(16).optional(),
  ADMIN_X_IDS: z.string().optional(),
  COINGECKO_DEMO_API_KEY: z.string().optional(),
  COINGECKO_NETWORK_ID: z.string().optional(),
  ROBINHOOD_V3_FACTORY_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  ROBINHOOD_WETH_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  ROBINHOOD_USDG_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  ROBINHOOD_V3_SUPPORTED_FEES: z.string().default("3000"),
  ROBINHOOD_RPC_URL: optionalUrl.default("https://rpc.mainnet.chain.robinhood.com")
});

export const env = schema.parse(process.env);

if (process.env.NODE_ENV === "production") {
  const missing = [
    ["REDIS_URL", env.REDIS_URL],
    ["NEXT_PUBLIC_TURNSTILE_SITE_KEY", env.NEXT_PUBLIC_TURNSTILE_SITE_KEY],
    ["TURNSTILE_SECRET_KEY", env.TURNSTILE_SECRET_KEY],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`PRODUCTION_ABUSE_CONTROLS_REQUIRED:${missing.join(",")}`);
}

export const isDatabaseConfigured = Boolean(env.DATABASE_URL);
export const isXConfigured = Boolean(env.AUTH_X_CONSUMER_KEY && env.AUTH_X_CONSUMER_SECRET && env.TWITTERAPI_IO_API_KEY);
export const adminXIds = new Set((env.ADMIN_X_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean));
