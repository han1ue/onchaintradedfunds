import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { approximateXPostLength, buildSubmissionPost, buildVotePost, buildXIntentUrl, slugifyProposalName } from "@/lib/x-post";
import { proposalInputSchema, xPostActionSchema, xPostProofSchema } from "@/lib/validation";
import { requireDb } from "./db";
import {
  activityEvents, assetEligibilitySnapshots, competitions, eligibleAssets, evidenceChecks, proposalAssets, proposals,
  tweetEvidence, votes, xActionChallenges, xIdentitySnapshots
} from "./db/schema";
import { requireEligibleActor } from "./guards";
import { env } from "./env";
import { getXPost, hashXPostText } from "./x";

const challengeLifetimeMs = 15 * 60_000;

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
    const values = { competitionId: competition.id, creatorUserId: session.user.id, slug: slugifyProposalName(parsed.name), name: parsed.name, ticker: parsed.ticker, thesis: parsed.thesis, updatedAt: new Date() };
    const [proposal] = existing
      ? await transaction.update(proposals).set(values).where(eq(proposals.id, existing.id)).returning()
      : await transaction.insert(proposals).values(values).returning();
    await transaction.delete(proposalAssets).where(eq(proposalAssets.proposalId, proposal.id));
    await transaction.insert(proposalAssets).values(parsed.allocations.map((allocation, position) => ({
      proposalId: proposal.id, assetId: allocation.assetId, eligibilitySnapshotId: snapshotMap.get(allocation.assetId)!, weightBps: allocation.weightBps, position
    })));
    return proposal;
  });
}

function newChallengeToken() {
  return `OTF-${randomBytes(8).toString("hex").toUpperCase()}`;
}

async function prepareProof(action: "submission" | "vote", proposalIdOrSlug: string, input: unknown) {
  const { reason } = xPostActionSchema.parse(input);
  const database = requireDb();
  const { session, competition, snapshot } = await requireEligibleActor({ forVote: action === "vote" });
  const [proposal] = await database.select().from(proposals).where(and(
    or(eq(proposals.id, proposalIdOrSlug), eq(proposals.slug, proposalIdOrSlug)),
    eq(proposals.competitionId, competition.id),
    action === "submission" ? and(eq(proposals.creatorUserId, session.user.id), eq(proposals.status, "draft")) : eq(proposals.status, "accepted")
  )).limit(1);
  if (!proposal) throw new Error("PROPOSAL_NOT_FOUND");
  if (action === "vote") {
    if (proposal.creatorUserId === session.user.id) throw new Error("SELF_VOTE");
    const [existing] = await database.select({ id: votes.id }).from(votes).where(and(eq(votes.proposalId, proposal.id), eq(votes.voterUserId, session.user.id))).limit(1);
    if (existing) throw new Error("DUPLICATE_VOTE");
  }

  const token = newChallengeToken();
  const postText = action === "submission"
    ? buildSubmissionPost(reason, proposal, env.NEXT_PUBLIC_SITE_URL, token)
    : buildVotePost(reason, proposal, env.NEXT_PUBLIC_SITE_URL, token);
  if (approximateXPostLength(postText) > 280) throw new Error("POST_TOO_LONG");
  const [challenge] = await database.insert(xActionChallenges).values({
    action, competitionId: competition.id, userId: session.user.id, proposalId: proposal.id,
    identitySnapshotId: snapshot.id, token, reason, postText, expiresAt: new Date(Date.now() + challengeLifetimeMs)
  }).returning({ id: xActionChallenges.id, expiresAt: xActionChallenges.expiresAt });
  return { challengeId: challenge.id, expiresAt: challenge.expiresAt.toISOString(), postText, intentUrl: buildXIntentUrl(postText) };
}

async function loadVerifiedProof(action: "submission" | "vote", proposalIdOrSlug: string, input: unknown) {
  const parsed = xPostProofSchema.parse(input);
  const database = requireDb();
  const { session, competition } = await requireEligibleActor({ forVote: action === "vote" });
  const [proposal] = await database.select().from(proposals).where(and(
    or(eq(proposals.id, proposalIdOrSlug), eq(proposals.slug, proposalIdOrSlug)), eq(proposals.competitionId, competition.id)
  )).limit(1);
  if (!proposal) throw new Error("PROPOSAL_NOT_FOUND");
  const [challenge] = await database.select().from(xActionChallenges).where(and(
    eq(xActionChallenges.id, parsed.challengeId), eq(xActionChallenges.action, action), eq(xActionChallenges.userId, session.user.id),
    eq(xActionChallenges.proposalId, proposal.id), isNull(xActionChallenges.consumedAt), gt(xActionChallenges.expiresAt, new Date())
  )).limit(1);
  if (!challenge) throw new Error("CHALLENGE_EXPIRED");
  const [snapshot] = await database.select().from(xIdentitySnapshots).where(eq(xIdentitySnapshots.id, challenge.identitySnapshotId)).limit(1);
  if (!snapshot) throw new Error("X_RECONNECT_REQUIRED");
  const post = await getXPost(parsed.postUrl);
  if (post.authorId !== snapshot.xUserId || post.username.toLowerCase() !== snapshot.username.toLowerCase()) throw new Error("PROOF_AUTHOR_MISMATCH");
  if (!post.text.includes(challenge.token)) throw new Error("PROOF_CODE_MISSING");
  return { database, session, competition, proposal, challenge, snapshot, post };
}

export function prepareProposalProof(proposalId: string, input: unknown) {
  return prepareProof("submission", proposalId, input);
}

export function prepareVoteProof(proposalIdOrSlug: string, input: unknown) {
  return prepareProof("vote", proposalIdOrSlug, input);
}

