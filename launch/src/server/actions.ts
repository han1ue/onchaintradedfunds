import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { proposalInputSchema, proofInputSchema } from "@/lib/validation";
import { createChallengeToken, xIntent } from "./challenge";
import { requireDb } from "./db";
import {
  activityEvents, assetEligibilitySnapshots, competitions, eligibleAssets, evidenceChecks, proposalAssets, proposals,
  tweetChallenges, tweetEvidence, votes
} from "./db/schema";
import { requireEligibleActor, requireSession } from "./guards";
import { getXPost, verifyXPost } from "./x";

function slugify(value: string) {
  return value.toLowerCase().replace(/\s+otf$/i, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-otf";
}

export async function saveProposalDraft(input: unknown) {
  const parsed = proposalInputSchema.parse(input);
  const database = requireDb();
  const { session, competition } = await requireEligibleActor();
  if (parsed.competitionId !== competition.id) throw new Error("COMPETITION_NOT_OPEN");

  const selectedAssets = await database.select().from(eligibleAssets).where(inArray(eligibleAssets.id, parsed.allocations.map((item) => item.assetId)));
  if (selectedAssets.length !== parsed.allocations.length || selectedAssets.some((asset) => !asset.adminEnabled || asset.status !== "active")) throw new Error("ASSET_INELIGIBLE");
  const snapshotMap = new Map<string, string>();
  for (const asset of selectedAssets) {
    const [snapshot] = await database.select().from(assetEligibilitySnapshots)
      .where(and(eq(assetEligibilitySnapshots.assetId, asset.id), eq(assetEligibilitySnapshots.eligible, true)))
      .orderBy(desc(assetEligibilitySnapshots.observedAt)).limit(1);
    if (!snapshot || Date.now() - snapshot.observedAt.getTime() > 15 * 60_000) throw new Error("ASSET_INELIGIBLE");
    snapshotMap.set(asset.id, snapshot.id);
  }

  return database.transaction(async (transaction) => {
    const [existing] = await transaction.select().from(proposals)
      .where(and(eq(proposals.competitionId, competition.id), eq(proposals.creatorUserId, session.user.id))).limit(1);
    if (existing && existing.status !== "draft") throw new Error("PROPOSAL_IMMUTABLE");
    const values = { competitionId: competition.id, creatorUserId: session.user.id, slug: slugify(parsed.name), name: parsed.name, ticker: parsed.ticker, thesis: parsed.thesis, updatedAt: new Date() };
    const [proposal] = existing
      ? await transaction.update(proposals).set(values).where(eq(proposals.id, existing.id)).returning()
      : await transaction.insert(proposals).values(values).returning();
    await transaction.delete(proposalAssets).where(eq(proposalAssets.proposalId, proposal.id));
    await transaction.insert(proposalAssets).values(parsed.allocations.map((allocation, position) => ({
      proposalId: proposal.id,
      assetId: allocation.assetId,
      eligibilitySnapshotId: snapshotMap.get(allocation.assetId)!,
      weightBps: allocation.weightBps,
      position
    })));
    return proposal;
  });
}

export async function issueSubmissionChallenge(proposalId: string) {
  const database = requireDb();
  const { session, competition } = await requireEligibleActor();
  const [proposal] = await database.select().from(proposals).where(and(eq(proposals.id, proposalId), eq(proposals.creatorUserId, session.user.id), eq(proposals.status, "draft"))).limit(1);
  if (!proposal) throw new Error("PROPOSAL_NOT_FOUND");
  const token = createChallengeToken();
  const expiresAt = new Date(Date.now() + competition.proofWindowMinutes * 60_000);
  const [challenge] = await database.transaction(async (transaction) => {
    await transaction.update(proposals).set({ status: "proof_pending", updatedAt: new Date() }).where(eq(proposals.id, proposal.id));
    return transaction.insert(tweetChallenges).values({
      action: "submission", competitionId: competition.id, userId: session.user.id, proposalId: proposal.id,
      nonceHash: token.nonceHash, proofUrl: token.proofUrl, expiresAt
    }).returning();
  });
  return { challengeId: challenge.id, proofUrl: token.proofUrl, expiresAt, intentUrl: xIntent(`I submitted ${proposal.name} ($${proposal.ticker}) to the OTF launch competition.`, token.proofUrl) };
}

export async function issueVoteChallenge(proposalId: string) {
  const database = requireDb();
  const { session, competition, snapshot } = await requireEligibleActor({ forVote: true });
  const [proposal] = await database.select().from(proposals).where(and(eq(proposals.id, proposalId), eq(proposals.status, "accepted"))).limit(1);
  if (!proposal) throw new Error("PROPOSAL_NOT_FOUND");
  if (proposal.creatorUserId === session.user.id) throw new Error("SELF_VOTE");
  const [existing] = await database.select().from(votes).where(and(eq(votes.proposalId, proposal.id), eq(votes.voterUserId, session.user.id))).limit(1);
  if (existing) throw new Error("DUPLICATE_VOTE");
  const token = createChallengeToken();
  const expiresAt = new Date(Date.now() + competition.proofWindowMinutes * 60_000);
  const result = await database.transaction(async (transaction) => {
    const [vote] = await transaction.insert(votes).values({
      competitionId: competition.id, proposalId: proposal.id, voterUserId: session.user.id,
      identitySnapshotId: snapshot.id, followerCount: snapshot.followersCount
    }).returning();
    const [challenge] = await transaction.insert(tweetChallenges).values({
      action: "vote", competitionId: competition.id, userId: session.user.id, proposalId: proposal.id,
      nonceHash: token.nonceHash, proofUrl: token.proofUrl, expiresAt
    }).returning();
    return { vote, challenge };
  });
  return { voteId: result.vote.id, challengeId: result.challenge.id, proofUrl: token.proofUrl, expiresAt, intentUrl: xIntent(`I voted for ${proposal.name} ($${proposal.ticker}) in the OTF launch competition.`, token.proofUrl) };
}

export async function verifyProof(input: unknown) {
  const parsed = proofInputSchema.parse(input);
  const database = requireDb();
  const session = await requireSession();
  const [challenge] = await database.select().from(tweetChallenges)
    .where(and(eq(tweetChallenges.id, parsed.challengeId), eq(tweetChallenges.userId, session.user.id))).limit(1);
  if (!challenge) throw new Error("PROOF_MISMATCH");
  if (challenge.usedAt) throw new Error("PROOF_REUSED");
  const post = await getXPost(parsed.postUrl);
  const verified = verifyXPost(post, {
    authorId: session.user.xUserId!, proofUrl: challenge.proofUrl,
    challengeCreatedAt: challenge.createdAt, expiresAt: challenge.expiresAt
  });
  try {
    return await database.transaction(async (transaction) => {
      const [openCompetition] = await transaction.select({ id: competitions.id }).from(competitions).where(and(eq(competitions.id, challenge.competitionId), eq(competitions.phase, "open"), sql`${competitions.endsAt} > now()`)).limit(1);
      if (!openCompetition) throw new Error("COMPETITION_NOT_OPEN");
      const consumed = await transaction.update(tweetChallenges).set({ usedAt: new Date() })
        .where(and(eq(tweetChallenges.id, challenge.id), isNull(tweetChallenges.usedAt))).returning({ id: tweetChallenges.id });
      if (!consumed.length) throw new Error("PROOF_REUSED");
      const [evidence] = await transaction.insert(tweetEvidence).values({
        challengeId: challenge.id, xPostId: verified.postId, xAuthorId: verified.authorId, postUrl: parsed.postUrl,
        postedAt: verified.postedAt, editHistoryIds: verified.editHistoryIds, evidenceHash: verified.evidenceHash,
        status: "valid", verifiedAt: new Date(), lastCheckedAt: new Date(), rawText: verified.rawText,
        rawTextExpiresAt: new Date(Date.now() + 30 * 86_400_000)
      }).returning();
      await transaction.insert(evidenceChecks).values({ evidenceId: evidence.id, status: "valid", reason: "initial-verification" });
      if (challenge.action === "submission") {
        const acceptedAt = new Date();
        const [proposal] = await transaction.update(proposals).set({ status: "accepted", acceptedAt, updatedAt: acceptedAt })
          .where(and(eq(proposals.id, challenge.proposalId!), eq(proposals.status, "proof_pending"))).returning();
        if (!proposal) throw new Error("PROPOSAL_NOT_FOUND");
        await transaction.insert(activityEvents).values({ competitionId: challenge.competitionId, actorUserId: session.user.id, proposalId: proposal.id, evidenceId: evidence.id, eventType: "proposal.accepted", occurredAt: acceptedAt, ruleVersion: "v1", metadata: { ticker: proposal.ticker } });
        return { action: "submission" as const, proposalId: proposal.id, slug: proposal.slug };
      }
      const acceptedAt = new Date();
      const [vote] = await transaction.update(votes).set({ status: "valid", evidenceId: evidence.id, acceptedAt, updatedAt: acceptedAt })
        .where(and(eq(votes.proposalId, challenge.proposalId!), eq(votes.voterUserId, session.user.id), eq(votes.status, "proof_pending"))).returning();
      if (!vote) throw new Error("VOTE_NOT_FOUND");
      await transaction.insert(activityEvents).values({ competitionId: challenge.competitionId, actorUserId: session.user.id, proposalId: challenge.proposalId, voteId: vote.id, evidenceId: evidence.id, eventType: "vote.accepted", occurredAt: acceptedAt, ruleVersion: "v1", metadata: { followers: vote.followerCount } });
      return { action: "vote" as const, proposalId: challenge.proposalId };
    });
  } catch (error) {
    if (error instanceof Error && /unique|duplicate/i.test(error.message)) throw new Error("PROOF_REUSED");
    throw error;
  }
}
