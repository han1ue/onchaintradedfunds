import { randomBytes } from "node:crypto";
import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { buildBallotVotePosts } from "@/lib/ballot-history";
import type { BallotSummary, VoteAllocation } from "@/lib/types";
import { getUnlockedVoteCount, getVotingStartsAt, type CompetitionRules } from "@/lib/competition";
import { approximateXPostLength, buildVotePost, buildXIntentUrl, normalizeXPostText } from "@/lib/x-post";
import { ballotActivationSchema, voteAdditionsSchema, xPostProofSchema } from "@/lib/validation";
import { db, requireDb } from "./db";
import {
  assetRegistry, ballotAllocations, ballots, competitions, evidenceChecks,
  proposalAssets, proposals, tweetEvidence, voteTranches, xActionChallenges
} from "./db/schema";
import { requireEligibleActor } from "./guards";
import { getXPost, hashXPostText } from "./x";
import { getNewestPriceCheckpointForAssets } from "./prices";
import { recheckSubmissionEvidence } from "./admin";
import { assertCompetitionRulesSnapshot } from "./competition-rules";

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
  options: { lock?: boolean } = {},
) {
  const proposalIds = allocations.map((allocation) => allocation.proposalId).sort();
  const query = database.select({ id: proposals.id, ticker: proposals.ticker, acceptedAt: proposals.acceptedAt })
    .from(proposals).where(and(
      eq(proposals.competitionId, competitionId),
      eq(proposals.status, "confirmed"),
      inArray(proposals.id, proposalIds)
    )).orderBy(asc(proposals.id));
  const selected = options.lock ? await query.for("update") : await query;
  if (selected.length !== proposalIds.length) throw new Error("PROPOSAL_NOT_FOUND");
  if (selected.some((proposal) => !proposal.acceptedAt)) throw new Error("PROPOSAL_NOT_FOUND");
  return selected;
}

async function getEntryAssetIds(database: LaunchDatabase, competitionId: string, proposalIds: string[]) {
  const rows = await database.selectDistinct({ id: assetRegistry.id })
    .from(proposalAssets)
    .innerJoin(proposals, eq(proposals.id, proposalAssets.proposalId))
    .innerJoin(assetRegistry, eq(assetRegistry.id, proposalAssets.assetId))
    .where(and(
      eq(proposals.competitionId, competitionId),
      eq(proposals.status, "confirmed"),
      inArray(proposals.id, proposalIds),
    ));
  return rows.map((asset) => asset.id);
}

function totalVotes(allocations: VoteAllocation[]) {
  return allocations.reduce((sum, allocation) => sum + allocation.votes, 0);
}

function assertVotesUnlocked(startsAt: Date | string, rules: CompetitionRules, existingVotes: number, additions: VoteAllocation[], now: Date = new Date()) {
  if (existingVotes + totalVotes(additions) > getUnlockedVoteCount(startsAt, now, rules)) throw new Error("VOTES_NOT_UNLOCKED");
}

async function assertBallotCanAccept(
  database: ReturnType<typeof requireDb>,
  competitionId: string,
  voterUserId: string,
  additions: VoteAllocation[],
  now: Date,
) {
  const [openCompetition] = await database.select({ startsAt: competitions.startsAt, rules: competitions.rules, rulesHash: competitions.rulesHash }).from(competitions).where(and(
    eq(competitions.id, competitionId),
    eq(competitions.phase, "open"),
    sql`${competitions.endsAt} > ${now}`,
  )).limit(1);
  if (!openCompetition) throw new Error("COMPETITION_NOT_OPEN");
  const rules = assertCompetitionRulesSnapshot(openCompetition.rules, openCompetition.rulesHash);
  if (now < getVotingStartsAt(openCompetition.startsAt, rules)) throw new Error("VOTING_NOT_OPEN");
  const [existing] = await database.select({ id: ballots.id, status: ballots.status }).from(ballots).where(and(
    eq(ballots.competitionId, competitionId),
    eq(ballots.voterUserId, voterUserId),
  )).limit(1);
  const previousAllocations = existing?.status === "valid"
    ? await database.select({ proposalId: ballotAllocations.proposalId, votes: ballotAllocations.votes })
      .from(ballotAllocations).where(eq(ballotAllocations.ballotId, existing.id))
    : [];
  assertVotesUnlocked(openCompetition.startsAt, rules, totalVotes(previousAllocations), additions, now);
}