export async function verifyProposalProof(proposalId: string, input: unknown) {
  const context = await loadVerifiedProof("submission", proposalId, input);
  const { database, session, competition, proposal, challenge, snapshot, post } = context;
  if (proposal.creatorUserId !== session.user.id || proposal.status !== "draft") throw new Error("PROPOSAL_NOT_FOUND");
  const acceptedAt = new Date();
  return database.transaction(async (transaction) => {
    const [consumed] = await transaction.update(xActionChallenges).set({ consumedAt: acceptedAt }).where(and(eq(xActionChallenges.id, challenge.id), isNull(xActionChallenges.consumedAt), gt(xActionChallenges.expiresAt, acceptedAt))).returning({ id: xActionChallenges.id });
    if (!consumed) throw new Error("CHALLENGE_EXPIRED");
    const [openCompetition] = await transaction.select({ id: competitions.id }).from(competitions).where(and(eq(competitions.id, competition.id), eq(competitions.phase, "open"), sql`${competitions.endsAt} > now()`)).limit(1);
    if (!openCompetition) throw new Error("COMPETITION_NOT_OPEN");
    const [evidence] = await transaction.insert(tweetEvidence).values({
      action: "submission", competitionId: competition.id, userId: session.user.id, proposalId: proposal.id, identitySnapshotId: snapshot.id,
      xPostId: post.id, xAuthorId: post.authorId, postUrl: post.postUrl, postedAt: acceptedAt, editHistoryIds: [post.id],
      evidenceHash: hashXPostText(post.text), status: "valid", verifiedAt: acceptedAt, lastCheckedAt: acceptedAt,
      rawText: post.text, rawTextExpiresAt: new Date(Date.now() + 30 * 86_400_000)
    }).returning();
    await transaction.insert(evidenceChecks).values({ evidenceId: evidence.id, status: "valid", reason: "twitterapi-single-use-challenge" });
    const [accepted] = await transaction.update(proposals).set({ status: "accepted", acceptedAt, updatedAt: acceptedAt }).where(and(eq(proposals.id, proposal.id), eq(proposals.status, "draft"))).returning();
    if (!accepted) throw new Error("PROPOSAL_NOT_FOUND");
    await transaction.insert(activityEvents).values({ competitionId: competition.id, actorUserId: session.user.id, proposalId: proposal.id, evidenceId: evidence.id, eventType: "proposal.accepted", occurredAt: acceptedAt, ruleVersion: competition.ruleVersion, metadata: { ticker: proposal.ticker, xPostId: post.id, verifiedBy: "twitterapi-challenge" } });
    return { action: "submission" as const, proposalId: proposal.id, slug: proposal.slug, postUrl: evidence.postUrl };
  });
}

export async function verifyVoteProof(proposalIdOrSlug: string, input: unknown) {
  const context = await loadVerifiedProof("vote", proposalIdOrSlug, input);
  const { database, session, competition, proposal, challenge, snapshot, post } = context;
  if (proposal.status !== "accepted") throw new Error("PROPOSAL_NOT_FOUND");
  if (proposal.creatorUserId === session.user.id) throw new Error("SELF_VOTE");
  const acceptedAt = new Date();
  try {
    return await database.transaction(async (transaction) => {
      const [consumed] = await transaction.update(xActionChallenges).set({ consumedAt: acceptedAt }).where(and(eq(xActionChallenges.id, challenge.id), isNull(xActionChallenges.consumedAt), gt(xActionChallenges.expiresAt, acceptedAt))).returning({ id: xActionChallenges.id });
      if (!consumed) throw new Error("CHALLENGE_EXPIRED");
      const [openCompetition] = await transaction.select({ id: competitions.id }).from(competitions).where(and(eq(competitions.id, competition.id), eq(competitions.phase, "open"), sql`${competitions.endsAt} > now()`)).limit(1);
      if (!openCompetition) throw new Error("COMPETITION_NOT_OPEN");
      const [evidence] = await transaction.insert(tweetEvidence).values({
        action: "vote", competitionId: competition.id, userId: session.user.id, proposalId: proposal.id, identitySnapshotId: snapshot.id,
        xPostId: post.id, xAuthorId: post.authorId, postUrl: post.postUrl, postedAt: acceptedAt, editHistoryIds: [post.id],
        evidenceHash: hashXPostText(post.text), status: "valid", verifiedAt: acceptedAt, lastCheckedAt: acceptedAt,
        rawText: post.text, rawTextExpiresAt: new Date(Date.now() + 30 * 86_400_000)
      }).returning();
      await transaction.insert(evidenceChecks).values({ evidenceId: evidence.id, status: "valid", reason: "twitterapi-single-use-challenge" });
      const [vote] = await transaction.insert(votes).values({
        competitionId: competition.id, proposalId: proposal.id, voterUserId: session.user.id, evidenceId: evidence.id,
        identitySnapshotId: snapshot.id, followerCount: snapshot.followersCount, status: "valid", acceptedAt
      }).returning();
      await transaction.insert(activityEvents).values({ competitionId: competition.id, actorUserId: session.user.id, proposalId: proposal.id, voteId: vote.id, evidenceId: evidence.id, eventType: "vote.accepted", occurredAt: acceptedAt, ruleVersion: competition.ruleVersion, metadata: { followers: vote.followerCount, xPostId: post.id, verifiedBy: "twitterapi-challenge" } });
      return { action: "vote" as const, proposalId: proposal.id, postUrl: evidence.postUrl };
    });
  } catch (error) {
    if (error instanceof Error && /unique|duplicate/i.test(error.message)) throw new Error("DUPLICATE_VOTE");
    throw error;
  }
}
