// Shared by the reward publisher and the application's live estimates.
export const OTF_INCENTIVE_WEEKS = 208;
export const OTF_INCENTIVE_TOTAL = 700_000_000;
export const OTF_DEPOSITOR_INCENTIVE_TOTAL = 650_000_000;
export const OTF_CREATOR_INCENTIVE_TOTAL = 50_000_000;
export const OTF_WEEK_ONE_EMISSION = 14_000_000;
export const OTF_WEEKLY_DECAY_FACTOR = 0.9803203;
export const OTF_REWARD_WEIGHT_CAP = 10_000_000;
export const OTF_REWARDS_APY_CAP_PERCENT = 10_000;
export const REWARD_WEEKS_PER_YEAR = 52;
export const REWARD_SCALE = 10n ** 18n;
// floor(((1 + 10000 / 100)^(1 / 52) - 1) * 1e18), rounded down for allocation safety.
export const OTF_REWARDS_WEEKLY_RATE_CAP_RAW = 92_809_953_046_076_968n;
export const UINT256_MAX = 2n ** 256n - 1n;

export function parseRewardDecimal(value, label = "amount") {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/u.test(value)) {
    throw new Error(`Invalid ${label}: use an unsigned decimal string with at most 18 decimal places.`);
  }
  const [whole, fraction = ""] = value.split(".");
  const raw = BigInt(whole) * REWARD_SCALE + BigInt(fraction.padEnd(18, "0"));
  if (raw > UINT256_MAX) throw new Error(`${label} exceeds uint256.`);
  return raw;
}

export function formatRewardDecimal(raw) {
  const fraction = (raw % REWARD_SCALE).toString().padStart(18, "0").replace(/0+$/u, "");
  return `${raw / REWARD_SCALE}${fraction ? `.${fraction}` : ""}`;
}

const schedule = [];
let emission = BigInt(OTF_WEEK_ONE_EMISSION) * REWARD_SCALE;
let depositorRemaining = BigInt(OTF_DEPOSITOR_INCENTIVE_TOTAL) * REWARD_SCALE;
let creatorRemaining = BigInt(OTF_CREATOR_INCENTIVE_TOTAL) * REWARD_SCALE;
for (let week = 1; week <= OTF_INCENTIVE_WEEKS; week++) {
  const depositors = week === OTF_INCENTIVE_WEEKS ? depositorRemaining : emission * 13n / 14n;
  const creators = week === OTF_INCENTIVE_WEEKS ? creatorRemaining : emission - depositors;
  schedule.push(Object.freeze({ total: depositors + creators, depositors, creators }));
  depositorRemaining -= depositors;
  creatorRemaining -= creators;
  emission = emission * 9_803_203n / 10_000_000n;
}

export function weeklyEmissionBucketsRaw(week) {
  return Number.isInteger(week) && week >= 1 && week <= OTF_INCENTIVE_WEEKS
    ? schedule[week - 1]
    : { total: 0n, depositors: 0n, creators: 0n };
}

export function cappedDepositorAllocation({ weeklyDepositorEmissionRaw, fundNavUsdRaw, otfPriceUsdRaw, fundWeightRaw, totalWeightRaw }) {
  const values = [weeklyDepositorEmissionRaw, fundNavUsdRaw, otfPriceUsdRaw, fundWeightRaw, totalWeightRaw];
  if (values.some(value => typeof value !== "bigint" || value < 0n)
    || otfPriceUsdRaw === 0n || fundWeightRaw > BigInt(OTF_REWARD_WEIGHT_CAP) * REWARD_SCALE
    || totalWeightRaw < fundWeightRaw) throw new Error("Invalid depositor allocation inputs.");
  const proportionalRaw = totalWeightRaw === 0n ? 0n : weeklyDepositorEmissionRaw * fundWeightRaw / totalWeightRaw;
  const capRaw = fundNavUsdRaw * OTF_REWARDS_WEEKLY_RATE_CAP_RAW / otfPriceUsdRaw;
  const capped = proportionalRaw > capRaw;
  return { proportionalRaw, capRaw, allocatedRaw: capped ? capRaw : proportionalRaw, capped };
}
