import { QuoteFailure } from "./quote-errors";
import { robinhoodMainnetUniswap } from "./deployment";
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";

const API_BASE = "https://trade-api.gateway.uniswap.org/v1";
const MAX_QUEUE_WAIT_MS = 10_000;
type RequestPath = "quote" | "swap";
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type SharedProviderSlot = (keyHash: string, cooldownUntil?: number) => Promise<number>;
export const databaseProviderSlot: SharedProviderSlot = async (keyHash, cooldownUntil = 0) => {
  const url = process.env.UNISWAP_RATE_LIMIT_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new QuoteFailure("PROVIDER_UNAVAILABLE");
  try {
    const rows = await neon(url).query("SELECT otf_shared.provider_slot($1,$2) AS wait_ms", [keyHash,cooldownUntil], { fetchOptions: { signal: AbortSignal.timeout(3_000) } });
    return Number(rows[0].wait_ms);
  } catch (cause) { throw new QuoteFailure("PROVIDER_UNAVAILABLE", { cause }); }
};

/** One Postgres row per API key coordinates all environments and Vercel instances. */
export function createUniswapProviderRequest(sharedSlot: SharedProviderSlot = databaseProviderSlot) {

  return async (path: RequestPath, body: Record<string, unknown>, apiKey: string): Promise<unknown> => {
    const routerVersion = robinhoodMainnetUniswap.universalRouterVersion;
    if (!routerVersion) throw new QuoteFailure("ROUTE_NOT_CONFIGURED");
    const keyHash = createHash("sha256").update(apiKey).digest("hex");
    const deadline = Date.now() + MAX_QUEUE_WAIT_MS;
    for (let attempt = 0; attempt < 3; attempt++) {
      let admitted = false;
      for (let poll=0; poll<60 && Date.now()<deadline; poll++) {
        const wait = await sharedSlot(keyHash);
        if (wait === 0) { admitted = true; break; }
        if (Date.now()+wait>deadline) break;
        await sleep(Math.max(1,wait));
      }
      if (!admitted) throw new QuoteFailure("PROVIDER_RATE_LIMITED");
      const response = await fetch(`${API_BASE}/${path}`, {
        method: "POST", cache: "no-store",
        headers: { accept: "application/json", "content-type": "application/json", "x-api-key": apiKey,
          "x-universal-router-version": routerVersion,
          "x-agent-info": '{"integration_name":"swap-integration","decision_origin":"human_mediated","version":"1.5.0"}' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(12_000),
      });
      if (response.ok) return response.json();
      if (response.status !== 429) throw new QuoteFailure(response.status === 404 && path === "quote" ? "NO_ROUTE" : "PROVIDER_UNAVAILABLE", { cause: { status: response.status } });
      const retryAfter = response.headers.get("retry-after");
      const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
      const parsedDelay = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(retryAfter ?? "") - Date.now();
      const delay = Number.isFinite(parsedDelay) ? Math.max(1_000, parsedDelay) : 1_000 * (attempt + 1);
      await sharedSlot(keyHash, Date.now() + delay);
    }
    throw new QuoteFailure("PROVIDER_RATE_LIMITED", { cause: { status: 429 } });
  };
}

export const requestUniswapProvider = createUniswapProviderRequest();
