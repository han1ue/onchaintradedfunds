import { afterEach, describe, expect, it, vi } from "vitest";
import { CoinGeckoClient } from "./coingecko";

afterEach(() => vi.unstubAllGlobals());

describe("shared CoinGecko client", () => {
  it("uses the public GeckoTerminal endpoint without authentication", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: { attributes: { token_prices: { "0x0000000000000000000000000000000000000001": "1.25" } } },
    })));
    vi.stubGlobal("fetch", fetchMock);

    await new CoinGeckoClient().getTokenPrices("robinhood-mainnet", ["0x0000000000000000000000000000000000000001"]);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.geckoterminal.com/api/v2/simple/networks/robinhood-mainnet/token_price/0x0000000000000000000000000000000000000001");
    expect((init.headers as Record<string, string>)["x-cg-demo-api-key"]).toBeUndefined();
  });

  it("deduplicates concurrent requests for the same cache key", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: { attributes: { token_prices: { "0x0000000000000000000000000000000000000002": "2.5" } } },
    })));
    vi.stubGlobal("fetch", fetchMock);
    const client = new CoinGeckoClient();

    await Promise.all([
      client.getTokenPrices("robinhood-mainnet", ["0x0000000000000000000000000000000000000002"]),
      client.getTokenPrices("robinhood-mainnet", ["0x0000000000000000000000000000000000000002"]),
    ]);

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("retries a transient public failure within the bounded retry budget", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { attributes: { token_prices: { "0x0000000000000000000000000000000000000003": "3.5" } } },
      })));
    vi.stubGlobal("fetch", fetchMock);

    await new CoinGeckoClient().getTokenPrices("robinhood-mainnet", ["0x0000000000000000000000000000000000000003"]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to the Demo endpoint with only the Demo header after public failure", async () => {
    const previousKey = process.env.COINGECKO_DEMO_API_KEY;
    process.env.COINGECKO_DEMO_API_KEY = "demo-test-key";
    vi.resetModules();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { attributes: { token_prices: { "0x0000000000000000000000000000000000000004": "4.5" } } },
      })));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const { CoinGeckoClient: ReloadedCoinGeckoClient } = await import("./coingecko");
      await new ReloadedCoinGeckoClient().getTokenPrices("robinhood-mainnet", ["0x0000000000000000000000000000000000000004"]);
      const [, , demoCall] = fetchMock.mock.calls as unknown as [unknown, unknown, [string, RequestInit]];
      expect(demoCall[0]).toContain("https://api.coingecko.com/api/v3/onchain/");
      expect((demoCall[1].headers as Record<string, string>)["x-cg-demo-api-key"]).toBe("demo-test-key");
    } finally {
      if (previousKey === undefined) delete process.env.COINGECKO_DEMO_API_KEY;
      else process.env.COINGECKO_DEMO_API_KEY = previousKey;
    }
  });
});
