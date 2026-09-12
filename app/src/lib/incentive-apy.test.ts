import { describe, expect, it } from "vitest";
import {
  accountedRewardWeightOtf,
  cappedRewardWeightOtf,
  coinGeckoEthUsd,
  estimatedRewardsApy,
  incentiveWeekAt,
  OTF_CREATOR_INCENTIVE_TOTAL,
  OTF_DEPOSITOR_INCENTIVE_TOTAL,
  OTF_INCENTIVE_TOTAL,
  OTF_INCENTIVE_WEEKS,
  OTF_REWARD_WEIGHT_CAP,
  weeklyEmissionBucketsOtf,
  weeklyEmissionOtf,
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

  it("splits every weekly distribution between depositors and creators", () => {
    expect(weeklyEmissionBucketsOtf(1)).toEqual({
      total: 14_000_000,
      depositors: 13_000_000,
      creators: 1_000_000,
    });
    const buckets = Array.from(
      { length: OTF_INCENTIVE_WEEKS },
      (_, index) => weeklyEmissionBucketsOtf(index + 1),
    );
    expect(buckets.reduce((total, bucket) => total + bucket.depositors, 0)).toBeCloseTo(OTF_DEPOSITOR_INCENTIVE_TOTAL, 5);
    expect(buckets.reduce((total, bucket) => total + bucket.creators, 0)).toBeCloseTo(OTF_CREATOR_INCENTIVE_TOTAL, 5);
  });

  it("caps pro-rata reward weight at 10 million OTF", () => {
    expect(cappedRewardWeightOtf(2_500_000)).toBe(2_500_000);
    expect(cappedRewardWeightOtf(OTF_REWARD_WEIGHT_CAP + 1)).toBe(OTF_REWARD_WEIGHT_CAP);
    expect(cappedRewardWeightOtf(-1)).toBeUndefined();
  });

  it("weights only the protocol OTF constituent's accounted balance", () => {
    expect(accountedRewardWeightOtf(["0xAb", "0xCd"], [3n * 10n ** 18n, 100n * 10n ** 18n], "0xaB")).toBe(3);
    expect(accountedRewardWeightOtf(["0xCd"], [100n * 10n ** 18n], "0xAb")).toBe(0);
    expect(accountedRewardWeightOtf(["0xAb"], [20_000_000n * 10n ** 18n], "0xAb")).toBe(10_000_000);
    expect(accountedRewardWeightOtf(["0xAb"], [0n], "0xAb")).toBe(0);
    expect(accountedRewardWeightOtf(["0xAb"], [], "0xAb")).toBeUndefined();
    expect(accountedRewardWeightOtf(["0xAb"], [-1n], "0xAb")).toBeUndefined();
  });

  const apyInput = {
    weeklyDepositorEmissionOtf: 10,
    otfPriceUsd: 2,
    fundAumUsd: 500,
    fundRewardWeightOtf: 5_000_000,
    totalRewardWeightOtf: 25_000_000,
  };

  it("allocates 20%, 40%, 40%, and 0% to funds holding 5M, 10M, 20M, and no OTF", () => {
    const weights = [5_000_000, 10_000_000, 20_000_000, 0].map((balance) => cappedRewardWeightOtf(balance)!);
    const totalRewardWeightOtf = weights.reduce((total, weight) => total + weight, 0);
    const apys = weights.map((fundRewardWeightOtf) => estimatedRewardsApy({ ...apyInput, fundRewardWeightOtf, totalRewardWeightOtf })!.percent);
    expect(apys[0]).toBeCloseTo((1.008 ** 52 - 1) * 100, 10);
    expect(apys[1]).toBeCloseTo((1.016 ** 52 - 1) * 100, 10);
    expect(apys[2]).toBe(apys[1]);
    expect(apys[3]).toBe(0);
  });

  it("returns zero APY at zero NAV without a calculation baseline", () => {
    expect(estimatedRewardsApy({ ...apyInput, fundAumUsd: 0 })).toMatchObject({ percent: 0, weeklyRewardOtf: 0, weeklyRewardUsd: 0 });
    expect(estimatedRewardsApy({ ...apyInput, fundAumUsd: 0, otfPriceUsd: NaN })).toMatchObject({ percent: 0 });
  });

  it("gives equal rates to different-sized funds with the same OTF-to-NAV ratio", () => {
    const first = estimatedRewardsApy({ ...apyInput, fundRewardWeightOtf: 287_000, fundAumUsd: 2_870 })!;
    const second = estimatedRewardsApy({ ...apyInput, fundRewardWeightOtf: 231_000, fundAumUsd: 2_310 })!;
    expect(first.percent).toBeCloseTo(second.percent, 10);
  });

  it("gives different rates when OTF balances differ at the same NAV", () => {
    const first = estimatedRewardsApy({ ...apyInput, fundRewardWeightOtf: 287_000 })!;
    const second = estimatedRewardsApy({ ...apyInput, fundRewardWeightOtf: 231_000 })!;
    expect(first.percent).toBeGreaterThan(second.percent);
    expect(first.weeklyRewardOtf / second.weeklyRewardOtf).toBeCloseTo(287 / 231, 10);
  });

  it("returns zero APY for no OTF weight, including an entirely empty directory", () => {
    expect(estimatedRewardsApy({ ...apyInput, fundRewardWeightOtf: 0 })).toMatchObject({ percent: 0, weeklyRewardOtf: 0 });
    expect(estimatedRewardsApy({ ...apyInput, fundRewardWeightOtf: 0, totalRewardWeightOtf: 0, otfPriceUsd: NaN })).toMatchObject({ percent: 0 });
  });

  it("caps APY and weekly rewards using actual positive NAV, including tiny funds", () => {
    for (const fundAumUsd of [1e-12, 1, 20, 40]) {
      const estimate = estimatedRewardsApy({ ...apyInput, fundAumUsd })!;
      expect(estimate.capped).toBe(true);
      expect(estimate.percent).toBeLessThanOrEqual(10000);
      expect((1 + estimate.weeklyRewardUsd / fundAumUsd) ** 52).toBeLessThanOrEqual(101 + 1e-12);
    }
    expect(estimatedRewardsApy({ ...apyInput, fundAumUsd: 40 })!.percent).toBeCloseTo(10000, 10);
  });

  it("compounds uncapped weekly returns and keeps zero emissions at zero", () => {
    const estimate = estimatedRewardsApy({ ...apyInput, fundAumUsd: 100 })!;
    expect(estimate).toMatchObject({ weeklyRewardOtf: 2, weeklyRewardUsd: 4, capped: false });
    expect(estimate.percent).toBeCloseTo((1.04 ** 52 - 1) * 100, 10);
    expect(estimatedRewardsApy({ ...apyInput, weeklyDepositorEmissionOtf: 0 })).toEqual({ percent: 0, weeklyRewardOtf: 0, weeklyRewardUsd: 0, capped: false });
  });

  it("does not invent APY from missing prices or invalid reward totals", () => {
    expect(estimatedRewardsApy({ ...apyInput, otfPriceUsd: NaN })).toBeUndefined();
    expect(estimatedRewardsApy({ ...apyInput, fundAumUsd: NaN })).toBeUndefined();
    expect(estimatedRewardsApy({ ...apyInput, totalRewardWeightOtf: 0 })).toBeUndefined();
    expect(estimatedRewardsApy({ ...apyInput, totalRewardWeightOtf: 1 })).toBeUndefined();
    expect(estimatedRewardsApy({ ...apyInput, fundRewardWeightOtf: 20_000_000 })).toBeUndefined();
  });

  it("parses CoinGecko's Ethereum USD response", () => {
    expect(coinGeckoEthUsd({ ethereum: { usd: 4_321.5, last_updated_at: 1_788_480_000 } })).toEqual({
      priceUsd: 4_321.5,
      updatedAt: 1_788_480_000,
    });
    expect(coinGeckoEthUsd({ ethereum: { usd: 0 } })).toBeUndefined();
  });
});
