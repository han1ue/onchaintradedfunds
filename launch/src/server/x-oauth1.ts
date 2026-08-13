import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { env } from "./env";

const requestTokenUrl = "https://api.x.com/oauth/request_token";
const accessTokenUrl = "https://api.x.com/oauth/access_token";
const authenticateUrl = "https://api.x.com/oauth/authenticate";
const oauthStateMaxAgeMs = 10 * 60 * 1000;

type OAuthState = { requestTokenSecret: string; callbackPath: string; createdAt: number };

function compare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function credentials() {
  if (!env.AUTH_X_CONSUMER_KEY || !env.AUTH_X_CONSUMER_SECRET) throw new Error("X_UNAVAILABLE");
  return { consumerKey: env.AUTH_X_CONSUMER_KEY, consumerSecret: env.AUTH_X_CONSUMER_SECRET };
}

function percentEncode(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function oauthParameters(extra: Record<string, string> = {}) {
  return {
    oauth_consumer_key: credentials().consumerKey,
    oauth_nonce: randomBytes(24).toString("base64url"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: "1.0",
    ...extra,
  };
}

function signature(method: string, url: string, parameters: Record<string, string>, tokenSecret = "") {
  const normalized = Object.entries(parameters)
    .map(([key, value]) => [percentEncode(key), percentEncode(value)] as const)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => compare(leftKey, rightKey) || compare(leftValue, rightValue))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  const base = [method.toUpperCase(), percentEncode(url), percentEncode(normalized)].join("&");
  const signingKey = `${percentEncode(credentials().consumerSecret)}&${percentEncode(tokenSecret)}`;
  return createHmac("sha1", signingKey).update(base).digest("base64");
}

function authorizationHeader(parameters: Record<string, string>) {
  return `OAuth ${Object.entries(parameters)
    .sort(([left], [right]) => compare(left, right))
    .map(([key, value]) => `${percentEncode(key)}="${percentEncode(value)}"`)
    .join(", ")}`;
}

async function signedPost(url: string, oauthExtra: Record<string, string>, body: Record<string, string> = {}, tokenSecret = "") {
  const oauth = oauthParameters(oauthExtra);
  const oauthSignature = signature("POST", url, { ...oauth, ...body }, tokenSecret);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: authorizationHeader({ ...oauth, oauth_signature: oauthSignature }),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("X_UNAVAILABLE");
  return new URLSearchParams(await response.text());
}

export function canonicalXAuthOrigin(requestUrl: URL) {
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (productionHost) return `https://${productionHost}`;
  if (env.NEXT_PUBLIC_SITE_URL && !env.NEXT_PUBLIC_SITE_URL.startsWith("http://localhost")) return new URL(env.NEXT_PUBLIC_SITE_URL).origin;
  return requestUrl.origin;
}

export function sanitizeCallbackPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const parsed = new URL(value, "https://otf.invalid");
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

export async function requestXOAuthToken(callbackUrl: string) {
  const result = await signedPost(requestTokenUrl, { oauth_callback: callbackUrl }, { x_auth_access_type: "read" });
  const requestToken = result.get("oauth_token");
  const requestTokenSecret = result.get("oauth_token_secret");
  if (!requestToken || !requestTokenSecret || result.get("oauth_callback_confirmed") !== "true") throw new Error("X_UNAVAILABLE");
  return { requestToken, requestTokenSecret };
}

export function xAuthenticateUrl(requestToken: string) {
  const url = new URL(authenticateUrl);
  url.searchParams.set("oauth_token", requestToken);
  return url;
}

export async function exchangeXOAuthToken(requestToken: string, requestTokenSecret: string, verifier: string) {
  const result = await signedPost(accessTokenUrl, { oauth_token: requestToken, oauth_verifier: verifier }, {}, requestTokenSecret);
  const xUserId = result.get("user_id");
  const screenName = result.get("screen_name");
  if (!xUserId || !/^\d+$/.test(xUserId) || !screenName || !/^[A-Za-z0-9_]{1,15}$/.test(screenName)) throw new Error("X_UNAVAILABLE");
  return { xUserId, screenName };
}

function stateKey() {
  if (!env.AUTH_SECRET) throw new Error("X_UNAVAILABLE");
  return createHash("sha256").update(env.AUTH_SECRET).digest();
}

export function sealXOAuthState(state: OAuthState) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", stateKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(state), "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function openXOAuthState(value: string): OAuthState {
  try {
    const [iv, tag, encrypted] = value.split(".");
    if (!iv || !tag || !encrypted) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", stateKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const state = JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8")) as OAuthState;
    if (!state.requestTokenSecret || typeof state.callbackPath !== "string" || !Number.isFinite(state.createdAt) || Date.now() - state.createdAt > oauthStateMaxAgeMs) throw new Error();
    return state;
  } catch {
    throw new Error("X_RECONNECT_REQUIRED");
  }
}

export const xOAuthStateTtlMs = oauthStateMaxAgeMs;
