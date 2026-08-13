import { and, eq, inArray, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { earliestLaunchAt, rankEntries } from "@/lib/validation";
import { inspectDirectPool } from "./assets";
import { requireSession } from "./guards";
import { adminXIds } from "./env";
import { requireDb } from "./db";
import {
  activityEvents, adminActions, assetEligibilitySnapshots, assetPools, competitions, eligibleAssets, evidenceChecks,
  finalizationRuns, leaderboardRows, leaderboardSnapshots, launchQueue, proposalAssets, proposals,
  tweetEvidence, votes, xIdentitySnapshots
} from "./db/schema";
import { getXOEmbed, hashXPostText } from "./x";

export async function requireAdmin() {
  const session = await requireSession();
  if (!session.user.xUserId || !adminXIds.has(session.user.xUserId)) throw new Error("FORBIDDEN");
  return session;
}

export async function setAssetEnabled(assetId: string, enabled: boolean, reason: string) {
  const database = requireDb(); const session = await requireAdmin();
  if (reason.trim().length < 8) throw new Error("REASON_REQUIRED");
  const [before] = await database.select().from(eligibleAssets).where(eq(eligibleAssets.id, assetId)).limit(1);
  if (!before) throw new Error("ASSET_NOT_FOUND");
  const [after] = await database.update(eligibleAssets).set({ adminEnabled: enabled, updatedAt: new Date() }).where(eq(eligibleAssets.id, assetId)).returning();
  await database.update(assetPools).set({ enabled, updatedAt: new Date() }).where(eq(assetPools.assetId, assetId));
  await database.insert(adminActions).values({ adminUserId: session.user.id, action: enabled ? "asset.enable" : "asset.disable", targetType: "asset", targetId: assetId, reason, before, after });
  return after;
}

function addUtcMonths(date: Date, months: number) {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export async function createCompetition(input: { slug: string; name: string; startsAt?: string; endsAt?: string; minFollowers?: number; minAccountAgeDays?: number }) {
  const database = requireDb(); const session = await requireAdmin();
  const startsAt = input.startsAt ? new Date(input.startsAt) : new Date();
  const endsAt = input.endsAt ? new Date(input.endsAt) : addUtcMonths(startsAt, 2);
  if (!/^[a-z0-9-]{2,40}$/.test(input.slug) || input.name.trim().length < 3 || !Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) throw new Error("INVALID_COMPETITION");
  const [competition] = await database.insert(competitions).values({ slug: input.slug, name: input.name.trim(), startsAt, endsAt, minFollowers: input.minFollowers ?? 50, minAccountAgeDays: input.minAccountAgeDays ?? 30, phase: startsAt <= new Date() ? "open" : "scheduled", rulesFrozenAt: startsAt <= new Date() ? new Date() : undefined }).returning();
  await database.insert(adminActions).values({ adminUserId: session.user.id, action: "competition.create", targetType: "competition", targetId: competition.id, reason: "Create competition with frozen V1 defaults", after: competition });
  return competition;
}

export async function moderateProposal(proposalId: string, status: "hidden" | "disqualified", reason: string) {
  const database = requireDb(); const session = await requireAdmin();
  if (reason.trim().length < 8) throw new Error("REASON_REQUIRED");
  const [before] = await database.select().from(proposals).where(eq(proposals.id, proposalId)).limit(1);
  if (!before) throw new Error("PROPOSAL_NOT_FOUND");
  const [after] = await database.update(proposals).set({ status, moderatedReason: reason, updatedAt: new Date() }).where(eq(proposals.id, proposalId)).returning();
  await database.insert(adminActions).values({ adminUserId: session.user.id, action: `proposal.${status}`, targetType: "proposal", targetId: proposalId, reason, before, after });
  await database.insert(activityEvents).values({ competitionId: before.competitionId, actorUserId: before.creatorUserId, proposalId, eventType: `proposal.${status}`, occurredAt: new Date(), ruleVersion: "v1", metadata: { reason } });
  return after;
}

export async function recheckEvidence(competitionId: string, runId?: string) {
  const database = requireDb();
  const records = await database.select().from(tweetEvidence)
    .where(and(eq(tweetEvidence.competitionId, competitionId), eq(tweetEvidence.status, "valid")))
    .orderBy(tweetEvidence.id);
  for (const evidence of records) {
    try {
      const post = await getXOEmbed(evidence.postUrl);
      const [snapshot] = await database.select({ username: xIdentitySnapshots.username }).from(xIdentitySnapshots).where(eq(xIdentitySnapshots.id, evidence.identitySnapshotId)).limit(1);
      if (!snapshot || post.username.toLowerCase() !== snapshot.username.toLowerCase()) throw new Error("X_POST_CHANGED");
      if (hashXPostText(post.text) !== evidence.evidenceHash) throw new Error("X_POST_CHANGED");
      await database.insert(evidenceChecks).values({ evidenceId: evidence.id, status: "valid", reason: "evidence-recheck" });
      await database.update(tweetEvidence).set({ lastCheckedAt: new Date(), editHistoryIds: [post.id] }).where(eq(tweetEvidence.id, evidence.id));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "X_UNAVAILABLE";
      if (reason === "X_UNAVAILABLE") throw error;
      await database.transaction(async (transaction) => {
        await transaction.update(tweetEvidence).set({ status: "invalid", reason, lastCheckedAt: new Date() }).where(eq(tweetEvidence.id, evidence.id));
        await transaction.insert(evidenceChecks).values({ evidenceId: evidence.id, status: "invalid", reason });
        await transaction.update(votes).set({ status: "invalid", invalidatedAt: new Date(), updatedAt: new Date() }).where(eq(votes.evidenceId, evidence.id));
        if (evidence.action === "submission") await transaction.update(proposals).set({ status: "disqualified", moderatedReason: `X post invalid: ${reason}`, updatedAt: new Date() }).where(eq(proposals.id, evidence.proposalId));
      });
    }
    if (runId) await database.update(finalizationRuns).set({ cursor: evidence.id }).where(eq(finalizationRuns.id, runId));
  }
}

async function recheckAssetHealth(competitionId: string) {
  const database = requireDb();
  const selected = await database.selectDistinct({ asset: eligibleAssets }).from(proposalAssets)
    .innerJoin(proposals, and(eq(proposals.id, proposalAssets.proposalId), eq(proposals.competitionId, competitionId), eq(proposals.status, "accepted")))
    .innerJoin(eligibleAssets, eq(eligibleAssets.id, proposalAssets.assetId));
  for (const { asset } of selected) {
    const price = await (await import("./assets")).fetchRobinhoodPrice(asset.symbol);
    const result = await inspectDirectPool(asset.contractAddress as `0x${string}`, { bid: price.bid, ask: price.ask, multiplier: String(asset.multiplier) });
    await database.insert(assetEligibilitySnapshots).values({ assetId: asset.id, blockNumber: "blockNumber" in result ? result.blockNumber?.toString() : undefined, liquidity: "liquidity" in result ? result.liquidity?.toString() : undefined, buyQuoteOut: "buyQuoteOut" in result ? result.buyQuoteOut?.toString() : undefined, sellQuoteOut: "sellQuoteOut" in result ? result.sellQuoteOut?.toString() : undefined, buyPriceImpactBps: "buyImpactBps" in result ? result.buyImpactBps : undefined, sellPriceImpactBps: "sellImpactBps" in result ? result.sellImpactBps : undefined, eligible: result.eligible, reason: result.reason, rawEvidence: { finalization: true, referenceGeneratedAt: price.generatedAt } });
    if (!result.eligible) {
      const [competition] = await database.select().from(competitions).where(eq(competitions.id, competitionId)).limit(1);
      if (Date.now() < competition.endsAt.getTime() + 48 * 60 * 60_000) throw new Error("ASSET_GRACE_ACTIVE");
      const affected = await database.select({ id: proposals.id }).from(proposals).innerJoin(proposalAssets, eq(proposalAssets.proposalId, proposals.id)).where(and(eq(proposals.competitionId, competitionId), eq(proposalAssets.assetId, asset.id), eq(proposals.status, "accepted")));
      if (affected.length) await database.update(proposals).set({ status: "disqualified", moderatedReason: `Asset ${asset.symbol} remained unusable after grace period`, updatedAt: new Date() }).where(inArray(proposals.id, affected.map((item) => item.id)));
    }
  }
}

export async function finalizeCompetition(competitionId: string) {
  const database = requireDb(); await requireAdmin();
  const [competition] = await database.select().from(competitions).where(eq(competitions.id, competitionId)).limit(1);
  if (!competition || Date.now() < competition.endsAt.getTime()) throw new Error("COMPETITION_NOT_ENDED");
  if (competition.finalizedAt) throw new Error("ALREADY_FINALIZED");
  const [run] = await database.insert(finalizationRuns).values({ competitionId, status: "auditing" }).returning();
  await database.update(competitions).set({ phase: "auditing", updatedAt: new Date() }).where(eq(competitions.id, competitionId));
  try {
    await recheckEvidence(competitionId, run.id);
    await recheckAssetHealth(competitionId);
    const scored = await database.select({ id: proposals.id, acceptedAt: proposals.acceptedAt, votes: sql<number>`count(${votes.id}) filter (where ${votes.status} = 'valid')::int` })
      .from(proposals).leftJoin(votes, eq(votes.proposalId, proposals.id))
      .where(and(eq(proposals.competitionId, competitionId), eq(proposals.status, "accepted"))).groupBy(proposals.id);
    const ranked = rankEntries(scored.map((item) => ({ id: item.id, acceptedAt: item.acceptedAt!, votes: item.votes })));
    const canonical = { competitionId, ruleVersion: competition.ruleVersion, rankingPolicyVersion: competition.rankingPolicyVersion, rows: ranked.map(({ id, rank, votes }) => ({ rank, proposalId: id, validVotes: votes })) };
    const canonicalHash = createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
    const launchStartAt = competition.launchStartAt ?? new Date(Date.now() + 86_400_000);
    await database.transaction(async (transaction) => {
      const [snapshot] = await transaction.insert(leaderboardSnapshots).values({ competitionId, canonicalHash, canonicalJson: canonical }).returning();
      if (ranked.length) {
        await transaction.insert(leaderboardRows).values(ranked.map((row) => ({ snapshotId: snapshot.id, proposalId: row.id, rank: row.rank, validVotes: row.votes })));
        await transaction.insert(launchQueue).values(ranked.map((row) => ({ competitionId, proposalId: row.id, rank: row.rank, earliestLaunchAt: earliestLaunchAt(launchStartAt, row.rank, competition.launchIntervalDays) })));
      }
      await transaction.update(competitions).set({ phase: "final", launchStartAt, finalizedAt: new Date(), updatedAt: new Date() }).where(eq(competitions.id, competitionId));
      await transaction.update(finalizationRuns).set({ status: "complete", completedAt: new Date(), metadata: { canonicalHash, rows: ranked.length } }).where(eq(finalizationRuns.id, run.id));
    });
    return { runId: run.id, canonicalHash, rows: ranked.length };
  } catch (error) {
    await database.update(finalizationRuns).set({ status: "failed", error: error instanceof Error ? error.message : "UNKNOWN" }).where(eq(finalizationRuns.id, run.id));
    throw error;
  }
}

export async function exportLaunchOrder(competitionId: string) {
  const database = requireDb(); await requireAdmin();
  const [snapshot] = await database.select().from(leaderboardSnapshots).where(eq(leaderboardSnapshots.competitionId, competitionId)).limit(1);
  if (!snapshot) throw new Error("FINALIZATION_NOT_FOUND");
  const rows = await database.select({ rank: launchQueue.rank, proposalId: launchQueue.proposalId, earliestLaunchAt: launchQueue.earliestLaunchAt, status: launchQueue.status, name: proposals.name, ticker: proposals.ticker, slug: proposals.slug })
    .from(launchQueue).innerJoin(proposals, eq(proposals.id, launchQueue.proposalId)).where(eq(launchQueue.competitionId, competitionId)).orderBy(launchQueue.rank);
  return { competitionId, canonicalHash: snapshot.canonicalHash, rows };
}
