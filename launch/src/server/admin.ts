import { and, eq } from "drizzle-orm";
import { COMPETITION_RULES } from "@/lib/competition";
import { requireSession } from "./guards";
import { adminXIds } from "./env";
import { requireDb } from "./db";
import {
  activityEvents, adminActions, ballots, evidenceChecks, proposals, tweetEvidence
} from "./db/schema";
import { getXPost, hashXPostText } from "./x";

export async function requireAdmin() {
  const session = await requireSession();
  if (!session.user.xUserId || !adminXIds.has(session.user.xUserId)) throw new Error("FORBIDDEN");
  return session;
}

export async function moderateProposal(proposalId: string, status: "hidden" | "disqualified", reason: string) {
  const database = requireDb(); const session = await requireAdmin();
  if (reason.trim().length < 8) throw new Error("REASON_REQUIRED");
  const [before] = await database.select().from(proposals).where(eq(proposals.id, proposalId)).limit(1);
  if (!before) throw new Error("PROPOSAL_NOT_FOUND");
  const [after] = await database.update(proposals).set({ status: "deleted", moderatedReason: reason, updatedAt: new Date() }).where(eq(proposals.id, proposalId)).returning();
  await database.insert(adminActions).values({ adminUserId: session.user.id, action: `proposal.${status}`, targetType: "proposal", targetId: proposalId, reason, before, after });
  await database.insert(activityEvents).values({ competitionId: before.competitionId, actorUserId: before.creatorUserId, proposalId, eventType: `proposal.${status}`, occurredAt: new Date(), ruleVersion: COMPETITION_RULES.ruleVersion, metadata: { reason } });
  return after;
}

export async function recheckEvidence(competitionId: string) {
  const database = requireDb();
  const records = await database.select().from(tweetEvidence)
    .where(and(eq(tweetEvidence.competitionId, competitionId), eq(tweetEvidence.status, "valid")))
    .orderBy(tweetEvidence.id);
  for (const evidence of records) {
    try {
      const post = await getXPost(evidence.postUrl);
      if (post.username.toLowerCase() !== evidence.xAuthorUsername.toLowerCase()) throw new Error("X_POST_CHANGED");
      if (hashXPostText(post.text) !== evidence.evidenceHash) throw new Error("X_POST_CHANGED");
      await database.insert(evidenceChecks).values({ evidenceId: evidence.id, status: "valid", reason: "evidence-recheck" });
      await database.update(tweetEvidence).set({ lastCheckedAt: new Date(), editHistoryIds: [post.id] }).where(eq(tweetEvidence.id, evidence.id));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "X_UNAVAILABLE";
      if (reason === "X_UNAVAILABLE") throw error;
      await database.transaction(async (transaction) => {
        await transaction.update(tweetEvidence).set({ status: "invalid", reason, lastCheckedAt: new Date() }).where(eq(tweetEvidence.id, evidence.id));
        await transaction.insert(evidenceChecks).values({ evidenceId: evidence.id, status: "invalid", reason });
        if (evidence.action === "vote") {
          const [voteActivity] = await transaction.select({ ballotId: activityEvents.ballotId }).from(activityEvents)
            .where(eq(activityEvents.evidenceId, evidence.id)).limit(1);
          if (voteActivity?.ballotId) await transaction.update(ballots).set({ status: "invalid", invalidatedAt: new Date(), updatedAt: new Date() }).where(eq(ballots.id, voteActivity.ballotId));
        }
        if (evidence.action === "submission" && evidence.proposalId) await transaction.update(proposals).set({ status: "deleted", moderatedReason: `X post invalid: ${reason}`, updatedAt: new Date() }).where(eq(proposals.id, evidence.proposalId));
      });
    }
  }
}
