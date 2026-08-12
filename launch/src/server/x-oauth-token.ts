import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { env } from "./env";
import { requireDb } from "./db";
import { accounts } from "./db/schema";

const prefix = "enc:v1:";

function key() {
  const secret = env.AUTH_SECRET ?? (process.env.NODE_ENV !== "production" ? "otf-launch-local-development-secret" : undefined);
  if (!secret) throw new Error("X_UNAVAILABLE");
  return createHash("sha256").update(secret).digest();
}

export function encryptOAuthToken(value: string | null | undefined) {
  if (!value || value.startsWith(prefix)) return value ?? null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${prefix}${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${encrypted.toString("base64url")}`;
}

function decryptOAuthToken(value: string | null | undefined) {
  if (!value) return null;
  if (!value.startsWith(prefix)) return value;
  const [iv, tag, encrypted] = value.slice(prefix.length).split(":");
  if (!iv || !tag || !encrypted) throw new Error("X_RECONNECT_REQUIRED");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("X_RECONNECT_REQUIRED");
  }
}

async function refreshAccessToken(userId: string, refreshToken: string) {
  if (!env.AUTH_X_ID || !env.AUTH_X_SECRET) throw new Error("X_RECONNECT_REQUIRED");
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: env.AUTH_X_ID });
  const response = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.AUTH_X_ID}:${env.AUTH_X_SECRET}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body,
    cache: "no-store"
  });
  if (!response.ok) throw new Error("X_RECONNECT_REQUIRED");
  const result = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; token_type?: string };
  if (!result.access_token) throw new Error("X_RECONNECT_REQUIRED");
  const database = requireDb();
  await database.update(accounts).set({
    access_token: encryptOAuthToken(result.access_token),
    refresh_token: encryptOAuthToken(result.refresh_token ?? refreshToken),
    expires_at: result.expires_in ? Math.floor(Date.now() / 1000) + result.expires_in : null,
    scope: result.scope,
    token_type: result.token_type
  }).where(and(eq(accounts.userId, userId), eq(accounts.provider, "twitter")));
  return result.access_token;
}

export async function getXUserAccessToken(userId: string) {
  const database = requireDb();
  const [account] = await database.select().from(accounts).where(and(eq(accounts.userId, userId), eq(accounts.provider, "twitter"))).limit(1);
  if (!account) throw new Error("X_RECONNECT_REQUIRED");
  const accessToken = decryptOAuthToken(account.access_token);
  if (!accessToken) throw new Error("X_RECONNECT_REQUIRED");
  const expiresSoon = account.expires_at !== null && account.expires_at <= Math.floor(Date.now() / 1000) + 60;
  if (!expiresSoon) return accessToken;
  const refreshToken = decryptOAuthToken(account.refresh_token);
  if (!refreshToken) throw new Error("X_RECONNECT_REQUIRED");
  return refreshAccessToken(userId, refreshToken);
}
