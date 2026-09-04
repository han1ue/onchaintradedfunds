export const OTF_INCENTIVE_WEEKS = 208;
export const OTF_INCENTIVE_TOTAL = 700_000_000;
export const OTF_DEPOSITOR_INCENTIVE_TOTAL = 650_000_000;
export const OTF_CREATOR_INCENTIVE_TOTAL = 50_000_000;
export const OTF_WEEK_ONE_EMISSION = 14_000_000;
export const OTF_WEEKLY_DECAY_FACTOR = 0.9803203;
export const OTF_REWARD_WEIGHT_CAP = 10_000_000;
export const ZERO_AUM_BASELINE_USD = 100;

const WEEK_MS = 7 * 24 * 60 * 60_000;

export function incentiveWeekAt(deployedAtMs: number, nowMs: number): number | undefined {
  if (!Number.isFinite(deployedAtMs) || !Number.isFinite(nowMs) || nowMs < deployedAtMs) return undefined;
  return Math.floor((nowMs - deployedAtMs) / WEEK_MS) + 1;
}

export function weeklyEmissionOtf(week: number): number {
  if (!Number.isInteger(week) || week < 1 || week > OTF_INCENTIVE_WEEKS) return 0;
  if (week < OTF_INCENTIVE_WEEKS) {
    return OTF_WEEK_ONE_EMISSION * OTF_WEEKLY_DECAY_FACTOR ** (week - 1);
  }
  const first207Weeks = OTF_WEEK_ONE_EMISSION
    * (1 - OTF_WEEKLY_DECAY_FACTOR ** (OTF_INCENTIVE_WEEKS - 1))
    / (1 - OTF_WEEKLY_DECAY_FACTOR);
  return OTF_INCENTIVE_TOTAL - first207Weeks;
}

export function weeklyEmissionBucketsOtf(week: number) {
  const total = weeklyEmissionOtf(week);
  const depositors = total * OTF_DEPOSITOR_INCENTIVE_TOTAL / OTF_INCENTIVE_TOTAL;
  return {
    total,
    depositors,
    creators: total - depositors,
  };
}

export function cappedRewardWeightOtf(eligibleBalanceOtf: number): number | undefined {
  if (!Number.isFinite(eligibleBalanceOtf) || eligibleBalanceOtf < 0) return undefined;
  return Math.min(eligibleBalanceOtf, OTF_REWARD_WEIGHT_CAP);
}

export function estimatedRewardsApy(input: {
  weeklyDepositorEmissionOtf: number;
  otfPriceUsd: number;
  fundAumUsd: number;
}) {
  if (
    !Number.isFinite(input.weeklyDepositorEmissionOtf) || input.weeklyDepositorEmissionOtf < 0
    || !Number.isFinite(input.otfPriceUsd) || input.otfPriceUsd <= 0
    || !Number.isFinite(input.fundAumUsd) || input.fundAumUsd < 0
  ) return undefined;
  const usesZeroAumBaseline = input.fundAumUsd === 0;
  const denominatorUsd = usesZeroAumBaseline ? ZERO_AUM_BASELINE_USD : input.fundAumUsd;
  return {
    percent: input.weeklyDepositorEmissionOtf * input.otfPriceUsd * 52 / denominatorUsd * 100,
    denominatorUsd,
    usesZeroAumBaseline,
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
