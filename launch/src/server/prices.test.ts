import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAssetPriceQuotes, getAmbiguousNonAddressPriceAssetIds, isPriceQuoteFresh } from "./prices";

afterEach(() => vi.unstubAllGlobals());

describe("mixed asset price sources", () => {
  const assets = [
    { id: "stock", symbol: "AAPL", contractAddress: "0x0000000000000000000000000000000000000001", priceSource: "robinhood-bid" as const },
    { id: "eth", symbol: "ETH", contractAddress: "0x0000000000000000000000000000000000000002", priceSource: "coinbase-eth-usd-bid" as const },
  ];

  it("captures Robinhood stock bids and the Coinbase ETH-USD bid together", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      return url.includes("robinhood")
        ? new Response(JSON.stringify({ quotes: [{ tokenSymbol: "AAPL", bid: "225.25", generatedAt: "2026-08-16T12:00:00.000Z" }] }))
        : new Response(JSON.stringify({ bid: "4580.10", time: "2026-08-16T12:00:01.086600684Z" }));
    }));

    const result = await fetchAssetPriceQuotes(assets);

    expect(result.errors).toEqual([]);
    expect(result.quotes.get("robinhood-bid:AAPL")?.bid).toBe("225.25");
    expect(result.quotes.get("coinbase-eth-usd-bid:ETH")?.bid).toBe("4580.10");
  });

  it("keeps successful quotes when one provider is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("coinbase")) return new Response("unavailable", { status: 503 });
      return new Response(JSON.stringify({ quotes: [{ tokenSymbol: "AAPL", bid: "225.25", generatedAt: "2026-08-16T12:00:00.000Z" }] }));
    }));

    const result = await fetchAssetPriceQuotes(assets);

    expect(result.quotes.get("robinhood-bid:AAPL")?.bid).toBe("225.25");
    expect(result.quotes.has("coinbase-eth-usd-bid:ETH")).toBe(false);
    expect(result.errors).toEqual([{ source: "coinbase-eth-usd-bid", message: "COINBASE_ETH_USD_503" }]);
  });
});

describe("price quote freshness", () => {
  const reference = new Date("2026-08-20T12:00:00.000Z");

  it("accepts a quote inside the freshness window", () => {
    expect(isPriceQuoteFresh(new Date("2026-08-20T11:30:00.000Z"), reference, 45 * 60_000)).toBe(true);
  });

  it("rejects stale and invalid quote timestamps", () => {
    expect(isPriceQuoteFresh(new Date("2026-08-20T11:14:59.999Z"), reference, 45 * 60_000)).toBe(false);
    expect(isPriceQuoteFresh(new Date(Number.NaN), reference, 45 * 60_000)).toBe(false);
  });

  it("allows no more than five minutes of future clock skew", () => {
    expect(isPriceQuoteFresh(new Date("2026-08-20T12:05:00.000Z"), reference, 45 * 60_000)).toBe(true);
    expect(isPriceQuoteFresh(new Date("2026-08-20T12:05:00.001Z"), reference, 45 * 60_000)).toBe(false);
  });
});

describe("provider price identities", () => {
  it("marks every non-address asset sharing a provider and symbol as ambiguous", () => {
    const ambiguous = getAmbiguousNonAddressPriceAssetIds([
      { id: "aapl-one", symbol: "AAPL", contractAddress: "0x0000000000000000000000000000000000000001", priceSource: "robinhood-bid" },
      { id: "aapl-two", symbol: "aapl", contractAddress: "0x0000000000000000000000000000000000000002", priceSource: "robinhood-bid" },
      { id: "aapl-other-source", symbol: "AAPL", contractAddress: "0x0000000000000000000000000000000000000003", priceSource: "coinbase-eth-usd-bid" },
      { id: "address-one", symbol: "DUP", contractAddress: "0x0000000000000000000000000000000000000004", priceSource: "coingecko-usd" },
      { id: "address-two", symbol: "DUP", contractAddress: "0x0000000000000000000000000000000000000005", priceSource: "coingecko-usd" },
    ]);

    expect([...ambiguous].sort()).toEqual(["aapl-one", "aapl-two"]);
  });
});