export async function getBallotSummary(competitionId: string, voterUserId: string): Promise<BallotSummary | null> {
  if (!db) return null;
  const [ballot] = await db.select({
    id: ballots.id,
    status: ballots.status,
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
    updatedAt: ballot.updatedAt.toISOString(),
    allocations,
    votePosts,
  };
}

export async function prepareBallotProof(input: unknown) {
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
  assertVotesUnlocked(competition.startsAt, competition.rules, totalVotes(previousAllocations), parsed.additions);
  const preparedAt = new Date();
  const entryAssetIds = await getEntryAssetIds(database, competition.id, parsed.additions.map((addition) => addition.proposalId));
  await getNewestPriceCheckpointForAssets(entryAssetIds, preparedAt);

  const token = newChallengeToken();
  const tickers = new Map(selectedProposals.map((proposal) => [proposal.id, proposal.ticker]));
  const disclosedChoices = parsed.revealVotes
    ? parsed.additions.map((addition) => ({ ticker: tickers.get(addition.proposalId) ?? "OTF", votes: addition.votes }))
    : [];
  const postText = buildVotePost(parsed.reason, token, disclosedChoices);
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
  const acceptedAt = new Date();
  await assertValidDistribution(database, competition.id, additions);
  const votedProposalIds = additions.map((addition) => addition.proposalId);
  const entryAssetIds = await getEntryAssetIds(database, competition.id, votedProposalIds);
  const entryCapture = await getNewestPriceCheckpointForAssets(entryAssetIds, acceptedAt);
  await assertBallotCanAccept(database, competition.id, session.user.id, additions, acceptedAt);
  const post = await getXPost(parsed.postUrl);
  if (post.username.toLowerCase() !== user.xUsername.toLowerCase()) throw new Error("PROOF_AUTHOR_MISMATCH");
  if (normalizeXPostText(post.text) !== normalizeXPostText(challenge.postText)) throw new Error("PROOF_TEXT_MISMATCH");

  // Repeat free checks immediately before reserving the ballot transaction.
  await assertValidDistribution(database, competition.id, additions);
  await assertBallotCanAccept(database, competition.id, session.user.id, additions, acceptedAt);
  const [activeChallenge] = await database.select({ id: xActionChallenges.id }).from(xActionChallenges).where(and(
    eq(xActionChallenges.id, challenge.id),
    isNull(xActionChallenges.consumedAt),
    gt(xActionChallenges.expiresAt, new Date()),
  )).limit(1);
  if (!activeChallenge) throw new Error("CHALLENGE_EXPIRED");

  // Keep the paid remote evidence check last, but outside the transaction so
  // network latency never holds a pooled database connection or ballot lock.
  const invalidated = await recheckSubmissionEvidence(competition.id, additions.map((addition) => addition.proposalId), 0);
  if (invalidated > 0) throw new Error("PROPOSAL_POST_NOT_FOUND");

  const result = await database.transaction(async (transaction) => {
    const [consumed] = await transaction.update(xActionChallenges).set({ consumedAt: acceptedAt }).where(and(
      eq(xActionChallenges.id, challenge.id), isNull(xActionChallenges.consumedAt), gt(xActionChallenges.expiresAt, acceptedAt)
    )).returning({ id: xActionChallenges.id });
    if (!consumed) throw new Error("CHALLENGE_EXPIRED");
    const [openCompetition] = await transaction.select({ id: competitions.id, startsAt: competitions.startsAt, rules: competitions.rules, rulesHash: competitions.rulesHash }).from(competitions).where(and(
      eq(competitions.id, competition.id), eq(competitions.phase, "open"), sql`${competitions.endsAt} > now()`
    )).limit(1);
    if (!openCompetition) throw new Error("COMPETITION_NOT_OPEN");
    const rules = assertCompetitionRulesSnapshot(openCompetition.rules, openCompetition.rulesHash);
    if (acceptedAt < getVotingStartsAt(openCompetition.startsAt, rules)) throw new Error("VOTING_NOT_OPEN");

    await transaction.execute(sql`select id from ballots where competition_id = ${competition.id} and voter_user_id = ${session.user.id} for update`);
    const [existing] = await transaction.select({ id: ballots.id, status: ballots.status }).from(ballots).where(and(
      eq(ballots.competitionId, competition.id), eq(ballots.voterUserId, session.user.id)
    )).limit(1);
    const previousAllocations = existing?.status === "valid"
      ? await transaction.select({ proposalId: ballotAllocations.proposalId, votes: ballotAllocations.votes })
        .from(ballotAllocations).where(eq(ballotAllocations.ballotId, existing.id))
      : [];
    const existingVotes = totalVotes(previousAllocations);
    assertVotesUnlocked(openCompetition.startsAt, rules, existingVotes, additions, acceptedAt);

    // External evidence was inspected before opening the transaction. Repeat
    // proposal state validation on this transaction's connection before writes.
    await assertValidDistribution(transaction, competition.id, additions, { lock: true });

    const [evidence] = await transaction.insert(tweetEvidence).values({
      action: "vote",
      competitionId: competition.id,
      userId: session.user.id,
      proposalId: null,
      xPostId: post.id,
      xAuthorId: user.xUserId,
      xAuthorUsername: user.xUsername,
      postUrl: post.postUrl,
      postedAt: acceptedAt,
      editHistoryIds: [post.id],
      evidenceHash: hashXPostText(post.text),
      status: "valid",
      verifiedAt: acceptedAt,
      lastCheckedAt: acceptedAt,
      rawText: post.text,
      rawTextExpiresAt: new Date(Date.now() + 30 * 86_400_000),
    }).returning();
    await transaction.insert(evidenceChecks).values({ evidenceId: evidence.id, status: "valid", reason: "oembed-single-use-challenge" });
    const isUpdate = existing?.status === "valid";
    const [ballot] = existing
      ? await transaction.update(ballots).set({
        followerCount: user.followersCount,
        status: "valid",
        invalidatedAt: null,
        updatedAt: acceptedAt,
      }).where(eq(ballots.id, existing.id)).returning()
      : await transaction.insert(ballots).values({ competitionId: competition.id, voterUserId: session.user.id, followerCount: user.followersCount, status: "valid" }).returning();
    if (existing && !isUpdate) {
      await transaction.delete(voteTranches).where(eq(voteTranches.ballotId, ballot.id));
      await transaction.delete(ballotAllocations).where(eq(ballotAllocations.ballotId, ballot.id));
    }
    await transaction.insert(ballotAllocations)
      .values(additions.map((addition) => ({ ballotId: ballot.id, ...addition, updatedAt: acceptedAt })))
      .onConflictDoUpdate({
        target: [ballotAllocations.ballotId, ballotAllocations.proposalId],
        set: { votes: sql`${ballotAllocations.votes} + excluded.votes`, updatedAt: acceptedAt },
      });
    await transaction.insert(voteTranches).values(additions.map((addition) => ({
      competitionId: competition.id,
      ballotId: ballot.id,
      voterUserId: session.user.id,
      proposalId: addition.proposalId,
      evidenceId: evidence.id,
      quantity: addition.votes,
      acceptedAt,
      entryPriceCaptureRunId: entryCapture.runId,
    })));
    const [recordedResult] = await transaction.update(xActionChallenges).set({
      resultBallotId: ballot.id,
    }).where(and(
      eq(xActionChallenges.id, challenge.id),
      eq(xActionChallenges.consumedAt, acceptedAt),
    )).returning({ id: xActionChallenges.id });
    if (!recordedResult) throw new Error("CHALLENGE_RESULT_UNAVAILABLE");
    return {
      action: "ballot" as const,
      ballotId: ballot.id,
      postUrl: evidence.postUrl,
      embedHtml: post.embedHtml,
      additions,
      updatedAt: acceptedAt.toISOString(),
    };
  });
  return result;
}
