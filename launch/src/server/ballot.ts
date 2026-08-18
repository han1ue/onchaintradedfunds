import { randomBytes } from "node:crypto";
import { and, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import type { BallotSummary, VoteAllocation } from "@/lib/types";
import { getUnlockedVoteCount, getVotingStartsAt } from "@/lib/competition";
import { approximateXPostLength, buildVotePost, buildXIntentUrl } from "@/lib/x-post";
import { ballotActivationSchema, voteDistributionSchema, xPostProofSchema } from "@/lib/validation";
import { db, requireDb } from "./db";
import {
  activityEvents, ballotAllocations, ballots, competitions, eligibleAssets, evidenceChecks,
  proposalAssets, proposals, tweetEvidence, voteTranches, xActionChallenges
} from "./db/schema";
import { requireEligibleActor } from "./guards";
import { getXPost, hashXPostText } from "./x";
import { getNewestCompletePriceCheckpoint } from "./prices";

const challengeLifetimeMs = 15 * 60_000;

function newChallengeToken() {
  return `OTF-${randomBytes(8).toString("hex").toUpperCase()}`;
}

async function assertValidDistribution(
  database: ReturnType<typeof requireDb>,
  competitionId: string,
  allocations: VoteAllocation[]
) {
  const proposalIds = allocations.map((allocation) => allocation.proposalId);
  const selected = await database.select({ id: proposals.id, ticker: proposals.ticker })
    .from(proposals).where(and(
      eq(proposals.competitionId, competitionId),
      eq(proposals.status, "confirmed"),
      inArray(proposals.id, proposalIds)
  ));
  if (selected.length !== proposalIds.length) throw new Error("PROPOSAL_NOT_FOUND");
  return selected;
}

function totalVotes(allocations: VoteAllocation[]) {
  return allocations.reduce((sum, allocation) => sum + allocation.votes, 0);
}

function assertVotesUnlocked(startsAt: Date | string, allocations: VoteAllocation[], now: Date = new Date()) {
  if (totalVotes(allocations) > getUnlockedVoteCount(startsAt, now)) throw new Error("VOTES_NOT_UNLOCKED");
}

function assertOnlyAddsVotes(previous: VoteAllocation[], next: VoteAllocation[]) {
  const nextVotes = new Map(next.map((allocation) => [allocation.proposalId, allocation.votes]));
  for (const allocation of previous) {
    if ((nextVotes.get(allocation.proposalId) ?? 0) < allocation.votes) throw new Error("VOTES_ARE_FINAL");
  }
  if (totalVotes(next) <= totalVotes(previous)) throw new Error("NO_NEW_VOTES");
}

function addedVotes(previous: VoteAllocation[], next: VoteAllocation[]) {
  const previousVotes = new Map(previous.map((allocation) => [allocation.proposalId, allocation.votes]));
  return next.map((allocation) => ({
    proposalId: allocation.proposalId,
    votes: allocation.votes - (previousVotes.get(allocation.proposalId) ?? 0),
  })).filter((allocation) => allocation.votes > 0);
}

export async function getBallotSummary(competitionId: string, voterUserId: string): Promise<BallotSummary | null> {
  if (!db) return null;
  const [ballot] = await db.select({
    id: ballots.id,
    status: ballots.status,
    activatedAt: ballots.activatedAt,
    updatedAt: ballots.updatedAt,
    proofUrl: tweetEvidence.postUrl,
  }).from(ballots).leftJoin(tweetEvidence, eq(ballots.evidenceId, tweetEvidence.id)).where(and(
    eq(ballots.competitionId, competitionId),
    eq(ballots.voterUserId, voterUserId)
  )).limit(1);
  if (!ballot) return null;
  const allocations = await db.select({ proposalId: ballotAllocations.proposalId, votes: ballotAllocations.votes })
    .from(ballotAllocations).where(eq(ballotAllocations.ballotId, ballot.id));
  return {
    id: ballot.id,
    status: ballot.status,
    activatedAt: ballot.activatedAt?.toISOString() ?? null,
    updatedAt: ballot.updatedAt.toISOString(),
    proofUrl: ballot.proofUrl,
    allocations,
  };
}

export async function prepareBallotProof(input: unknown, siteOrigin: string) {
  const parsed = ballotActivationSchema.parse(input);
  const database = requireDb();
  const { session, competition } = await requireEligibleActor({ votingRequired: true });
  const selectedProposals = await assertValidDistribution(database, competition.id, parsed.allocations);
  assertVotesUnlocked(competition.startsAt, parsed.allocations);
  const [existing] = await database.select({ id: ballots.id, status: ballots.status }).from(ballots).where(and(
    eq(ballots.competitionId, competition.id), eq(ballots.voterUserId, session.user.id)
  )).limit(1);
  const previousAllocations = existing?.status === "valid"
    ? await database.select({ proposalId: ballotAllocations.proposalId, votes: ballotAllocations.votes })
      .from(ballotAllocations).where(eq(ballotAllocations.ballotId, existing.id))
    : [];
  if (existing?.status === "valid") assertOnlyAddsVotes(previousAllocations, parsed.allocations);
  const additions = addedVotes(previousAllocations, parsed.allocations);

  const token = newChallengeToken();
  const tickers = new Map(selectedProposals.map((proposal) => [proposal.id, proposal.ticker]));
  const disclosedChoices = parsed.revealVotes
    ? additions.map((allocation) => ({ ticker: tickers.get(allocation.proposalId) ?? "OTF", votes: allocation.votes }))
    : [];
  const postText = buildVotePost(parsed.reason, siteOrigin, token, disclosedChoices);
  if (approximateXPostLength(postText) > 280) throw new Error("POST_TOO_LONG");
  const [challenge] = await database.insert(xActionChallenges).values({
    action: "vote",
    competitionId: competition.id,
    userId: session.user.id,
    proposalId: null,
    token,
    reason: parsed.reason,
    postText,
    payload: { allocations: parsed.allocations, revealVotes: parsed.revealVotes },
    expiresAt: new Date(Date.now() + challengeLifetimeMs),
  }).returning({ id: xActionChallenges.id, expiresAt: xActionChallenges.expiresAt });
  return { challengeId: challenge.id, expiresAt: challenge.expiresAt.toISOString(), postText, intentUrl: buildXIntentUrl(postText) };
}

export async function verifyBallotProof(input: unknown) {
  const proof = xPostProofSchema.safeParse(input);
  if (!proof.success) throw new Error("PROOF_MISMATCH");
  const parsed = proof.data;
  const database = requireDb();
  const { session, user, competition } = await requireEligibleActor({ votingRequired: true });
  const [challenge] = await database.select().from(xActionChallenges).where(and(
    eq(xActionChallenges.id, parsed.challengeId),
    eq(xActionChallenges.action, "vote"),
    eq(xActionChallenges.userId, session.user.id),
    isNull(xActionChallenges.proposalId),
    isNull(xActionChallenges.consumedAt),
    gt(xActionChallenges.expiresAt, new Date())
  )).limit(1);
  if (!challenge) throw new Error("CHALLENGE_EXPIRED");
  const allocations = voteDistributionSchema.parse(challenge.payload.allocations);
  await assertValidDistribution(database, competition.id, allocations);
  const post = await getXPost(parsed.postUrl);
  if (post.username.toLowerCase() !== user.xUsername.toLowerCase()) throw new Error("PROOF_AUTHOR_MISMATCH");
  if (!post.text.includes(challenge.token)) throw new Error("PROOF_CODE_MISSING");

  const activatedAt = new Date();
  const entryAssets = await database.selectDistinct({ id: eligibleAssets.id, symbol: eligibleAssets.symbol })
    .from(proposalAssets)
    .innerJoin(proposals, eq(proposals.id, proposalAssets.proposalId))
    .innerJoin(eligibleAssets, eq(eligibleAssets.id, proposalAssets.assetId))
    .where(and(
      eq(proposals.competitionId, competition.id),
      eq(proposals.status, "confirmed"),
      lte(proposals.acceptedAt, activatedAt),
    ));
  const entryCapture = await getNewestCompletePriceCheckpoint(entryAssets.map((asset) => asset.id), activatedAt);
  const result = await database.transaction(async (transaction) => {
    const [consumed] = await transaction.update(xActionChallenges).set({ consumedAt: activatedAt }).where(and(
      eq(xActionChallenges.id, challenge.id), isNull(xActionChallenges.consumedAt), gt(xActionChallenges.expiresAt, activatedAt)
    )).returning({ id: xActionChallenges.id });
    if (!consumed) throw new Error("CHALLENGE_EXPIRED");
    const [openCompetition] = await transaction.select({ id: competitions.id, startsAt: competitions.startsAt }).from(competitions).where(and(
      eq(competitions.id, competition.id), eq(competitions.phase, "open"), sql`${competitions.endsAt} > now()`
    )).limit(1);
    if (!openCompetition) throw new Error("COMPETITION_NOT_OPEN");
    if (activatedAt < getVotingStartsAt(openCompetition.startsAt)) throw new Error("VOTING_NOT_OPEN");
    assertVotesUnlocked(openCompetition.startsAt, allocations, activatedAt);

    await transaction.execute(sql`select id from ballots where competition_id = ${competition.id} and voter_user_id = ${session.user.id} for update`);
    const [existing] = await transaction.select({ id: ballots.id, status: ballots.status, activatedAt: ballots.activatedAt }).from(ballots).where(and(
      eq(ballots.competitionId, competition.id), eq(ballots.voterUserId, session.user.id)
    )).limit(1);
    const previousAllocations = existing?.status === "valid"
      ? await transaction.select({ proposalId: ballotAllocations.proposalId, votes: ballotAllocations.votes })
        .from(ballotAllocations).where(eq(ballotAllocations.ballotId, existing.id))
      : [];
    if (existing?.status === "valid") assertOnlyAddsVotes(previousAllocations, allocations);
    const votesAdded = totalVotes(allocations) - totalVotes(previousAllocations);
    const [evidence] = await transaction.insert(tweetEvidence).values({
      action: "vote",
      competitionId: competition.id,
      userId: session.user.id,
      proposalId: null,
      xPostId: post.id,
      xAuthorId: user.xUserId,
      xAuthorUsername: user.xUsername,
      postUrl: post.postUrl,
      postedAt: activatedAt,
      editHistoryIds: [post.id],
      evidenceHash: hashXPostText(post.text),
      status: "valid",
      verifiedAt: activatedAt,
      lastCheckedAt: activatedAt,
      rawText: post.text,
      rawTextExpiresAt: new Date(Date.now() + 30 * 86_400_000),
    }).returning();
    await transaction.insert(evidenceChecks).values({ evidenceId: evidence.id, status: "valid", reason: "oembed-single-use-challenge" });
    const isUpdate = existing?.status === "valid";
    const [ballot] = existing
      ? await transaction.update(ballots).set({
        ...(isUpdate ? {} : { evidenceId: evidence.id, activatedAt }),
        followerCount: user.followersCount,
        status: "valid",
        invalidatedAt: null,
        updatedAt: activatedAt,
      }).where(eq(ballots.id, existing.id)).returning()
      : await transaction.insert(ballots).values({ competitionId: competition.id, voterUserId: session.user.id, evidenceId: evidence.id, followerCount: user.followersCount, status: "valid", activatedAt }).returning();
    await transaction.delete(ballotAllocations).where(eq(ballotAllocations.ballotId, ballot.id));
    await transaction.insert(ballotAllocations).values(allocations.map((allocation) => ({ ballotId: ballot.id, ...allocation, updatedAt: activatedAt })));
    const tranches = addedVotes(previousAllocations, allocations);
    if (tranches.length) await transaction.insert(voteTranches).values(tranches.map((tranche) => ({
      competitionId: competition.id,
      ballotId: ballot.id,
      voterUserId: session.user.id,
      proposalId: tranche.proposalId,
      evidenceId: evidence.id,
      quantity: tranche.votes,
      acceptedAt: activatedAt,
      entryPriceCaptureRunId: entryCapture.runId,
    })));
    await transaction.insert(activityEvents).values({
      competitionId: competition.id,
      actorUserId: session.user.id,
      ballotId: ballot.id,
      evidenceId: evidence.id,
      eventType: isUpdate ? "ballot.updated" : "ballot.activated",
      occurredAt: activatedAt,
      ruleVersion: competition.ruleVersion,
      metadata: { votesAdded, votes: totalVotes(allocations), proposals: allocations.length, xPostId: post.id, verifiedBy: "oembed-challenge" },
    });
    return {
      action: "ballot" as const,
      ballotId: ballot.id,
      postUrl: evidence.postUrl,
      embedHtml: post.embedHtml,
      allocations,
      updatedAt: activatedAt.toISOString(),
    };
  });
  return result;
}
