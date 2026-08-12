import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { proposalInputSchema, xPostActionSchema } from "@/lib/validation";
import { buildSubmissionPost, buildVotePost, slugifyProposalName } from "@/lib/x-post";
import { requireDb } from "./db";
import {
  activityEvents, assetEligibilitySnapshots, competitions, eligibleAssets, evidenceChecks, proposalAssets, proposals,
  tweetEvidence, votes
} from "./db/schema";
import { requireEligibleActor } from "./guards";
import { createXPost, hashXPostText } from "./x";
import { getXUserAccessToken } from "./x-oauth-token";
import { env } from "./env";

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
      proposalId: proposal.id,
      assetId: allocation.assetId,
      eligibilitySnapshotId: snapshotMap.get(allocation.assetId)!,
      weightBps: allocation.weightBps,
      position
    })));
    return proposal;
  });
}

export async function publishProposalToX(proposalId: string, input: unknown) {
  const { reason } = xPostActionSchema.parse(input);
  const database = requireDb();
  const { session, competition, snapshot } = await requireEligibleActor();
  const accessToken = await getXUserAccessToken(session.user.id);
  const [proposal] = await database.select().from(proposals).where(and(
    eq(proposals.id, proposalId), eq(proposals.creatorUserId, session.user.id), eq(proposals.competitionId, competition.id), eq(proposals.status, "draft")
  )).limit(1);
  if (!proposal) throw new Error("PROPOSAL_NOT_FOUND");

  const [reserved] = await database.update(proposals).set({ status: "posting", updatedAt: new Date() }).where(and(
    eq(proposals.id, proposal.id), eq(proposals.status, "draft")
  )).returning({ id: proposals.id });
  if (!reserved) throw new Error("ACTION_IN_PROGRESS");

  let created: Awaited<ReturnType<typeof createXPost>>;
  try {
    created = await createXPost(accessToken, buildSubmissionPost(reason, proposal, env.NEXT_PUBLIC_SITE_URL));
  } catch (error) {
    await database.update(proposals).set({ status: "draft", updatedAt: new Date() }).where(and(eq(proposals.id, proposal.id), eq(proposals.status, "posting")));
    throw error;
  }

  const acceptedAt = new Date();
  try {
    return await database.transaction(async (transaction) => {
      const [openCompetition] = await transaction.select({ id: competitions.id }).from(competitions).where(and(
        eq(competitions.id, competition.id), eq(competitions.phase, "open"), sql`${competitions.endsAt} > now()`
      )).limit(1);
      if (!openCompetition) throw new Error("COMPETITION_NOT_OPEN");
      const [evidence] = await transaction.insert(tweetEvidence).values({
        action: "submission", competitionId: competition.id, userId: session.user.id, proposalId: proposal.id, identitySnapshotId: snapshot.id,
        xPostId: created.id, xAuthorId: session.user.xUserId!, postUrl: `https://x.com/i/web/status/${created.id}`,
        postedAt: acceptedAt, editHistoryIds: [created.id], evidenceHash: hashXPostText(created.text),
        status: "valid", verifiedAt: acceptedAt, lastCheckedAt: acceptedAt, rawText: created.text,
        rawTextExpiresAt: new Date(Date.now() + 30 * 86_400_000)
      }).returning();
      await transaction.insert(evidenceChecks).values({ evidenceId: evidence.id, status: "valid", reason: "created-by-authorized-x-api" });
      const [accepted] = await transaction.update(proposals).set({ status: "accepted", acceptedAt, updatedAt: acceptedAt })
        .where(and(eq(proposals.id, proposal.id), eq(proposals.status, "posting"))).returning();
      if (!accepted) throw new Error("PROPOSAL_NOT_FOUND");
      await transaction.insert(activityEvents).values({ competitionId: competition.id, actorUserId: session.user.id, proposalId: proposal.id, evidenceId: evidence.id, eventType: "proposal.accepted", occurredAt: acceptedAt, ruleVersion: competition.ruleVersion, metadata: { ticker: proposal.ticker, xPostId: created.id, publishedBy: "otf-launch" } });
      return { action: "submission" as const, proposalId: proposal.id, slug: proposal.slug, postUrl: evidence.postUrl };
    });
  } catch (error) {
    await database.update(proposals).set({ status: "draft", updatedAt: new Date() }).where(and(eq(proposals.id, proposal.id), eq(proposals.status, "posting")));
    throw error;
  }
}

