import { randomBytes } from "node:crypto";
import { and, asc, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import { buildBallotVotePosts } from "@/lib/ballot-history";
import type { BallotSummary, VoteAllocation } from "@/lib/types";
import { getUnlockedVoteCount, getVotingStartsAt } from "@/lib/competition";
import { getProposalVotingStartsAt, isProposalVotingOpen } from "@/lib/proposal-voting";
import { PublicApiError } from "@/lib/errors";
import { approximateXPostLength, buildVotePost, buildXIntentUrl } from "@/lib/x-post";
import { ballotActivationSchema, voteAdditionsSchema, xPostProofSchema } from "@/lib/validation";
import { db, requireDb } from "./db";
import {
  activityEvents, ballotAllocations, ballots, competitions, eligibleAssets, evidenceChecks,
  proposalAssets, proposals, tweetEvidence, voteTranches, xActionChallenges
} from "./db/schema";
import { requireEligibleActor } from "./guards";
import { getXPost, hashXPostText } from "./x";
import { getNewestCompletePriceCheckpoint } from "./prices";
import { recheckSubmissionEvidence } from "./admin";

const challengeLifetimeMs = 15 * 60_000;
type LaunchDatabase = ReturnType<typeof requireDb>;
type LaunchTransaction = Parameters<Parameters<LaunchDatabase["transaction"]>[0]>[0];

function newChallengeToken() {
  return `OTF-${randomBytes(8).toString("hex").toUpperCase()}`;
}

async function assertValidDistribution(
  database: LaunchDatabase | LaunchTransaction,
  competitionId: string,
  allocations: VoteAllocation[],
) {
  const proposalIds = allocations.map((allocation) => allocation.proposalId);
  const selected = await database.select({ id: proposals.id, ticker: proposals.ticker, acceptedAt: proposals.acceptedAt })
    .from(proposals).where(and(
      eq(proposals.competitionId, competitionId),
      eq(proposals.status, "confirmed"),
      inArray(proposals.id, proposalIds)
  ));
  if (selected.length !== proposalIds.length) throw new Error("PROPOSAL_NOT_FOUND");
  const lockedProposal = selected.find((proposal) => !proposal.acceptedAt || !isProposalVotingOpen(proposal.acceptedAt));
  if (lockedProposal?.acceptedAt) {
    throw new PublicApiError("PROPOSAL_VOTING_LOCKED", {
      proposalId: lockedProposal.id,
      votingStartsAt: getProposalVotingStartsAt(lockedProposal.acceptedAt).toISOString(),
    });
  }
  if (lockedProposal) throw new Error("PROPOSAL_NOT_FOUND");
  return selected;
}

function totalVotes(allocations: VoteAllocation[]) {
  return allocations.reduce((sum, allocation) => sum + allocation.votes, 0);
}

function assertVotesUnlocked(startsAt: Date | string, existingVotes: number, additions: VoteAllocation[], now: Date = new Date()) {
  if (existingVotes + totalVotes(additions) > getUnlockedVoteCount(startsAt, now)) throw new Error("VOTES_NOT_UNLOCKED");
}

async function assertBallotCanAccept(
  database: ReturnType<typeof requireDb>,
  competitionId: string,
  voterUserId: string,
  additions: VoteAllocation[],
  now: Date,
) {
  const [openCompetition] = await database.select({ startsAt: competitions.startsAt }).from(competitions).where(and(
    eq(competitions.id, competitionId),
    eq(competitions.phase, "open"),
    sql`${competitions.endsAt} > ${now}`,
  )).limit(1);
  if (!openCompetition) throw new Error("COMPETITION_NOT_OPEN");
  if (now < getVotingStartsAt(openCompetition.startsAt)) throw new Error("VOTING_NOT_OPEN");
  const [existing] = await database.select({ id: ballots.id, status: ballots.status }).from(ballots).where(and(
    eq(ballots.competitionId, competitionId),
    eq(ballots.voterUserId, voterUserId),
  )).limit(1);
  const previousAllocations = existing?.status === "valid"
    ? await database.select({ proposalId: ballotAllocations.proposalId, votes: ballotAllocations.votes })
      .from(ballotAllocations).where(eq(ballotAllocations.ballotId, existing.id))
    : [];
  assertVotesUnlocked(openCompetition.startsAt, totalVotes(previousAllocations), additions, now);
}

export async function getBallotSummary(competitionId: string, voterUserId: string): Promise<BallotSummary | null> {
  if (!db) return null;
  const [ballot] = await db.select({
    id: ballots.id,
    status: ballots.status,
    activatedAt: ballots.activatedAt,
    updatedAt: ballots.updatedAt,
  }).from(ballots).where(and(
    eq(ballots.competitionId, competitionId),
    eq(ballots.voterUserId, voterUserId)
  )).limit(1);
  if (!ballot) return null;
  const [allocations, trancheRows] = await Promise.all([
    db.select({ proposalId: ballotAllocations.proposalId, votes: ballotAllocations.votes })
      .from(ballotAllocations).where(eq(ballotAllocations.ballotId, ballot.id)),
    db.select({
      trancheId: voteTranches.id,
      evidenceId: voteTranches.evidenceId,
      postUrl: tweetEvidence.postUrl,
      evidenceStatus: tweetEvidence.status,
      acceptedAt: voteTranches.acceptedAt,
      createdAt: voteTranches.createdAt,
      proposalId: proposals.id,
      proposalName: proposals.name,
      proposalSlug: proposals.slug,
      proposalTicker: proposals.ticker,
      proposalStatus: proposals.status,
      votes: voteTranches.quantity,
    }).from(voteTranches)
      .innerJoin(tweetEvidence, eq(tweetEvidence.id, voteTranches.evidenceId))
      .innerJoin(proposals, eq(proposals.id, voteTranches.proposalId))
      .where(and(
        eq(voteTranches.ballotId, ballot.id),
        eq(voteTranches.voterUserId, voterUserId),
        eq(voteTranches.competitionId, competitionId),
      ))
      .orderBy(asc(voteTranches.acceptedAt), asc(voteTranches.createdAt), asc(voteTranches.id)),
  ]);
  const votePosts = buildBallotVotePosts(trancheRows);
  return {
    id: ballot.id,
    status: ballot.status,
    activatedAt: ballot.activatedAt?.toISOString() ?? null,
    updatedAt: ballot.updatedAt.toISOString(),
    allocations,
    votePosts,
  };
}

export async function prepareBallotProof(input: unknown, siteOrigin: string) {
  const parsed = ballotActivationSchema.parse(input);
  const database = requireDb();
  const { session, competition } = await requireEligibleActor({ votingRequired: true });
  const [existing] = await database.select({ id: ballots.id, status: ballots.status }).from(ballots).where(and(
    eq(ballots.competitionId, competition.id), eq(ballots.voterUserId, session.user.id)
  )).limit(1);
  const previousAllocations = existing?.status === "valid"
    ? await database.select({ proposalId: ballotAllocations.proposalId, votes: ballotAllocations.votes })
      .from(ballotAllocations).where(eq(ballotAllocations.ballotId, existing.id))
    : [];
  const selectedProposals = await assertValidDistribution(database, competition.id, parsed.additions);
  assertVotesUnlocked(competition.startsAt, totalVotes(previousAllocations), parsed.additions);

  const token = newChallengeToken();
  const tickers = new Map(selectedProposals.map((proposal) => [proposal.id, proposal.ticker]));
  const disclosedChoices = parsed.revealVotes
    ? parsed.additions.map((addition) => ({ ticker: tickers.get(addition.proposalId) ?? "OTF", votes: addition.votes }))
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
    payload: { additions: parsed.additions, revealVotes: parsed.revealVotes },
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
  const additions = voteAdditionsSchema.parse(challenge.payload.additions);
  const activatedAt = new Date();
  await assertValidDistribution(database, competition.id, additions);
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
  await assertBallotCanAccept(database, competition.id, session.user.id, additions, activatedAt);
  const post = await getXPost(parsed.postUrl);
  if (post.username.toLowerCase() !== user.xUsername.toLowerCase()) throw new Error("PROOF_AUTHOR_MISMATCH");
  if (!post.text.includes(challenge.token)) throw new Error("PROOF_CODE_MISSING");

  // Repeat free checks immediately before reserving the ballot transaction.
  await assertValidDistribution(database, competition.id, additions);
  await assertBallotCanAccept(database, competition.id, session.user.id, additions, activatedAt);
  const [activeChallenge] = await database.select({ id: xActionChallenges.id }).from(xActionChallenges).where(and(
    eq(xActionChallenges.id, challenge.id),
    isNull(xActionChallenges.consumedAt),
    gt(xActionChallenges.expiresAt, new Date()),
  )).limit(1);
  if (!activeChallenge) throw new Error("CHALLENGE_EXPIRED");
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

    await transaction.execute(sql`select id from ballots where competition_id = ${competition.id} and voter_user_id = ${session.user.id} for update`);
    const [existing] = await transaction.select({ id: ballots.id, status: ballots.status, activatedAt: ballots.activatedAt }).from(ballots).where(and(
      eq(ballots.competitionId, competition.id), eq(ballots.voterUserId, session.user.id)
    )).limit(1);
    const previousAllocations = existing?.status === "valid"
      ? await transaction.select({ proposalId: ballotAllocations.proposalId, votes: ballotAllocations.votes })
        .from(ballotAllocations).where(eq(ballotAllocations.ballotId, existing.id))
      : [];
    const existingVotes = totalVotes(previousAllocations);
    const votesAdded = totalVotes(additions);
    assertVotesUnlocked(openCompetition.startsAt, existingVotes, additions, activatedAt);

    // TwitterAPI.io is deliberately last, after every domain check and ballot lock.
    await assertValidDistribution(transaction, competition.id, additions);
    const invalidated = await recheckSubmissionEvidence(competition.id, additions.map((addition) => addition.proposalId), 0);
    if (invalidated > 0) throw new Error("PROPOSAL_POST_NOT_FOUND");

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
        ...(isUpdate ? {} : { activatedAt }),
        followerCount: user.followersCount,
        status: "valid",
        invalidatedAt: null,
        updatedAt: activatedAt,
      }).where(eq(ballots.id, existing.id)).returning()
      : await transaction.insert(ballots).values({ competitionId: competition.id, voterUserId: session.user.id, followerCount: user.followersCount, status: "valid", activatedAt }).returning();
    if (existing && !isUpdate) await transaction.delete(ballotAllocations).where(eq(ballotAllocations.ballotId, ballot.id));
    await transaction.insert(ballotAllocations)
      .values(additions.map((addition) => ({ ballotId: ballot.id, ...addition, updatedAt: activatedAt })))
      .onConflictDoUpdate({
        target: [ballotAllocations.ballotId, ballotAllocations.proposalId],
        set: { votes: sql`${ballotAllocations.votes} + excluded.votes`, updatedAt: activatedAt },
      });
    await transaction.insert(voteTranches).values(additions.map((addition) => ({
      competitionId: competition.id,
      ballotId: ballot.id,
      voterUserId: session.user.id,
      proposalId: addition.proposalId,
      evidenceId: evidence.id,
      quantity: addition.votes,
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
      metadata: { votesAdded, votes: existingVotes + votesAdded, proposals: additions.length, xPostId: post.id, verifiedBy: "oembed-challenge" },
    });
    return {
      action: "ballot" as const,
      ballotId: ballot.id,
      postUrl: evidence.postUrl,
      embedHtml: post.embedHtml,
      additions,
      updatedAt: activatedAt.toISOString(),
    };
  });
  return result;
}
