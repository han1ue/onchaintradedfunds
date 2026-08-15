import { and, eq, isNull } from "drizzle-orm";
import { PublicApiError } from "@/lib/errors";
import { getVotingStartsAt } from "@/lib/competition";
import type { XpLeaderboard } from "@/lib/types";
import {
  XP_POLICY_VERSION,
  calculateXp,
  eligibleProposalIdsAt,
  firstCompleteCheckpointAtOrAfter,
  parseFixedPrice,
  stableCanonicalHash,
  syntheticPortfolioReturn,
  type XpTrancheScoreInput,
} from "@/lib/xp";
import { requireDb, sqlClient } from "./db";
import { voteTranches, xpCalculationRuns, xpSnapshotRows } from "./db/schema";
import { publicVoterName } from "@/lib/voter-alias";

type ProposalRow = {
  id: string;
  creatorUserId: string;
  acceptedAt: string;
  allocations: { assetId: string; weightBps: number }[];
};

type TrancheRow = {
  id: string;
  voterUserId: string;
  proposalId: string;
  proposalCreatorUserId: string;
  quantity: number;
  acceptedAt: string;
  effectiveEntryAt: string | null;
};

type CaptureRun = { id: string; sampledAt: string };

export type CalculatedXpSnapshot = {
  competitionId: string;
  status: "live" | "final";
  calculatedAt: Date;
  priceCheckpointAt: Date | null;
  released: { performance: number; participation: number; creator: number };
  allocated: { performance: number; participation: number; creator: number };
  policyVersion: string;
  canonicalHash: string;
  canonical: Record<string, unknown>;
  users: ReturnType<typeof calculateXp>["users"];
};

function coversAssets(prices: Map<string, bigint> | undefined, assetIds: string[]) {
  return Boolean(prices && assetIds.every((assetId) => prices.has(assetId)));
}

