import { createHash } from "node:crypto";

export const XP_POOLS = {
  participation: 2_750_000,
  verifiedPerformance: 3_500_000,
  nonVerifiedPerformance: 1_750_000,
  performance: 5_250_000,
  creator: 2_000_000,
} as const;
export const XP_SCORE_SCALE = 1_000_000_000_000n;

export type XpTrancheScoreInput = {
  id: string;
  voterUserId: string;
  proposalId: string;
  proposalCreatorUserId: string;
  quantity: number;
  performancePool: "verified" | "nonVerified";
  effectiveEntryAt?: Date;
  selectedReturn?: bigint;
  comparisonReturns?: { proposalId: string; returnValue: bigint }[];
};

export type CreatorXpInput = {
  proposalId: string;
  creatorUserId: string;
  votes: number;
};

export type XpUserResult = {
  userId: string;
  performanceXp: number;
  participationXp: number;
  creatorXp: number;
  creatorSupportXp: number;
  creatorAwardXp: number;
  totalXp: number;
  uniqueSupporterCount: number;
  submissionBoost: boolean;
  pendingTrancheCount: number;
};

export function releasedXp(pool: number, votingStartsAt: Date, votingEndsAt: Date, calculatedAt: Date, final = false) {
  if (final || calculatedAt >= votingEndsAt) return pool;
  if (calculatedAt <= votingStartsAt) return 0;
  const elapsed = BigInt(calculatedAt.getTime() - votingStartsAt.getTime());
  const duration = BigInt(votingEndsAt.getTime() - votingStartsAt.getTime());
  return Number(BigInt(pool) * elapsed / duration);
}

export function largestRemainderAllocate(pool: number, scores: { id: string; score: bigint }[]) {
  const positive = scores.filter((entry) => entry.score > 0n).sort((left, right) => left.id.localeCompare(right.id));
  const result = new Map(scores.map((entry) => [entry.id, 0]));
  if (pool <= 0 || positive.length === 0) return result;
  const total = positive.reduce((sum, entry) => sum + entry.score, 0n);
  const rows = positive.map((entry) => {
    const numerator = BigInt(pool) * entry.score;
    const allocated = numerator / total;
    return { ...entry, allocated, remainder: numerator % total };
  });
  let remaining = pool - rows.reduce((sum, row) => sum + Number(row.allocated), 0);
  rows.sort((left, right) => left.remainder === right.remainder ? left.id.localeCompare(right.id) : left.remainder > right.remainder ? -1 : 1);
  for (const row of rows) {
    const extra = remaining > 0 ? 1 : 0;
    result.set(row.id, Number(row.allocated) + extra);
    remaining -= extra;
  }
  return result;
}

export function tieAwarePercentile(results: { proposalId: string; returnValue: bigint }[], selectedProposalId: string) {
  const selected = results.find((result) => result.proposalId === selectedProposalId);
  if (!selected || results.length === 0) throw new Error("SELECTED_RETURN_MISSING");
  if (results.length === 1) return XP_SCORE_SCALE;
  const allTied = results.every((result) => result.returnValue === selected.returnValue);
  if (allTied) return XP_SCORE_SCALE / 2n;
  const worse = results.filter((result) => result.returnValue < selected.returnValue).length;
  const tied = results.filter((result) => result.returnValue === selected.returnValue).length;
  return XP_SCORE_SCALE * BigInt(2 * worse + tied - 1) / BigInt(2 * (results.length - 1));
}

export function maturityFactor(entryAt: Date, calculatedAt: Date) {
  const elapsed = Math.max(0, calculatedAt.getTime() - entryAt.getTime());
  return elapsed >= 86_400_000 ? XP_SCORE_SCALE : BigInt(elapsed) * XP_SCORE_SCALE / 86_400_000n;
}

export function performanceScore(quantity: number, percentile: bigint, maturity: bigint) {
  return BigInt(quantity) * percentile * percentile * maturity / (XP_SCORE_SCALE * XP_SCORE_SCALE);
}

export function parseFixedPrice(value: string | number, decimals = 8) {
  const normalized = String(value);
  const [whole = "0", fraction = ""] = normalized.split(".");
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction)) throw new Error("INVALID_PRICE");
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals));
}

export function syntheticPortfolioReturn(
  allocations: { assetId: string; weightBps: number }[],
  entryPrices: Map<string, bigint>,
  currentPrices: Map<string, bigint>,
) {
  const indexed = allocations.reduce((sum, allocation) => {
    const entry = entryPrices.get(allocation.assetId);
    const current = currentPrices.get(allocation.assetId);
    if (!entry || !current || entry <= 0n || current <= 0n) throw new Error("INCOMPLETE_PRICE_SNAPSHOT");
    return sum + BigInt(allocation.weightBps) * current * XP_SCORE_SCALE / entry;
  }, 0n) / 10_000n;
  return indexed - XP_SCORE_SCALE;
}

export function eligibleProposalIdsAt<T extends { id: string; acceptedAt: string | Date }>(proposals: T[], acceptedAt: Date) {
  return proposals.filter((proposal) => new Date(proposal.acceptedAt) <= acceptedAt).map((proposal) => proposal.id);
}