export async function publishVoteToX(proposalIdOrSlug: string, input: unknown) {
  const { reason } = xPostActionSchema.parse(input);
  const database = requireDb();
  const { session, competition, snapshot } = await requireEligibleActor({ forVote: true });
  const accessToken = await getXUserAccessToken(session.user.id);
  const [proposal] = await database.select().from(proposals).where(and(
    or(eq(proposals.id, proposalIdOrSlug), eq(proposals.slug, proposalIdOrSlug)),
    eq(proposals.competitionId, competition.id), eq(proposals.status, "accepted")
  )).limit(1);
  if (!proposal) throw new Error("PROPOSAL_NOT_FOUND");
  if (proposal.creatorUserId === session.user.id) throw new Error("SELF_VOTE");
  const [existing] = await database.select({ id: votes.id }).from(votes).where(and(eq(votes.proposalId, proposal.id), eq(votes.voterUserId, session.user.id))).limit(1);
  if (existing) throw new Error("DUPLICATE_VOTE");

  let vote: typeof votes.$inferSelect;
  try {
    [vote] = await database.insert(votes).values({
      competitionId: competition.id, proposalId: proposal.id, voterUserId: session.user.id,
      identitySnapshotId: snapshot.id, followerCount: snapshot.followersCount, status: "posting"
    }).returning();
  } catch (error) {
    if (error instanceof Error && /unique|duplicate/i.test(error.message)) throw new Error("DUPLICATE_VOTE");
    throw error;
  }

  let created: Awaited<ReturnType<typeof createXPost>>;
  try {
    created = await createXPost(accessToken, buildVotePost(reason, proposal, env.NEXT_PUBLIC_SITE_URL));
  } catch (error) {
    await database.delete(votes).where(and(eq(votes.id, vote.id), eq(votes.status, "posting")));
    throw error;
  }

  const acceptedAt = new Date();
  try {
    return await database.transaction(async (transaction) => {
      const [openCompetition] = await transaction.select({ id: competitions.id }).from(competitions).where(and(
        eq(competitions.id, competition.id), eq(competitions.phase, "open"), sql`${competitions.endsAt} > now()`
      )).limit(1);
      if (!openCompetition) throw new Error("COMPETITION_NOT_OPEN");
      const [evidence] = await transaction.insert(tweetEvidence).values({
        action: "vote", competitionId: competition.id, userId: session.user.id, proposalId: proposal.id, identitySnapshotId: snapshot.id,
        xPostId: created.id, xAuthorId: session.user.xUserId!, postUrl: `https://x.com/i/web/status/${created.id}`,
        postedAt: acceptedAt, editHistoryIds: [created.id], evidenceHash: hashXPostText(created.text),
        status: "valid", verifiedAt: acceptedAt, lastCheckedAt: acceptedAt, rawText: created.text,
        rawTextExpiresAt: new Date(Date.now() + 30 * 86_400_000)
      }).returning();
      await transaction.insert(evidenceChecks).values({ evidenceId: evidence.id, status: "valid", reason: "created-by-authorized-x-api" });
      const [accepted] = await transaction.update(votes).set({ status: "valid", evidenceId: evidence.id, acceptedAt, updatedAt: acceptedAt })
        .where(and(eq(votes.id, vote.id), eq(votes.status, "posting"))).returning();
      if (!accepted) throw new Error("VOTE_NOT_FOUND");
      await transaction.insert(activityEvents).values({ competitionId: competition.id, actorUserId: session.user.id, proposalId: proposal.id, voteId: vote.id, evidenceId: evidence.id, eventType: "vote.accepted", occurredAt: acceptedAt, ruleVersion: competition.ruleVersion, metadata: { followers: vote.followerCount, xPostId: created.id, publishedBy: "otf-launch" } });
      return { action: "vote" as const, proposalId: proposal.id, postUrl: evidence.postUrl };
    });
  } catch (error) {
    await database.delete(votes).where(and(eq(votes.id, vote.id), eq(votes.status, "posting")));
    throw error;
  }
}
