import { randomBytes } from "node:crypto";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { BallotSummary, VoteAllocation } from "@/lib/types";
import { approximateXPostLength, buildVotePost, buildXIntentUrl } from "@/lib/x-post";
import { ballotActivationSchema, ballotUpdateSchema, voteDistributionSchema, xPostProofSchema } from "@/lib/validation";
import { db, requireDb } from "./db";
import {
  activityEvents, ballotAllocations, ballots, competitions, evidenceChecks, proposals,
  tweetEvidence, xActionChallenges
} from "./db/schema";
import { env } from "./env";
import { requireEligibleActor } from "./guards";
import { getXPost, hashXPostText } from "./x";

const challengeLifetimeMs = 15 * 60_000;

function newChallengeToken() {
  return `OTF-${randomBytes(8).toString("hex").toUpperCase()}`;
}

async function assertValidDistribution(
  database: ReturnType<typeof requireDb>,
  competitionId: string,
  voterUserId: string,
  allocations: VoteAllocation[]
) {
  const proposalIds = allocations.map((allocation) => allocation.proposalId);
  const selected = await database.select({ id: proposals.id, creatorUserId: proposals.creatorUserId })
    .from(proposals).where(and(
      eq(proposals.competitionId, competitionId),
      eq(proposals.status, "accepted"),
      inArray(proposals.id, proposalIds)
    ));
  if (selected.length !== proposalIds.length) throw new Error("PROPOSAL_NOT_FOUND");
  if (selected.some((proposal) => proposal.creatorUserId === voterUserId)) throw new Error("SELF_VOTE");
}