export function stableCanonicalHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function calculateXp(input: {
  votingStartsAt: Date;
  votingEndsAt: Date;
  calculatedAt: Date;
  final?: boolean;
  tranches: XpTrancheScoreInput[];
  creators: CreatorXpInput[];
}) {
  const released = {
    performance: input.final ? XP_POOLS.performance : 0,
    verifiedPerformance: input.final ? XP_POOLS.verifiedPerformance : 0,
    nonVerifiedPerformance: input.final ? XP_POOLS.nonVerifiedPerformance : 0,
    participation: releasedXp(XP_POOLS.participation, input.votingStartsAt, input.votingEndsAt, input.calculatedAt, input.final),
    creator: releasedXp(XP_POOLS.creator, input.votingStartsAt, input.votingEndsAt, input.calculatedAt, input.final),
  };
  const userIds = new Set<string>();
  const participationScores = new Map<string, bigint>();
  const verifiedPerformanceScores = new Map<string, bigint>();
  const nonVerifiedPerformanceScores = new Map<string, bigint>();
  const pendingCounts = new Map<string, number>();
  for (const tranche of input.tranches) {
    userIds.add(tranche.voterUserId);
    participationScores.set(tranche.voterUserId, (participationScores.get(tranche.voterUserId) ?? 0n) + BigInt(tranche.quantity));
    if (!tranche.effectiveEntryAt || tranche.selectedReturn === undefined || !tranche.comparisonReturns) {
      pendingCounts.set(tranche.voterUserId, (pendingCounts.get(tranche.voterUserId) ?? 0) + 1);
      continue;
    }
    const percentile = tieAwarePercentile(tranche.comparisonReturns, tranche.proposalId);
    const score = performanceScore(tranche.quantity, percentile, maturityFactor(tranche.effectiveEntryAt, input.calculatedAt));
    const performanceScores = tranche.performancePool === "verified" ? verifiedPerformanceScores : nonVerifiedPerformanceScores;
    performanceScores.set(tranche.voterUserId, (performanceScores.get(tranche.voterUserId) ?? 0n) + score);
  }

  const supporters = new Map<string, Set<string>>();
  for (const tranche of input.tranches) {
    if (tranche.voterUserId === tranche.proposalCreatorUserId) continue;
    const set = supporters.get(tranche.proposalId) ?? new Set<string>();
    set.add(tranche.voterUserId);
    supporters.set(tranche.proposalId, set);
  }
  const creatorScores = new Map<string, bigint>();
  const creatorSupporters = new Map<string, number>();
  for (const creator of input.creators) {
    userIds.add(creator.creatorUserId);
    const count = supporters.get(creator.proposalId)?.size ?? 0;
    creatorScores.set(creator.creatorUserId, (creatorScores.get(creator.creatorUserId) ?? 0n) + BigInt(creator.votes));
    creatorSupporters.set(creator.creatorUserId, (creatorSupporters.get(creator.creatorUserId) ?? 0) + count);
  }

  const scoreRows = (scores: Map<string, bigint>) => [...scores].map(([id, score]) => ({ id, score }));
  const hasPositiveScore = (scores: Map<string, bigint>) => [...scores.values()].some((score) => score > 0n);
  let verifiedPerformancePool = released.verifiedPerformance;
  let nonVerifiedPerformancePool = released.nonVerifiedPerformance;
  let participationPool = released.participation;
  const rollovers = {
    verifiedPerformanceToParticipation: 0,
    nonVerifiedPerformanceToParticipation: 0,
    performanceToParticipation: 0,
  };
  if (input.final && !hasPositiveScore(verifiedPerformanceScores)) {
    rollovers.verifiedPerformanceToParticipation = verifiedPerformancePool;
    participationPool += verifiedPerformancePool;
    verifiedPerformancePool = 0;
  }
  if (input.final && !hasPositiveScore(nonVerifiedPerformanceScores)) {
    rollovers.nonVerifiedPerformanceToParticipation = nonVerifiedPerformancePool;
    participationPool += nonVerifiedPerformancePool;
    nonVerifiedPerformancePool = 0;
  }
  rollovers.performanceToParticipation = rollovers.verifiedPerformanceToParticipation + rollovers.nonVerifiedPerformanceToParticipation;

  const verifiedPerformance = largestRemainderAllocate(verifiedPerformancePool, scoreRows(verifiedPerformanceScores));
  const nonVerifiedPerformance = largestRemainderAllocate(nonVerifiedPerformancePool, scoreRows(nonVerifiedPerformanceScores));
  const participation = largestRemainderAllocate(participationPool, scoreRows(participationScores));
  const creator = largestRemainderAllocate(released.creator, scoreRows(creatorScores));
  const users = [...userIds].sort().map<XpUserResult>((userId) => {
    const performanceXp = (verifiedPerformance.get(userId) ?? 0) + (nonVerifiedPerformance.get(userId) ?? 0);
    const participationXp = participation.get(userId) ?? 0;
    const creatorXp = creator.get(userId) ?? 0;
    const creatorSupportXp = creatorXp;
    const creatorAwardXp = 0;
    return {
      userId,
      performanceXp,
      participationXp,
      creatorXp,
      creatorSupportXp,
      creatorAwardXp,
      totalXp: performanceXp + participationXp + creatorXp,
      uniqueSupporterCount: creatorSupporters.get(userId) ?? 0,
      submissionBoost: false,
      pendingTrancheCount: pendingCounts.get(userId) ?? 0,
    };
  });
  const allocated = {
    performance: users.reduce((sum, user) => sum + user.performanceXp, 0),
    verifiedPerformance: [...verifiedPerformance.values()].reduce((sum, value) => sum + value, 0),
    nonVerifiedPerformance: [...nonVerifiedPerformance.values()].reduce((sum, value) => sum + value, 0),
    participation: users.reduce((sum, user) => sum + user.participationXp, 0),
    creatorSupport: users.reduce((sum, user) => sum + user.creatorSupportXp, 0),
    creatorAwards: users.reduce((sum, user) => sum + user.creatorAwardXp, 0),
    creator: users.reduce((sum, user) => sum + user.creatorXp, 0),
  };
  return { released, allocated, rollovers, users };
}
