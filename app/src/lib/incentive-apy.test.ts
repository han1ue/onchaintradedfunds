import { describe, expect, it } from "vitest";
import {
  coinGeckoEthUsd,
  estimatedRewardsApy,
  incentiveWeekAt,
  OTF_INCENTIVE_TOTAL,
  OTF_INCENTIVE_WEEKS,
  weeklyEmissionOtf,
  ZERO_AUM_BASELINE_USD,
} from "./incentive-apy";

describe("OTF incentive APY model", () => {
  it("derives the one-based emission week from deployment time", () => {
    const deployedAt = Date.parse("2026-09-04T02:13:22.150Z");
    expect(incentiveWeekAt(deployedAt, deployedAt)).toBe(1);
    expect(incentiveWeekAt(deployedAt, deployedAt + 7 * 24 * 60 * 60_000)).toBe(2);
    expect(incentiveWeekAt(deployedAt, deployedAt - 1)).toBeUndefined();
  });

  it("reconciles the final week to exactly 700 million OTF", () => {
    const emissions = Array.from({ length: OTF_INCENTIVE_WEEKS }, (_, index) => weeklyEmissionOtf(index + 1));
    expect(emissions[0]).toBe(14_000_000);
    expect(emissions[1]).toBeCloseTo(13_724_484.2, 4);
    expect(emissions.at(-1)).toBeCloseTo(229_144.5478, 3);
    expect(emissions.reduce((total, emission) => total + emission, 0)).toBeCloseTo(OTF_INCENTIVE_TOTAL, 5);
    expect(weeklyEmissionOtf(OTF_INCENTIVE_WEEKS + 1)).toBe(0);
  });

  it("uses a $100 denominator only when eligible AUM is zero", () => {
    expect(estimatedRewardsApy({ weeklyEmissionOtf: 100, otfPriceUsd: 2, eligibleAumUsd: 0 })).toEqual({
      percent: 10_400,
      denominatorUsd: ZERO_AUM_BASELINE_USD,
      usesZeroAumBaseline: true,
    });
    expect(estimatedRewardsApy({ weeklyEmissionOtf: 100, otfPriceUsd: 2, eligibleAumUsd: 50 })).toEqual({
      percent: 20_800,
      denominatorUsd: 50,
      usesZeroAumBaseline: false,
    });
  });

  it("parses CoinGecko's Ethereum USD response", () => {
    expect(coinGeckoEthUsd({ ethereum: { usd: 4_321.5, last_updated_at: 1_788_480_000 } })).toEqual({
      priceUsd: 4_321.5,
      updatedAt: 1_788_480_000,
    });
    expect(coinGeckoEthUsd({ ethereum: { usd: 0 } })).toBeUndefined();
  });
});