export async function calculateXpSnapshot(options: { final?: boolean; now?: Date } = {}): Promise<CalculatedXpSnapshot | null> {
  if (!sqlClient) return null;
  const now = options.now ?? new Date();
  const [competition] = await sqlClient<{ id: string; startsAt: string; endsAt: string }[]>`
    select id::text, starts_at as "startsAt", ends_at as "endsAt" from competitions limit 1`;
  if (!competition) throw new Error("COMPETITION_NOT_FOUND");

  const [proposals, tranches, runs, snapshots] = await Promise.all([
    sqlClient<ProposalRow[]>`
      select p.id::text, p.creator_user_id as "creatorUserId", p.accepted_at as "acceptedAt",
        coalesce(json_agg(json_build_object('assetId', pa.asset_id::text, 'weightBps', pa.weight_bps) order by pa.position), '[]') as allocations
      from proposals p join proposal_assets pa on pa.proposal_id = p.id
      where p.competition_id = ${competition.id}::uuid and p.status = 'accepted'
      group by p.id`,
    sqlClient<TrancheRow[]>`
      select vt.id::text, vt.voter_user_id as "voterUserId", vt.proposal_id::text as "proposalId",
        p.creator_user_id as "proposalCreatorUserId", vt.quantity, vt.accepted_at as "acceptedAt",
        vt.effective_entry_at as "effectiveEntryAt"
      from vote_tranches vt
      join ballots b on b.id = vt.ballot_id and b.status = 'valid'
      join tweet_evidence te on te.id = vt.evidence_id and te.status = 'valid'
      join proposals p on p.id = vt.proposal_id and p.status = 'accepted'
      where vt.competition_id = ${competition.id}::uuid
      order by vt.accepted_at, vt.id`,
    sqlClient<CaptureRun[]>`
      select id::text, sampled_at as "sampledAt"
      from price_capture_runs where status = 'complete' and sampled_at <= ${now.toISOString()}::timestamptz
      order by sampled_at, id`,
    sqlClient<{ runId: string; assetId: string; bidUsd: string }[]>`
      select capture_run_id::text as "runId", asset_id::text as "assetId", bid_usd::text as "bidUsd"
      from asset_price_snapshots where capture_run_id is not null`,
  ]);

  const pricesByRun = new Map<string, Map<string, bigint>>();
  for (const snapshot of snapshots) {
    const prices = pricesByRun.get(snapshot.runId) ?? new Map<string, bigint>();
    prices.set(snapshot.assetId, parseFixedPrice(snapshot.bidUsd));
    pricesByRun.set(snapshot.runId, prices);
  }
  const requiredAssetIds = [...new Set(proposals.flatMap((proposal) => proposal.allocations.map((allocation) => allocation.assetId)))].sort();
  const deadline = new Date(competition.endsAt);
  const eligibleEvaluationRuns = runs.filter((run) => coversAssets(pricesByRun.get(run.id), requiredAssetIds));
  const evaluationRun = options.final
    ? eligibleEvaluationRuns.find((run) => new Date(run.sampledAt) >= deadline)
    : eligibleEvaluationRuns.at(-1);
  if (options.final && requiredAssetIds.length > 0 && !evaluationRun) {
    throw new PublicApiError("FINAL_PRICE_CHECKPOINT_UNAVAILABLE", { deadline: deadline.toISOString() });
  }

  const proposalById = new Map(proposals.map((proposal) => [proposal.id, proposal]));
  const evaluationAt = evaluationRun ? new Date(evaluationRun.sampledAt) : null;
  const evaluationPrices = evaluationRun ? pricesByRun.get(evaluationRun.id) : undefined;
  const effectiveEntries = new Map<string, Date>();
  const scoredTranches: XpTrancheScoreInput[] = tranches.map((tranche) => {
    const acceptedAt = new Date(tranche.acceptedAt);
    const selectedProposal = proposalById.get(tranche.proposalId)!;
    const eligibleIds = new Set(eligibleProposalIdsAt(proposals, acceptedAt));
    const eligibleProposals = proposals.filter((proposal) => eligibleIds.has(proposal.id));
    const returns: { proposalId: string; returnValue: bigint }[] = [];
    let selectedEntryAt: Date | undefined;
    for (const proposal of eligibleProposals) {
      const assetIds = proposal.allocations.map((allocation) => allocation.assetId);
      const entryRun = firstCompleteCheckpointAtOrAfter(runs, acceptedAt, (run) => coversAssets(pricesByRun.get(run.id), assetIds), evaluationAt ?? undefined);
      if (!entryRun || !evaluationPrices || !coversAssets(evaluationPrices, assetIds)) continue;
      if (proposal.id === selectedProposal.id) selectedEntryAt = new Date(entryRun.sampledAt);
      returns.push({
        proposalId: proposal.id,
        returnValue: syntheticPortfolioReturn(proposal.allocations, pricesByRun.get(entryRun.id)!, evaluationPrices),
      });
    }
    if (selectedEntryAt) effectiveEntries.set(tranche.id, selectedEntryAt);
    const comparisonComplete = returns.length === eligibleProposals.length && returns.some((result) => result.proposalId === tranche.proposalId);
    return {
      id: tranche.id,
      voterUserId: tranche.voterUserId,
      proposalId: tranche.proposalId,
      proposalCreatorUserId: tranche.proposalCreatorUserId,
      quantity: tranche.quantity,
      effectiveEntryAt: selectedEntryAt,
      selectedReturn: comparisonComplete ? returns.find((result) => result.proposalId === tranche.proposalId)!.returnValue : undefined,
      comparisonReturns: comparisonComplete ? returns : undefined,
    };
  });

  if (effectiveEntries.size) {
    const database = requireDb();
    await Promise.all([...effectiveEntries].map(([trancheId, effectiveEntryAt]) => database.update(voteTranches)
      .set({ effectiveEntryAt })
      .where(and(eq(voteTranches.id, trancheId), isNull(voteTranches.effectiveEntryAt)))));
  }

  const votingStartsAt = getVotingStartsAt(competition.startsAt);
  const result = calculateXp({
    votingStartsAt,
    votingEndsAt: deadline,
    calculatedAt: options.final && evaluationAt ? evaluationAt : now,
    final: options.final,
    tranches: scoredTranches,
    creators: proposals.map((proposal) => ({ proposalId: proposal.id, creatorUserId: proposal.creatorUserId, acceptedAt: new Date(proposal.acceptedAt) })),
  });
  if (options.final && Object.values(result.allocated).reduce((sum, value) => sum + value, 0) !== 10_000_000) {
    throw new Error("XP_FINAL_ALLOCATION_INCOMPLETE");
  }
  const status = options.final ? "final" as const : "live" as const;
  const canonical = {
    competitionId: competition.id,
    status,
    policyVersion: XP_POLICY_VERSION,
    calculatedAt: now.toISOString(),
    priceCheckpointAt: evaluationAt?.toISOString() ?? null,
    released: result.released,
    allocated: result.allocated,
    users: result.users,
  };
  return {
    competitionId: competition.id,
    status,
    calculatedAt: now,
    priceCheckpointAt: evaluationAt,
    released: result.released,
    allocated: result.allocated,
    policyVersion: XP_POLICY_VERSION,
    canonicalHash: stableCanonicalHash(canonical),
    canonical,
    users: result.users,
  };
}

