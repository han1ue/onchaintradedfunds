export const OTF_INCENTIVE_WEEKS = 208;
export const OTF_INCENTIVE_TOTAL = 700_000_000;
export const OTF_WEEK_ONE_EMISSION = 14_000_000;
export const OTF_WEEKLY_DECAY_FACTOR = 0.9803203;
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

export function estimatedRewardsApy(input: {
  weeklyEmissionOtf: number;
  otfPriceUsd: number;
  eligibleAumUsd: number;
}) {
  if (
    !Number.isFinite(input.weeklyEmissionOtf) || input.weeklyEmissionOtf < 0
    || !Number.isFinite(input.otfPriceUsd) || input.otfPriceUsd <= 0
    || !Number.isFinite(input.eligibleAumUsd) || input.eligibleAumUsd < 0
  ) return undefined;
  const usesZeroAumBaseline = input.eligibleAumUsd === 0;
  const denominatorUsd = usesZeroAumBaseline ? ZERO_AUM_BASELINE_USD : input.eligibleAumUsd;
  return {
    percent: input.weeklyEmissionOtf * input.otfPriceUsd * 52 / denominatorUsd * 100,
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
