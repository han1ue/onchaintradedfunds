import { describe, expect, it } from "vitest";
import { burnedSupply, feeBenefitRows, quoteCanonicalOtfSwap } from "./otf-market";

describe("OTF market model", () => {
  it("calculates current and burned supply from the immutable original supply", () => {
    expect(burnedSupply(1_000_000_000n, 975_000_000n)).toEqual({ burned: 25_000_000n, burnedBps: 250 });
  });

  it("quotes both token orderings consistently", () => {
    const base = {
      side: "buy" as const,
      amountIn: 1_000_000_000_000n,
      slippageBps: 50,
      liquidity: 10n ** 30n,
      lowerSqrtPriceX96: 1n,
      upperSqrtPriceX96: 2n ** 150n,
      otfPriceWethWad: 10_000_000_000n,
    };
    const direct = quoteCanonicalOtfSwap({ ...base, sqrtPriceX96: 2n ** 96n / 10_000n, otfIsCurrency0: true });
    const inverse = quoteCanonicalOtfSwap({ ...base, sqrtPriceX96: 2n ** 96n * 10_000n, otfIsCurrency0: false });
    expect(direct.amountOut).toBeGreaterThan(0n);
    expect(inverse.amountOut).toBeGreaterThan(0n);
    expect(direct.minimumReceived).toBeLessThan(direct.amountOut);
    expect(inverse.minimumReceived).toBeLessThan(inverse.amountOut);
  });

  it("keeps the documented fee curve reference rows", () => {
    expect(feeBenefitRows().at(-1)).toEqual({ otf: "10m+", creator: "90%", buyback: "10%" });
  });
});