export async function persistXpSnapshot(snapshot: CalculatedXpSnapshot) {
  const database = requireDb();
  return database.transaction(async (transaction) => {
    const [run] = await transaction.insert(xpCalculationRuns).values({
      competitionId: snapshot.competitionId,
      status: snapshot.status,
      calculatedAt: snapshot.calculatedAt,
      priceCheckpointAt: snapshot.priceCheckpointAt,
      performanceReleased: snapshot.released.performance,
      performanceAllocated: snapshot.allocated.performance,
      participationReleased: snapshot.released.participation,
      participationAllocated: snapshot.allocated.participation,
      creatorReleased: snapshot.released.creator,
      creatorAllocated: snapshot.allocated.creator,
      policyVersion: snapshot.policyVersion,
      canonicalHash: snapshot.canonicalHash,
      canonicalJson: snapshot.canonical,
    }).returning({ id: xpCalculationRuns.id });
    if (snapshot.users.length) await transaction.insert(xpSnapshotRows).values(snapshot.users.map((user) => ({ runId: run.id, ...user })));
    return { runId: run.id, canonicalHash: snapshot.canonicalHash };
  });
}

export async function recomputeLiveXp() {
  const database = requireDb();
  const [final] = await database.select({ id: xpCalculationRuns.id }).from(xpCalculationRuns)
    .where(eq(xpCalculationRuns.status, "final")).limit(1);
  if (final) return { skipped: "final" as const };
  const snapshot = await calculateXpSnapshot();
  if (!snapshot) return { skipped: "preview" as const };
  return persistXpSnapshot(snapshot);
}

