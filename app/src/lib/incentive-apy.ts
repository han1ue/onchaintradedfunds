import {
  cappedDepositorAllocation,
  OTF_REWARD_WEIGHT_CAP,
  OTF_REWARDS_APY_CAP_PERCENT,
  REWARD_WEEKS_PER_YEAR,
  weeklyEmissionBucketsRaw,
} from "../../../scripts/lib/reward-policy.mjs";

export {
  OTF_INCENTIVE_WEEKS,
  OTF_INCENTIVE_TOTAL,
  OTF_DEPOSITOR_INCENTIVE_TOTAL,
  OTF_CREATOR_INCENTIVE_TOTAL,
  OTF_WEEK_ONE_EMISSION,
  OTF_WEEKLY_DECAY_FACTOR,
  OTF_REWARD_WEIGHT_CAP,
  OTF_REWARDS_APY_CAP_PERCENT,
} from "../../../scripts/lib/reward-policy.mjs";

const WEEK_MS = 7 * 24 * 60 * 60_000;

export function incentiveWeekAt(deployedAtMs: number, nowMs: number): number | undefined {
  if (!Number.isFinite(deployedAtMs) || !Number.isFinite(nowMs) || nowMs < deployedAtMs) return undefined;
  return Math.floor((nowMs - deployedAtMs) / WEEK_MS) + 1;
}

export function weeklyEmissionOtf(week: number): number {
  return Number(weeklyEmissionBucketsRaw(week).total) / 1e18;
}

export function weeklyEmissionBucketsOtf(week: number) {
  const buckets = weeklyEmissionBucketsRaw(week);
  return {
    total: Number(buckets.total) / 1e18,
    depositors: Number(buckets.depositors) / 1e18,
    creators: Number(buckets.creators) / 1e18,
  };
}

export function cappedRewardWeightOtf(eligibleBalanceOtf: number): number | undefined {
  if (!Number.isFinite(eligibleBalanceOtf) || eligibleBalanceOtf < 0) return undefined;
  return Math.min(eligibleBalanceOtf, OTF_REWARD_WEIGHT_CAP);
}

export function accountedRewardWeightOtf(assets: readonly string[], balances: readonly bigint[], otfToken: string): number | undefined {
  const index = assets.findIndex((asset) => asset.toLowerCase() === otfToken.toLowerCase());
  if (index === -1) return 0;
  if (balances.length !== assets.length || balances[index] < 0n) return undefined;
  const capRaw = BigInt(OTF_REWARD_WEIGHT_CAP) * 10n ** 18n;
  return Number(balances[index] > capRaw ? capRaw : balances[index]) / 1e18;
}

function estimatedAmountRaw(value: number): bigint {
  const [coefficient, exponent = "0"] = value.toString().split("e");
  const [whole, fraction = ""] = coefficient.split(".");
  const digits = BigInt(whole + fraction);
  const shift = 18 + Number(exponent) - fraction.length;
  return shift >= 0 ? digits * 10n ** BigInt(shift) : digits / 10n ** BigInt(-shift);
}

export function estimatedRewardsApy(input: {
  weeklyDepositorEmissionOtf: number;
  otfPriceUsd: number;
  fundAumUsd: number;
  fundRewardWeightOtf: number;
  totalRewardWeightOtf: number;
}) {
  if (input.fundAumUsd === 0 || input.fundRewardWeightOtf === 0) {
    return { percent: 0, weeklyRewardOtf: 0, weeklyRewardUsd: 0, capped: false };
  }
  if (
    !Number.isFinite(input.weeklyDepositorEmissionOtf) || input.weeklyDepositorEmissionOtf < 0
    || !Number.isFinite(input.otfPriceUsd) || input.otfPriceUsd <= 0
    || !Number.isFinite(input.fundAumUsd) || input.fundAumUsd < 0
    || !Number.isFinite(input.fundRewardWeightOtf) || input.fundRewardWeightOtf < 0 || input.fundRewardWeightOtf > OTF_REWARD_WEIGHT_CAP
    || !Number.isFinite(input.totalRewardWeightOtf) || input.totalRewardWeightOtf < input.fundRewardWeightOtf
  ) return undefined;
  // Live values are estimates. Publication parses decimal strings directly into bigint.
  const [weeklyDepositorEmissionRaw, fundNavUsdRaw, otfPriceUsdRaw, fundWeightRaw, totalWeightRaw] =
    [input.weeklyDepositorEmissionOtf, input.fundAumUsd, input.otfPriceUsd,
      input.fundRewardWeightOtf, input.totalRewardWeightOtf].map(estimatedAmountRaw);
  if (otfPriceUsdRaw === 0n) return undefined;
  const allocation = cappedDepositorAllocation({ weeklyDepositorEmissionRaw, fundNavUsdRaw, otfPriceUsdRaw, fundWeightRaw, totalWeightRaw });
  const weeklyRewardOtf = Number(allocation.allocatedRaw) / 1e18;
  const weeklyRewardUsd = weeklyRewardOtf * input.otfPriceUsd;
  return {
    percent: Math.min(OTF_REWARDS_APY_CAP_PERCENT, weeklyRewardUsd * REWARD_WEEKS_PER_YEAR / input.fundAumUsd * 100),
    weeklyRewardOtf,
    weeklyRewardUsd,
    capped: allocation.capped,
  };
}

export function coinGeckoEthUsd(value: unknown): { priceUsd: number; updatedAt?: number } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const ethereum = (value as Record<string, unknown>).ethereum;
  if (!ethereum || typeof ethereum !== "object" || Array.isArray(ethereum)) return undefined;
  const row = ethereum as Record<string, unknown>;
  if (typeof row.usd !== "number" || !Number.isFinite(row.usd) || row.usd <= 0) return undefined;
  return {
    priceUsd: row.usd,
    updatedAt: typeof row.last_updated_at === "number" && Number.isSafeInteger(row.last_updated_at)
      ? row.last_updated_at
      : undefined,
  };
}
