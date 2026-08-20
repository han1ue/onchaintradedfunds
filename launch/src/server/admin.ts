import { and, eq, inArray, sql } from "drizzle-orm";
import { requireSession } from "./guards";
import { adminXIds } from "./env";
import { requireDb } from "./db";
import { adminActions, ballots, competitions, evidenceChecks, proposals, tweetEvidence, voteTranches } from "./db/schema";
import { getXPostsByIds, hashXPostText } from "./x";

type EvidenceRecord = typeof tweetEvidence.$inferSelect;

async function invalidateEvidence(database: ReturnType<typeof requireDb>, evidence: EvidenceRecord, reason: string) {
  await database.transaction(async (transaction) => {
    await transaction.update(tweetEvidence).set({ status: "invalid", reason, lastCheckedAt: new Date() }).where(eq(tweetEvidence.id, evidence.id));
    await transaction.insert(evidenceChecks).values({ evidenceId: evidence.id, status: "invalid", reason });
    if (evidence.action === "vote") {
      const [tranche] = await transaction.select({ ballotId: voteTranches.ballotId }).from(voteTranches)
        .where(eq(voteTranches.evidenceId, evidence.id)).limit(1);
      if (tranche) await transaction.update(ballots).set({ status: "invalid", invalidatedAt: new Date(), updatedAt: new Date() }).where(eq(ballots.id, tranche.ballotId));
    }
    if (evidence.action === "submission" && evidence.proposalId) await transaction.update(proposals).set({ status: "deleted", moderatedReason: `X post invalid: ${reason}`, updatedAt: new Date() }).where(eq(proposals.id, evidence.proposalId));
  });
}

export async function recheckSubmissionEvidence(competitionId: string, proposalIds?: string[], maxAgeMs = 60_000) {
  const database = requireDb();
  const filters = [
    eq(tweetEvidence.competitionId, competitionId),
    eq(tweetEvidence.action, "submission"),
    eq(tweetEvidence.status, "valid"),
    ...(proposalIds?.length ? [inArray(tweetEvidence.proposalId, proposalIds)] : []),
  ];
  const candidates = await database.select().from(tweetEvidence).where(and(...filters)).orderBy(tweetEvidence.id);
  const cutoff = Date.now() - maxAgeMs;
  const records = candidates.filter((evidence) => !evidence.lastCheckedAt || evidence.lastCheckedAt.getTime() <= cutoff);
  if (records.length === 0) return 0;
  const livePosts = await getXPostsByIds(records.map((evidence) => evidence.xPostId));
  const liveById = new Map(livePosts.map((post) => [post.id, post]));
  let invalidated = 0;
  for (const evidence of records) {
    const post = liveById.get(evidence.xPostId);
    const reason = !post ? "X_POST_NOT_FOUND" : post.authorId && post.authorId !== evidence.xAuthorId ? "X_POST_CHANGED" : null;
    if (!reason) {
      await database.update(tweetEvidence).set({ lastCheckedAt: new Date() }).where(eq(tweetEvidence.id, evidence.id));
      continue;
    }
    await invalidateEvidence(database, evidence, reason);
    invalidated += 1;
  }
  return invalidated;
}

export async function requireAdmin() {
  const session = await requireSession();
  if (!session.user.xUserId || !adminXIds.has(session.user.xUserId)) throw new Error("FORBIDDEN");
  return session;
}

export async function moderateProposal(proposalId: string, status: "hidden" | "disqualified", reason: string) {
  const database = requireDb(); const session = await requireAdmin();
  if (reason.trim().length < 8) throw new Error("REASON_REQUIRED");
  return database.transaction(async (transaction) => {
    const [before] = await transaction.select({ proposal: proposals }).from(proposals)
      .innerJoin(competitions, eq(competitions.id, proposals.competitionId))
      .where(and(eq(proposals.id, proposalId), eq(competitions.phase, "open"), sql`${competitions.endsAt} > now()`))
      .limit(1)
      .for("update", { of: proposals });
    if (!before) throw new Error("COMPETITION_NOT_OPEN");
    const [after] = await transaction.update(proposals).set({ status: "deleted", moderatedReason: reason, updatedAt: new Date() }).where(eq(proposals.id, proposalId)).returning();
    await transaction.insert(adminActions).values({ adminUserId: session.user.id, action: `proposal.${status}`, targetType: "proposal", targetId: proposalId, reason, before: before.proposal, after });
    return after;
  });
}

export async function recheckEvidence(competitionId: string) {
  const database = requireDb();
  const rows = await database.select({ evidence: tweetEvidence }).from(tweetEvidence)
    .innerJoin(proposals, eq(tweetEvidence.proposalId, proposals.id))
    .where(and(
      eq(tweetEvidence.competitionId, competitionId),
      eq(tweetEvidence.action, "submission"),
      eq(tweetEvidence.status, "valid"),
      eq(proposals.status, "confirmed"),
    ))
    .orderBy(tweetEvidence.id);
  const records = rows.map(({ evidence }) => evidence);
  if (records.length === 0) return;
  const livePosts = await getXPostsByIds(records.map((evidence) => evidence.xPostId));
  const liveById = new Map(livePosts.map((post) => [post.id, post]));
  for (const evidence of records) {
    try {
      const livePost = liveById.get(evidence.xPostId);
      if (!livePost) throw new Error("X_POST_NOT_FOUND");
      if (livePost.authorId && livePost.authorId !== evidence.xAuthorId) throw new Error("X_POST_CHANGED");
      if (livePost.authorUsername && livePost.authorUsername.toLowerCase() !== evidence.xAuthorUsername.toLowerCase()) throw new Error("X_POST_CHANGED");
      if (hashXPostText(livePost.text) !== evidence.evidenceHash) throw new Error("X_POST_CHANGED");
      await database.insert(evidenceChecks).values({ evidenceId: evidence.id, status: "valid", reason: "evidence-recheck" });
      await database.update(tweetEvidence).set({ lastCheckedAt: new Date(), editHistoryIds: [livePost.id] }).where(eq(tweetEvidence.id, evidence.id));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "X_UNAVAILABLE";
      if (reason === "X_UNAVAILABLE") throw error;
      await invalidateEvidence(database, evidence, reason);
    }
  }
}
