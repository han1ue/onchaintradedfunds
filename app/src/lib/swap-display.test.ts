import { describe, expect, it } from "vitest";
import { formatSwapDisplay, quoteRefreshDelay } from "./swap-display";
import { QUOTE_MAX_AGE_MS, type SwapQuote } from "./swap-model";

describe("swap display", () => {
  it("truncates displayed amounts without rounding a minimum upward or losing integer precision", () => {
    expect(formatSwapDisplay("0.12342465352345")).toBe("0.12342465");
    expect(formatSwapDisplay("999999999999999999.123456789")).toBe("999999999999999999.12345678");
    expect(formatSwapDisplay("1.230000000")).toBe("1.23");
    expect(formatSwapDisplay("0.000000001")).toBe("<0.00000001");
    expect(formatSwapDisplay("0.000000000")).toBe("0");
    expect(formatSwapDisplay(undefined)).toBe("—");
    expect(formatSwapDisplay("0.123456789 ETH")).toBe("0.12345678 ETH");
  });
});

describe("quote refresh scheduling", () => {
  const quote: SwapQuote = { id: "basket", route: "basket", routeLabel: "Mint basket", state: "available", inputAmount: "1", queriedAt: 100_000 };
  it("refreshes before the age limit even when provider expiry is later", () => {
    expect(quoteRefreshDelay([{ ...quote, expiresAt: 200_000 }], 100_000)).toBe(QUOTE_MAX_AGE_MS - 5_000);
  });
  it("uses the earliest provider expiry across routes", () => {
    expect(quoteRefreshDelay([quote, { ...quote, expiresAt: 110_000 }], 100_000)).toBe(5_000);
  });
  it("does not overlap an in-flight request and backs off unavailable routes", () => {
    expect(quoteRefreshDelay([], 100_000)).toBeUndefined();
    expect(quoteRefreshDelay([{ ...quote, state: "loading" }], 100_000)).toBeUndefined();
    expect(quoteRefreshDelay([{ ...quote, state: "unavailable" }], 100_000)).toBe(30_000);
    expect(quoteRefreshDelay([quote], 130_000)).toBe(1_000);
  });
});
