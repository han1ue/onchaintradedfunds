export const EXPERIMENTAL_THRESHOLDS = {
  liquidityUsd: 30_000,
  marketCapUsd: 100_000,
  poolAgeMs: 7 * 86_400_000,
  continuityMs: 7 * 86_400_000,
  gtScore: 60,
  lockedLiquidityPct: 50,
  maxTradeImpactPct: 2,
  // Seven full 24-hour intervals need both boundary checkpoints.
  minimumHourlyCheckpoints: 169,
  maximumCheckpointGapMs: 90 * 60_000,
} as const;

export type EligibilityStatus = "Pass" | "Pending" | "Fail";

export type ExperimentalEligibilityEvidence = {
  sampledAt: Date;
  competitionStartsAt: Date | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  marketCapVerified: boolean | null;
  poolCreatedAt: Date | null;
  observationsReady24h: boolean | null;
  gtVerified: boolean | null;
  gtScore: number | null;
  isHoneypot: boolean | null;
  criticalSellOrTaxFlag: boolean | null;
  lockedLiquidityPct: number | null;
  buyImpactPct: number | null;
  sellImpactPct: number | null;
};

export type EligibilityResult = {
  status: EligibilityStatus;
  reasons: string[];
};

export function evaluateCompetitionPoolAge(
  poolCreatedAt: Date | null,
  competitionStartsAt: Date | null,
): EligibilityResult {
  if (poolCreatedAt === null) {
    return { status: "Pending", reasons: ["Pool creation time is unavailable"] };
  }
  if (competitionStartsAt === null) {
    return { status: "Pending", reasons: ["Competition start time is unavailable"] };
  }
  const latestEligibleCreationTime = competitionStartsAt.getTime() - EXPERIMENTAL_THRESHOLDS.poolAgeMs;
  if (poolCreatedAt.getTime() > latestEligibleCreationTime) {
    return {
      status: "Fail",
      reasons: ["Pool was not at least seven days old when the competition started"],
    };
  }
  return { status: "Pass", reasons: [] };
}

export function evaluateExperimentalEvidence(
  evidence: ExperimentalEligibilityEvidence,
): EligibilityResult {
  const pending: string[] = [];
  const failed: string[] = [];
  const required = <T>(value: T | null, label: string) => {
    if (value === null) pending.push(`${label} is unavailable`);
    return value;
  };

  const liquidity = required(evidence.liquidityUsd, "Pool liquidity");
  if (liquidity !== null && liquidity < EXPERIMENTAL_THRESHOLDS.liquidityUsd) {
    failed.push("Pool liquidity is below $30,000");
  }
  const marketCap = required(evidence.marketCapUsd, "Verified market cap");
  const marketCapVerified = required(evidence.marketCapVerified, "Market-cap verification");
  if (marketCapVerified === false) failed.push("Market cap is not verified");
  if (marketCap !== null && marketCap < EXPERIMENTAL_THRESHOLDS.marketCapUsd) {
    failed.push("Verified market cap is below $100,000");
  }
  const poolAge = evaluateCompetitionPoolAge(evidence.poolCreatedAt, evidence.competitionStartsAt);
  if (poolAge.status === "Pending") pending.push(...poolAge.reasons);
  if (poolAge.status === "Fail") failed.push(...poolAge.reasons);

  const observationsReady = required(evidence.observationsReady24h, "24-hour TWAP observations");
  if (observationsReady === false) failed.push("Pool does not have a complete 24-hour scoring TWAP");
  const gtVerified = required(evidence.gtVerified, "GT verification");
  if (gtVerified === false) failed.push("GT verification is false");
  const gtScore = required(evidence.gtScore, "GT score");
  if (gtScore !== null && gtScore < EXPERIMENTAL_THRESHOLDS.gtScore) {
    failed.push("GT score is below 60");
  }
  const honeypot = required(evidence.isHoneypot, "Honeypot evidence");
  if (honeypot === true) failed.push("Token is flagged as a honeypot");
  const criticalFlag = required(evidence.criticalSellOrTaxFlag, "Sell-block and tax safety evidence");
  if (criticalFlag === true) failed.push("Token has a critical sell-block or tax flag");
  const locked = required(evidence.lockedLiquidityPct, "Locked-liquidity evidence");
  if (locked !== null && locked < EXPERIMENTAL_THRESHOLDS.lockedLiquidityPct) {
    failed.push("Reported locked liquidity is below 50%");
  }
  const buyImpact = required(evidence.buyImpactPct, "$1,000 buy simulation");
  if (buyImpact !== null && buyImpact > EXPERIMENTAL_THRESHOLDS.maxTradeImpactPct) {
    failed.push("$1,000 buy impact exceeds 2%");
  }
  const sellImpact = required(evidence.sellImpactPct, "$1,000 sell simulation");
  if (sellImpact !== null && sellImpact > EXPERIMENTAL_THRESHOLDS.maxTradeImpactPct) {
    failed.push("$1,000 sell impact exceeds 2%");
  }

  if (failed.length > 0) return { status: "Fail", reasons: failed };
  if (pending.length > 0) return { status: "Pending", reasons: pending };
  return { status: "Pass", reasons: [] };
}

export function evaluateSevenDayContinuity(
  snapshots: { sampledAt: Date; status: EligibilityStatus }[],
  now: Date,
): EligibilityResult {
  const start = now.getTime() - EXPERIMENTAL_THRESHOLDS.continuityMs;
  const window = snapshots
    .filter((snapshot) => snapshot.sampledAt.getTime() >= start && snapshot.sampledAt <= now)
    .sort((left, right) => left.sampledAt.getTime() - right.sampledAt.getTime());
  if (window.some((snapshot) => snapshot.status === "Fail")) {
    return { status: "Fail", reasons: ["At least one hourly checkpoint failed during the last seven days"] };
  }
  if (window.some((snapshot) => snapshot.status === "Pending")) {
    return { status: "Pending", reasons: ["At least one hourly checkpoint is pending during the last seven days"] };
  }
  if (window.length < EXPERIMENTAL_THRESHOLDS.minimumHourlyCheckpoints) {
    return { status: "Pending", reasons: ["Seven consecutive days of hourly checkpoints are not complete"] };
  }
  if (
    window[0].sampledAt.getTime() > start + EXPERIMENTAL_THRESHOLDS.maximumCheckpointGapMs ||
    window[window.length - 1].sampledAt.getTime()
      < now.getTime() - EXPERIMENTAL_THRESHOLDS.maximumCheckpointGapMs
  ) {
    return { status: "Pending", reasons: ["The seven-day checkpoint window is not fully covered"] };
  }
  for (let index = 1; index < window.length; index += 1) {
    if (
      window[index].sampledAt.getTime() - window[index - 1].sampledAt.getTime()
        > EXPERIMENTAL_THRESHOLDS.maximumCheckpointGapMs
    ) {
      return { status: "Pending", reasons: ["An hourly eligibility checkpoint is missing"] };
    }
  }
  return { status: "Pass", reasons: [] };
}