export async function getXpLeaderboard(): Promise<XpLeaderboard> {
  if (!sqlClient) {
    const now = new Date();
    return {
      status: "live", calculatedAt: now.toISOString(), priceCheckpointAt: now.toISOString(), policyVersion: XP_POLICY_VERSION,
      released: { performance: 2_520_000, participation: 360_000, creator: 720_000, total: 3_600_000 },
      allocated: { performance: 2_520_000, participation: 360_000, creator: 720_000, total: 3_600_000 },
      rows: [
        { publicName: "Turbo Capybara 404", usesRealUsername: false, performanceXp: 884_321, participationXp: 126_486, creatorXp: 251_908, totalXp: 1_262_715, uniqueSupporterCount: 18, submissionBoost: true, pendingTrancheCount: 0 },
        { publicName: "Disco Pigeon 808", usesRealUsername: false, performanceXp: 701_204, participationXp: 103_514, creatorXp: 215_742, totalXp: 1_020_460, uniqueSupporterCount: 13, submissionBoost: true, pendingTrancheCount: 1 },
        { publicName: "Wobbly Lobster 247", usesRealUsername: false, performanceXp: 582_991, participationXp: 82_000, creatorXp: 162_350, totalXp: 827_341, uniqueSupporterCount: 8, submissionBoost: false, pendingTrancheCount: 0 },
        { publicName: "Sleepy Turnip 613", usesRealUsername: false, performanceXp: 351_484, participationXp: 48_000, creatorXp: 90_000, totalXp: 489_484, uniqueSupporterCount: 5, submissionBoost: false, pendingTrancheCount: 0 },
      ],
    };
  }
  const [run] = await sqlClient<{
    id: string; status: "live" | "final"; calculatedAt: string; priceCheckpointAt: string | null; policyVersion: string;
    performanceReleased: number; participationReleased: number; creatorReleased: number;
    performanceAllocated: number; participationAllocated: number; creatorAllocated: number;
  }[]>`
    select id::text, status, calculated_at as "calculatedAt", price_checkpoint_at as "priceCheckpointAt", policy_version as "policyVersion",
      performance_released as "performanceReleased", participation_released as "participationReleased", creator_released as "creatorReleased",
      performance_allocated as "performanceAllocated", participation_allocated as "participationAllocated", creator_allocated as "creatorAllocated"
    from xp_calculation_runs order by case when status = 'final' then 0 else 1 end, calculated_at desc limit 1`;
  if (!run) {
    return { status: "live", calculatedAt: new Date(0).toISOString(), priceCheckpointAt: null, policyVersion: XP_POLICY_VERSION, released: { performance: 0, participation: 0, creator: 0, total: 0 }, allocated: { performance: 0, participation: 0, creator: 0, total: 0 }, rows: [] };
  }
  const privateRows = await sqlClient<{
    userId: string; username: string; allowRealUsername: boolean;
    performanceXp: number; participationXp: number; creatorXp: number; totalXp: number;
    uniqueSupporterCount: number; submissionBoost: boolean; pendingTrancheCount: number;
  }[]>`
    select x.user_id as "userId", u.x_username as username, u.show_real_username_on_voter_leaderboard as "allowRealUsername",
      x.performance_xp as "performanceXp", x.participation_xp as "participationXp", x.creator_xp as "creatorXp", x.total_xp as "totalXp",
      x.unique_supporter_count as "uniqueSupporterCount", x.submission_boost as "submissionBoost", x.pending_tranche_count as "pendingTrancheCount"
    from xp_snapshot_rows x join users u on u.id = x.user_id where x.run_id = ${run.id}::uuid
    order by x.total_xp desc, x.user_id`;
  const rows: XpLeaderboard["rows"] = privateRows.map(({ userId, username, allowRealUsername, ...row }) => ({
    ...row,
    publicName: publicVoterName({ userId, username, allowRealUsername }),
    usesRealUsername: allowRealUsername,
  }));
  return {
    status: run.status, calculatedAt: run.calculatedAt, priceCheckpointAt: run.priceCheckpointAt, policyVersion: run.policyVersion,
    released: { performance: run.performanceReleased, participation: run.participationReleased, creator: run.creatorReleased, total: run.performanceReleased + run.participationReleased + run.creatorReleased },
    allocated: { performance: run.performanceAllocated, participation: run.participationAllocated, creator: run.creatorAllocated, total: run.performanceAllocated + run.participationAllocated + run.creatorAllocated },
    rows,
  };
}

export async function getUserXp(userId: string) {
  const leaderboard = await getXpLeaderboard();
  if (!sqlClient) return { ...leaderboard, rows: [] };
  const [row] = await sqlClient<{
    performanceXp: number; participationXp: number; creatorXp: number; totalXp: number;
    uniqueSupporterCount: number; submissionBoost: boolean; pendingTrancheCount: number;
  }[]>`
    select x.performance_xp as "performanceXp", x.participation_xp as "participationXp", x.creator_xp as "creatorXp", x.total_xp as "totalXp",
      x.unique_supporter_count as "uniqueSupporterCount", x.submission_boost as "submissionBoost", x.pending_tranche_count as "pendingTrancheCount"
    from xp_snapshot_rows x
    where x.user_id = ${userId}
      and x.run_id = (select id from xp_calculation_runs order by case when status = 'final' then 0 else 1 end, calculated_at desc limit 1)
    limit 1`;
  return { ...leaderboard, rows: row ? [{ ...row, userId, publicName: "You", usesRealUsername: false }] : [] };
}