export async function getBallotSummary(competitionId: string, voterUserId: string): Promise<BallotSummary | null> {
  if (!db) return null;
  const [ballot] = await db.select({
    id: ballots.id,
    status: ballots.status,
    activatedAt: ballots.activatedAt,
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
    proofUrl: ballot.proofUrl,
    allocations,
  };
}

export async function prepareBallotProof(input: unknown) {
  const parsed = ballotActivationSchema.parse(input);
  const database = requireDb();
  const { session, competition } = await requireEligibleActor();
  await assertValidDistribution(database, competition.id, session.user.id, parsed.allocations);
  const [existing] = await database.select({ status: ballots.status }).from(ballots).where(and(
    eq(ballots.competitionId, competition.id), eq(ballots.voterUserId, session.user.id)
  )).limit(1);
  if (existing?.status === "valid") throw new Error("BALLOT_ALREADY_ACTIVE");

  const token = newChallengeToken();
  const postText = buildVotePost(parsed.reason, env.NEXT_PUBLIC_SITE_URL, token);
  if (approximateXPostLength(postText) > 280) throw new Error("POST_TOO_LONG");
  const [challenge] = await database.insert(xActionChallenges).values({
    action: "vote",
    competitionId: competition.id,
    userId: session.user.id,
    proposalId: null,
    token,
    reason: parsed.reason,
    postText,
    payload: { allocations: parsed.allocations },
    expiresAt: new Date(Date.now() + challengeLifetimeMs),
  }).returning({ id: xActionChallenges.id, expiresAt: xActionChallenges.expiresAt });
  return { challengeId: challenge.id, expiresAt: challenge.expiresAt.toISOString(), postText, intentUrl: buildXIntentUrl(postText) };
}

export async function verifyBallotProof(input: unknown) {
  const parsed = xPostProofSchema.parse(input);
  const database = requireDb();
  const { session, user, competition } = await requireEligibleActor();
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
  await assertValidDistribution(database, competition.id, session.user.id, allocations);
  const post = await getXPost(parsed.postUrl);
  if (post.username.toLowerCase() !== user.xUsername.toLowerCase()) throw new Error("PROOF_AUTHOR_MISMATCH");
  if (!post.text.includes(challenge.token)) throw new Error("PROOF_CODE_MISSING");

  const activatedAt = new Date();
  return database.transaction(async (transaction) => {
    const [consumed] = await transaction.update(xActionChallenges).set({ consumedAt: activatedAt }).where(and(
      eq(xActionChallenges.id, challenge.id), isNull(xActionChallenges.consumedAt), gt(xActionChallenges.expiresAt, activatedAt)
    )).returning({ id: xActionChallenges.id });
    if (!consumed) throw new Error("CHALLENGE_EXPIRED");
    const [openCompetition] = await transaction.select({ id: competitions.id }).from(competitions).where(and(
      eq(competitions.id, competition.id), eq(competitions.phase, "open"), sql`${competitions.endsAt} > now()`
    )).limit(1);
    if (!openCompetition) throw new Error("COMPETITION_NOT_OPEN");

    const [existing] = await transaction.select({ id: ballots.id, status: ballots.status }).from(ballots).where(and(
      eq(ballots.competitionId, competition.id), eq(ballots.voterUserId, session.user.id)
    )).limit(1);
    if (existing?.status === "valid") throw new Error("BALLOT_ALREADY_ACTIVE");
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
    const [ballot] = existing
      ? await transaction.update(ballots).set({ evidenceId: evidence.id, followerCount: user.followersCount, status: "valid", activatedAt, invalidatedAt: null, updatedAt: activatedAt }).where(eq(ballots.id, existing.id)).returning()
      : await transaction.insert(ballots).values({ competitionId: competition.id, voterUserId: session.user.id, evidenceId: evidence.id, followerCount: user.followersCount, status: "valid", activatedAt }).returning();
    await transaction.delete(ballotAllocations).where(eq(ballotAllocations.ballotId, ballot.id));
    await transaction.insert(ballotAllocations).values(allocations.map((allocation) => ({ ballotId: ballot.id, ...allocation, updatedAt: activatedAt })));
    await transaction.insert(activityEvents).values({
      competitionId: competition.id,
      actorUserId: session.user.id,
      ballotId: ballot.id,
      evidenceId: evidence.id,
      eventType: "ballot.activated",
      occurredAt: activatedAt,
      ruleVersion: competition.ruleVersion,
      metadata: { votes: 100, proposals: allocations.length, xPostId: post.id, verifiedBy: "oembed-challenge" },
    });
    return { action: "ballot" as const, ballotId: ballot.id, postUrl: evidence.postUrl, embedHtml: post.embedHtml, allocations };
  });
}

export async function updateBallotDistribution(input: unknown) {
  const parsed = ballotUpdateSchema.parse(input);
  const database = requireDb();
  const { session, competition } = await requireEligibleActor();
  await assertValidDistribution(database, competition.id, session.user.id, parsed.allocations);
  const updatedAt = new Date();
  return database.transaction(async (transaction) => {
    await transaction.execute(sql`select id from ballots where competition_id = ${competition.id} and voter_user_id = ${session.user.id} for update`);
    const [ballot] = await transaction.select({ id: ballots.id }).from(ballots).where(and(
      eq(ballots.competitionId, competition.id), eq(ballots.voterUserId, session.user.id), eq(ballots.status, "valid")
    )).limit(1);
    if (!ballot) throw new Error("BALLOT_NOT_ACTIVE");
    await transaction.delete(ballotAllocations).where(eq(ballotAllocations.ballotId, ballot.id));
    await transaction.insert(ballotAllocations).values(parsed.allocations.map((allocation) => ({ ballotId: ballot.id, ...allocation, updatedAt })));
    await transaction.update(ballots).set({ updatedAt }).where(eq(ballots.id, ballot.id));
    await transaction.insert(activityEvents).values({
      competitionId: competition.id,
      actorUserId: session.user.id,
      ballotId: ballot.id,
      eventType: "ballot.updated",
      occurredAt: updatedAt,
      ruleVersion: competition.ruleVersion,
      metadata: { votes: 100, proposals: parsed.allocations.length },
    });
    return { ballotId: ballot.id, allocations: parsed.allocations, updatedAt: updatedAt.toISOString() };
  });
}
