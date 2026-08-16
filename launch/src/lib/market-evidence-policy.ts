export const MARKET_EVIDENCE_THRESHOLDS = {
  liquidityUsd: 30_000,
  marketCapUsd: 100_000,
  poolAgeMs: 7 * 86_400_000,
  continuityMs: 7 * 86_400_000,
  gtScore: 60,
  lockedLiquidityPct: 50,
  minimumHourlyCheckpoints: 169,
  maximumCheckpointGapMs: 90 * 60_000,
} as const;

export type MarketEvidenceStatus = "Pass" | "Pending" | "Fail";

export type MarketEvidenceInput = {
  sampledAt: Date;
  competitionStartsAt: Date | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  marketCapVerified: boolean | null;
  poolCreatedAt: Date | null;
  gtVerified: boolean | null;
  gtScore: number | null;
  isHoneypot: boolean | null;
  lockedLiquidityPct: number | null;
};

export type MarketEvidenceResult = {
  status: MarketEvidenceStatus;
  reasons: string[];
};

export function evaluateCompetitionPoolAge(
  poolCreatedAt: Date | null,
  competitionStartsAt: Date | null,
): MarketEvidenceResult {
  if (poolCreatedAt === null) return { status: "Pending", reasons: ["Pool creation time is unavailable"] };
  if (competitionStartsAt === null) return { status: "Pending", reasons: ["Competition start time is unavailable"] };
  const latestCreationTime = competitionStartsAt.getTime() - MARKET_EVIDENCE_THRESHOLDS.poolAgeMs;
  if (poolCreatedAt.getTime() > latestCreationTime) {
    return { status: "Fail", reasons: ["Pool was not at least seven days old when the competition started"] };
  }
  return { status: "Pass", reasons: [] };
}

export function evaluateMarketEvidence(evidence: MarketEvidenceInput): MarketEvidenceResult {
  const pending: string[] = [];
  const failed: string[] = [];
  const required = <T>(value: T | null, label: string) => {
    if (value === null) pending.push(`${label} is unavailable`);
    return value;
  };

  const liquidity = required(evidence.liquidityUsd, "Pool liquidity");
  if (liquidity !== null && liquidity < MARKET_EVIDENCE_THRESHOLDS.liquidityUsd) failed.push("Pool liquidity is below $30,000");
  const marketCap = required(evidence.marketCapUsd, "Verified market cap");
  const marketCapVerified = required(evidence.marketCapVerified, "Market-cap verification");
  if (marketCapVerified === false) failed.push("Market cap is not verified");
  if (marketCap !== null && marketCap < MARKET_EVIDENCE_THRESHOLDS.marketCapUsd) failed.push("Verified market cap is below $100,000");
  const poolAge = evaluateCompetitionPoolAge(evidence.poolCreatedAt, evidence.competitionStartsAt);
  if (poolAge.status === "Pending") pending.push(...poolAge.reasons);
  if (poolAge.status === "Fail") failed.push(...poolAge.reasons);
  const gtVerified = required(evidence.gtVerified, "GT verification");
  if (gtVerified === false) failed.push("GT verification is false");
  const gtScore = required(evidence.gtScore, "GT score");
  if (gtScore !== null && gtScore < MARKET_EVIDENCE_THRESHOLDS.gtScore) failed.push("GT score is below 60");
  const honeypot = required(evidence.isHoneypot, "Honeypot evidence");
  if (honeypot === true) failed.push("Token is flagged as a honeypot");
  const locked = required(evidence.lockedLiquidityPct, "Locked-liquidity evidence");
  if (locked !== null && locked < MARKET_EVIDENCE_THRESHOLDS.lockedLiquidityPct) failed.push("Reported locked liquidity is below 50%");
  if (failed.length > 0) return { status: "Fail", reasons: failed };
  if (pending.length > 0) return { status: "Pending", reasons: pending };
  return { status: "Pass", reasons: [] };
}

export function evaluateMarketEvidenceContinuity(
  snapshots: { sampledAt: Date; status: MarketEvidenceStatus }[],
  now: Date,
): MarketEvidenceResult {
  const start = now.getTime() - MARKET_EVIDENCE_THRESHOLDS.continuityMs;
  const window = snapshots
    .filter((snapshot) => snapshot.sampledAt.getTime() >= start && snapshot.sampledAt <= now)
    .sort((left, right) => left.sampledAt.getTime() - right.sampledAt.getTime());
  if (window.some((snapshot) => snapshot.status === "Fail")) return { status: "Fail", reasons: ["At least one hourly evidence snapshot failed during the last seven days"] };
  if (window.some((snapshot) => snapshot.status === "Pending")) return { status: "Pending", reasons: ["At least one hourly evidence snapshot is pending during the last seven days"] };
  if (window.length < MARKET_EVIDENCE_THRESHOLDS.minimumHourlyCheckpoints) return { status: "Pending", reasons: ["Seven consecutive days of hourly evidence snapshots are not complete"] };
  if (
    window[0].sampledAt.getTime() > start + MARKET_EVIDENCE_THRESHOLDS.maximumCheckpointGapMs
    || window[window.length - 1].sampledAt.getTime() < now.getTime() - MARKET_EVIDENCE_THRESHOLDS.maximumCheckpointGapMs
  ) return { status: "Pending", reasons: ["The seven-day evidence window is not fully covered"] };
  for (let index = 1; index < window.length; index += 1) {
    if (window[index].sampledAt.getTime() - window[index - 1].sampledAt.getTime() > MARKET_EVIDENCE_THRESHOLDS.maximumCheckpointGapMs) {
      return { status: "Pending", reasons: ["An hourly evidence snapshot is missing"] };
    }
  }
  return { status: "Pass", reasons: [] };
}
