import { z } from "zod";

const optionalUrl = z.string().url().optional().or(z.literal(""));

const schema = z.object({
  NEXT_PUBLIC_SITE_URL: optionalUrl.default("http://localhost:3001"),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().optional(),
  AUTH_SECRET: z.string().min(32).optional(),
  AUTH_X_CONSUMER_KEY: z.string().optional(),
  AUTH_X_CONSUMER_SECRET: z.string().optional(),
  TWITTERAPI_IO_API_KEY: z.string().optional(),
  DATABASE_URL: optionalUrl,
  REDIS_URL: z.string().regex(/^rediss?:\/\//).optional().or(z.literal("")),
  TURNSTILE_SECRET_KEY: z.string().optional(),
  TURNSTILE_HOSTNAMES: z.string().optional(),
  CRON_SECRET: z.string().min(16).optional(),
  IP_HASH_SECRET: z.string().min(16).optional(),
  ADMIN_X_IDS: z.string().optional()
});

export const env = schema.parse(process.env);
export const isDatabaseConfigured = Boolean(env.DATABASE_URL);
export const isXConfigured = Boolean(env.AUTH_X_CONSUMER_KEY && env.AUTH_X_CONSUMER_SECRET && env.TWITTERAPI_IO_API_KEY);
export const adminXIds = new Set((env.ADMIN_X_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean));
