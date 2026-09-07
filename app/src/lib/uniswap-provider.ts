import { QuoteFailure } from "./quote-errors";

const API_BASE = "https://trade-api.gateway.uniswap.org/v1";
const REQUEST_SPACING_MS = 210; // Fewer than six starts in any one-second window per process.
const MAX_QUEUE_WAIT_MS = 10_000;
type RequestPath = "check_approval" | "quote" | "swap";
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Paces one server process; 429 handling also covers traffic from other processes using the key. */
export function createUniswapProviderRequest() {
  let queue = Promise.resolve();
  let nextStart = 0;
  let cooldownUntil = 0;

  async function slot(deadline: number) {
    const previous = queue;
    let release!: () => void;
    queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      while (true) {
        const now = Date.now();
        const start = Math.max(now, nextStart, cooldownUntil);
        if (start > deadline) throw new QuoteFailure("PROVIDER_RATE_LIMITED");
        if (start <= now) { nextStart = now + REQUEST_SPACING_MS; return; }
        await sleep(start - now);
      }
    } finally { release(); }
  }

  return async (path: RequestPath, body: Record<string, unknown>, apiKey: string): Promise<unknown> => {
    const deadline = Date.now() + MAX_QUEUE_WAIT_MS;
    for (let attempt = 0; attempt < 3; attempt++) {
      await slot(deadline);
      const response = await fetch(`${API_BASE}/${path}`, {
        method: "POST", cache: "no-store",
        headers: { accept: "application/json", "content-type": "application/json", "x-api-key": apiKey },
        body: JSON.stringify(body), signal: AbortSignal.timeout(12_000),
      });
      if (response.ok) return response.json();
      if (response.status !== 429) throw new QuoteFailure(response.status === 404 && path === "quote" ? "NO_ROUTE" : "PROVIDER_UNAVAILABLE", { cause: { status: response.status } });
      const retryAfter = response.headers.get("retry-after");
      const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
      const parsedDelay = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(retryAfter ?? "") - Date.now();
      const delay = Number.isFinite(parsedDelay) ? Math.max(1_000, parsedDelay) : 1_000 * (attempt + 1);
      cooldownUntil = Math.max(cooldownUntil, Date.now() + delay);
    }
    throw new QuoteFailure("PROVIDER_RATE_LIMITED", { cause: { status: 429 } });
  };
}

export const requestUniswapProvider = createUniswapProviderRequest();
