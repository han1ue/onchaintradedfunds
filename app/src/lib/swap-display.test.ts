import { describe, expect, it } from "vitest";
import { formatSwapDisplay, quoteRefreshDelay } from "./swap-display";

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
  it("waits 45 seconds from each request, including failed quotes", () => {
    expect(quoteRefreshDelay(100_000, 100_000)).toBe(45_000);
    expect(quoteRefreshDelay(100_000, 120_000)).toBe(25_000);
    expect(quoteRefreshDelay(100_000, 144_999)).toBe(1);
    expect(quoteRefreshDelay(100_000, 145_000)).toBe(0);
  });
  it("keeps the original deadline when route states change or the tab resumes late", () => {
    expect(quoteRefreshDelay(100_000, 130_000)).toBe(15_000);
    expect(quoteRefreshDelay(100_000, 160_000)).toBe(0);
  });
  it("resets the countdown for a manual refresh and does not schedule before the first request", () => {
    expect(quoteRefreshDelay(undefined, 100_000)).toBeUndefined();
    expect(quoteRefreshDelay(120_000, 120_000)).toBe(45_000);
  });
});
