import { createHash } from "node:crypto";

export const XP_POLICY_VERSION = "unified-assets-provider-snapshots-v4";
export const XP_POOLS = {
  participation: 3_500_000,
  performance: 4_500_000,
  creatorSupport: 1_500_000,
  creatorAwards: 500_000,
  creator: 2_000_000,
} as const;
export const TOP_TEN_CREATOR_AWARDS = [232_000, 120_000, 70_000, 30_000, 20_000, 12_000, 8_000, 5_000, 2_000, 1_000] as const;
export const XP_SCORE_SCALE = 1_000_000_000_000n;

export type XpTrancheScoreInput = {
  id: string;
  voterUserId: string;
  proposalId: string;
  proposalCreatorUserId: string;
  quantity: number;
  effectiveEntryAt?: Date;
  selectedReturn?: bigint;
  comparisonReturns?: { proposalId: string; returnValue: bigint }[];
};

export type CreatorXpInput = {
  proposalId: string;
  creatorUserId: string;
  acceptedAt: Date;
  finalRank?: number;
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

export function integerSqrt(value: bigint) {
  if (value < 0n) throw new Error("NEGATIVE_SQUARE_ROOT");
  if (value < 2n) return value;
  let left = 1n;
  let right = value;
  while (left <= right) {
    const middle = (left + right) / 2n;
    const square = middle * middle;
    if (square === value) return middle;
    if (square < value) left = middle + 1n;
    else right = middle - 1n;
  }
  return right;
}

export function creatorScore(uniqueSupporters: number, boosted: boolean) {
  const base = integerSqrt(BigInt(uniqueSupporters) * XP_SCORE_SCALE * XP_SCORE_SCALE);
  return boosted ? base * 3n / 2n : base;
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
    participation: releasedXp(XP_POOLS.participation, input.votingStartsAt, input.votingEndsAt, input.calculatedAt, input.final),
    creatorSupport: releasedXp(XP_POOLS.creatorSupport, input.votingStartsAt, input.votingEndsAt, input.calculatedAt, input.final),
    creatorAwards: input.final ? XP_POOLS.creatorAwards : 0,
    creator: 0,
  };
  released.creator = released.creatorSupport + released.creatorAwards;
  const userIds = new Set<string>();
  const participationScores = new Map<string, bigint>();
  const performanceScores = new Map<string, bigint>();
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
  const creatorAwards = new Map<string, number>();
  const creatorSupporters = new Map<string, number>();
  const creatorBoost = new Map<string, boolean>();
  for (const creator of input.creators) {
    userIds.add(creator.creatorUserId);
    const count = supporters.get(creator.proposalId)?.size ?? 0;
    const boosted = creator.acceptedAt < input.votingStartsAt;
    creatorScores.set(creator.creatorUserId, (creatorScores.get(creator.creatorUserId) ?? 0n) + creatorScore(count, boosted));
    creatorSupporters.set(creator.creatorUserId, (creatorSupporters.get(creator.creatorUserId) ?? 0) + count);
    creatorBoost.set(creator.creatorUserId, (creatorBoost.get(creator.creatorUserId) ?? false) || boosted);
  }
  if (input.final) {
    const awardedRanks = new Set<number>();
    for (const creator of [...input.creators].sort(
      (left, right) => (left.finalRank ?? 11) - (right.finalRank ?? 11) || left.proposalId.localeCompare(right.proposalId),
    )) {
      const rank = creator.finalRank;
      if (!rank || rank < 1 || rank > 10 || awardedRanks.has(rank)) continue;
      awardedRanks.add(rank);
      creatorAwards.set(
        creator.creatorUserId,
        (creatorAwards.get(creator.creatorUserId) ?? 0) + TOP_TEN_CREATOR_AWARDS[rank - 1],
      );
    }
  }

  const scoreRows = (scores: Map<string, bigint>) => [...scores].map(([id, score]) => ({ id, score }));
  const hasPositiveScore = (scores: Map<string, bigint>) => [...scores.values()].some((score) => score > 0n);
  let performancePool = released.performance;
  let participationPool = released.participation;
  const rollovers = {
    performanceToParticipation: 0,
    creatorAwardsToSupport: 0,
  };
  if (input.final && !hasPositiveScore(performanceScores)) {
    rollovers.performanceToParticipation = performancePool;
    participationPool += performancePool;
    performancePool = 0;
  }

  const fixedCreatorAwards = [...creatorAwards.values()].reduce((sum, value) => sum + value, 0);
  rollovers.creatorAwardsToSupport = released.creatorAwards - fixedCreatorAwards;
  const creatorSupportPool = released.creatorSupport + rollovers.creatorAwardsToSupport;
  if (!hasPositiveScore(creatorScores) && input.creators.length > 0) {
    for (const creator of input.creators) creatorScores.set(creator.creatorUserId, 1n);
  }

  const performance = largestRemainderAllocate(performancePool, scoreRows(performanceScores));
  const participation = largestRemainderAllocate(participationPool, scoreRows(participationScores));
  const creatorSupport = largestRemainderAllocate(creatorSupportPool, scoreRows(creatorScores));
  const users = [...userIds].sort().map<XpUserResult>((userId) => {
    const performanceXp = performance.get(userId) ?? 0;
    const participationXp = participation.get(userId) ?? 0;
    const creatorSupportXp = creatorSupport.get(userId) ?? 0;
    const creatorAwardXp = creatorAwards.get(userId) ?? 0;
    const creatorXp = creatorSupportXp + creatorAwardXp;
    return {
      userId,
      performanceXp,
      participationXp,
      creatorXp,
      creatorSupportXp,
      creatorAwardXp,
      totalXp: performanceXp + participationXp + creatorXp,
      uniqueSupporterCount: creatorSupporters.get(userId) ?? 0,
      submissionBoost: creatorBoost.get(userId) ?? false,
      pendingTrancheCount: pendingCounts.get(userId) ?? 0,
    };
  });
  const allocated = {
    performance: users.reduce((sum, user) => sum + user.performanceXp, 0),
    participation: users.reduce((sum, user) => sum + user.participationXp, 0),
    creatorSupport: users.reduce((sum, user) => sum + user.creatorSupportXp, 0),
    creatorAwards: users.reduce((sum, user) => sum + user.creatorAwardXp, 0),
    creator: users.reduce((sum, user) => sum + user.creatorXp, 0),
  };
  return { released, allocated, rollovers, users };
}
