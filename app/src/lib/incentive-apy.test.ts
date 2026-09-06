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
    weeklyDepositorEmissionOtf: 100,
    otfPriceUsd: 2,
    fundAumUsd: 50,
    fundRewardWeightOtf: 5_000_000,
    totalRewardWeightOtf: 25_000_000,
  };

  it("allocates 20%, 40%, 40%, and 0% to funds holding 5M, 10M, 20M, and no OTF", () => {
    const weights = [5_000_000, 10_000_000, 20_000_000, 0].map((balance) => cappedRewardWeightOtf(balance)!);
    const totalRewardWeightOtf = weights.reduce((total, weight) => total + weight, 0);
    const apys = weights.map((fundRewardWeightOtf) => estimatedRewardsApy({ ...apyInput, fundRewardWeightOtf, totalRewardWeightOtf })!.percent);
    expect(apys).toEqual([4160, 8320, 8320, 0]);
    expect(apys.reduce((total, apy) => total + apy, 0)).toBe(20_800);
  });

  it("returns zero APY at zero NAV without a calculation baseline", () => {
    expect(estimatedRewardsApy({ ...apyInput, fundAumUsd: 0 })).toEqual({ percent: 0 });
    expect(estimatedRewardsApy({ ...apyInput, fundAumUsd: 0, otfPriceUsd: NaN })).toEqual({ percent: 0 });
  });

  it("returns zero APY for no OTF weight, including an entirely empty directory", () => {
    expect(estimatedRewardsApy({ ...apyInput, fundRewardWeightOtf: 0 })).toEqual({ percent: 0 });
    expect(estimatedRewardsApy({ ...apyInput, fundRewardWeightOtf: 0, totalRewardWeightOtf: 0, otfPriceUsd: NaN })).toEqual({ percent: 0 });
  });

  it("uses actual positive NAV even below $100", () => {
    expect(estimatedRewardsApy({ ...apyInput, fundAumUsd: 1 })).toEqual({ percent: 208_000 });
    expect(estimatedRewardsApy({ ...apyInput, fundAumUsd: 50 })).toEqual({ percent: 4160 });
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
