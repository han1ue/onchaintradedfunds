import { describe, expect, it, vi } from "vitest";
import { QuoteFailure, quoteFailureCode, quoteFailureReasons } from "./quote-errors";
import { unavailableQuoteResponse } from "./quote-diagnostics";
import { parseTypedQuoteResponse } from "./swap-model";

const input = { address: "0x0000000000000000000000000000000000000001", kind: "erc20", decimals: 18, name: "Input", symbol: "IN", metadataResolved: true } as const;
const output = { ...input, address: "0x0000000000000000000000000000000000000002", kind: "otf", isFactoryVault: true } as const;
const request = { route: "basket", chainId: 4663, input, output, requestedAt: 1000, inputAmount: "1", slippageBps: 50 } as const;

describe("quote failure diagnostics", () => {
  it("retains failure codes and the log reference through client parsing without exposing private provider data", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const cause = Object.assign(new Error("https://private-rpc.example/API_SECRET Authorization: Bearer SECRET"), { data: { errorName: "BootstrapPriceOutOfBounds" } });
      const result = unavailableQuoteResponse(request, "routing", new QuoteFailure("NO_ROUTE", { cause }, { tokenIn: input.address, tokenOut: output.address }));
      const parsed = parseTypedQuoteResponse(result.body, { request, route: "basket", chainId: 4663, now: 1000 });
      expect(parsed).toMatchObject({ state: "unavailable", failureCode: "NO_ROUTE", requestId: result.body.requestId, reason: quoteFailureReasons.NO_ROUTE });
      expect(warn).toHaveBeenCalledWith("[swap-quotes] unavailable", expect.objectContaining({ requestId: result.body.requestId, chainId: 4663, stage: "routing", code: "NO_ROUTE", error: expect.objectContaining({ tokenOut: output.address, cause: expect.objectContaining({ revert: "BootstrapPriceOutOfBounds" }) }) }));
      const visible = JSON.stringify([result, warn.mock.calls]);
      expect(visible).not.toContain("SECRET");
      expect(visible).not.toContain("private-rpc");
    } finally { warn.mockRestore(); }
  });

  it.each([
    [{ name: "TimeoutError" }, "QUOTE_TIMEOUT"],
    [{ name: "HttpRequestError", cause: { name: "TimeoutError" } }, "QUOTE_TIMEOUT"],
    [{ name: "HttpRequestError", status: 429 }, "PROVIDER_RATE_LIMITED"],
    [{ name: "HttpRequestError", status: 503 }, "PROVIDER_UNAVAILABLE"],
    [new AggregateError([new QuoteFailure("NO_ROUTE"), new QuoteFailure("PROVIDER_RATE_LIMITED")]), "PROVIDER_RATE_LIMITED"],
    [new QuoteFailure("SIMULATION_FAILED", { cause: new Error("revert") }), "SIMULATION_FAILED"],
  ])("classifies nested provider and execution failures", (error, code) => {
    expect(quoteFailureCode(error)).toBe(code);
  });

  it("rejects unrecognized failure metadata", () => {
    const context = { request, route: "basket" as const, chainId: 4663, now: 1000 };
    const body = { state: "unavailable", route: "basket", reason: "Unavailable" };
    expect(() => parseTypedQuoteResponse({ ...body, code: "FORGED_CODE" }, context)).toThrow("failure code");
    expect(() => parseTypedQuoteResponse({ ...body, requestId: "arbitrary diagnostic text" }, context)).toThrow("reference");
  });
});
