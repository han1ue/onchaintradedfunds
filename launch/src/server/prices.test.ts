import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicApiError } from "@/lib/errors";
import { assertCompleteProposalPriceCapture, fetchAssetPriceQuotes } from "./prices";

afterEach(() => vi.unstubAllGlobals());

describe("mixed asset price sources", () => {
  const assets = [
    { id: "stock", symbol: "AAPL", priceSource: "robinhood-bid" as const },
    { id: "eth", symbol: "ETH", priceSource: "coinbase-eth-usd-bid" as const },
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

describe("proposal price acceptance gate", () => {
  const assets = [{ symbol: "AAPL" }, { symbol: "NVDA" }];

  it("rejects a proposal unless every constituent was stored in one complete capture", () => {
    expect(() => assertCompleteProposalPriceCapture({ runId: "run", sampledAt: new Date(), stored: 1, complete: false, missing: ["NVDA"] }, assets))
      .toThrowError("PROPOSAL_PRICE_UNAVAILABLE");
    try {
      assertCompleteProposalPriceCapture({ runId: "run", sampledAt: new Date(), stored: 1, complete: false, missing: ["NVDA"] }, assets);
    } catch (error) {
      expect(error).toBeInstanceOf(PublicApiError);
      expect((error as PublicApiError).metadata).toEqual({ missingSymbols: ["NVDA"] });
    }
  });

  it("returns the auditable complete checkpoint reference used by acceptance", () => {
    expect(assertCompleteProposalPriceCapture({ runId: "complete-run", sampledAt: new Date(), stored: 2, complete: true, missing: [] }, assets)).toBe("complete-run");
  });

  it("fails before draft, challenge, or evidence state can be mutated", () => {
    const state = { proposal: "draft", challengeConsumed: false, evidenceCreated: false };
    expect(() => {
      assertCompleteProposalPriceCapture({ runId: "partial-run", sampledAt: new Date(), stored: 1, complete: false, missing: ["NVDA"] }, assets);
      state.proposal = "accepted";
      state.challengeConsumed = true;
      state.evidenceCreated = true;
    }).toThrowError("PROPOSAL_PRICE_UNAVAILABLE");
    expect(state).toEqual({ proposal: "draft", challengeConsumed: false, evidenceCreated: false });
  });
});
