import { randomBytes } from "node:crypto";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { approximateXPostLength, buildSubmissionPost, buildXIntentUrl, slugifyProposalName } from "@/lib/x-post";
import { proposalInputSchema, xPostActionSchema, xPostProofSchema } from "@/lib/validation";
import { PublicApiError } from "@/lib/errors";
import { requireDb } from "./db";
import {
  activityEvents, competitions, eligibleAssets, evidenceChecks, proposalAssets, proposals,
  tweetEvidence, users, xActionChallenges
} from "./db/schema";
import { requireEligibleActor } from "./guards";
import { env } from "./env";
import { getXPost, hashXPostText } from "./x";
import { assertCompleteProposalPriceCapture, captureAssetPrices } from "./prices";
import { recomputeLiveXp } from "./xp";

const challengeLifetimeMs = 15 * 60_000;

export async function saveProposalDraft(input: unknown) {
  const parsed = proposalInputSchema.parse(input);
  const database = requireDb();
  const { session, competition } = await requireEligibleActor();

  const selectedAssets = await database.select().from(eligibleAssets).where(inArray(eligibleAssets.id, parsed.allocations.map((item) => item.assetId)));
  if (selectedAssets.length !== parsed.allocations.length) throw new Error("ASSET_INELIGIBLE");

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
      proposalId: proposal.id, assetId: allocation.assetId, weightBps: allocation.weightBps, position
    })));
    return proposal;
  });
}

function newChallengeToken() {
  return `OTF-${randomBytes(8).toString("hex").toUpperCase()}`;
}

async function prepareProof(proposalId: string, input: unknown) {
  const { reason } = xPostActionSchema.parse(input);
  const database = requireDb();
  const { session, competition } = await requireEligibleActor();
  const [proposal] = await database.select().from(proposals).where(and(
    eq(proposals.id, proposalId),
    eq(proposals.competitionId, competition.id),
    eq(proposals.creatorUserId, session.user.id),
    eq(proposals.status, "draft")
  )).limit(1);
  if (!proposal) throw new Error("PROPOSAL_NOT_FOUND");

  const token = newChallengeToken();
  const postText = buildSubmissionPost(reason, proposal, env.NEXT_PUBLIC_SITE_URL, token);
  if (approximateXPostLength(postText) > 280) throw new Error("POST_TOO_LONG");
  const [challenge] = await database.insert(xActionChallenges).values({
    action: "submission", competitionId: competition.id, userId: session.user.id, proposalId: proposal.id,
    token, reason, postText, expiresAt: new Date(Date.now() + challengeLifetimeMs)
  }).returning({ id: xActionChallenges.id, expiresAt: xActionChallenges.expiresAt });
  return { challengeId: challenge.id, expiresAt: challenge.expiresAt.toISOString(), postText, intentUrl: buildXIntentUrl(postText) };
}

async function loadVerifiedProof(proposalId: string, input: unknown) {
  const parsed = xPostProofSchema.parse(input);
  const database = requireDb();
  const { session, competition } = await requireEligibleActor();
  const [proposal] = await database.select().from(proposals).where(and(
    eq(proposals.id, proposalId), eq(proposals.competitionId, competition.id)
  )).limit(1);
  if (!proposal) throw new Error("PROPOSAL_NOT_FOUND");
  const [challenge] = await database.select().from(xActionChallenges).where(and(
    eq(xActionChallenges.id, parsed.challengeId), eq(xActionChallenges.action, "submission"), eq(xActionChallenges.userId, session.user.id),
    eq(xActionChallenges.proposalId, proposal.id), isNull(xActionChallenges.consumedAt), gt(xActionChallenges.expiresAt, new Date())
  )).limit(1);
  if (!challenge) throw new Error("CHALLENGE_EXPIRED");
  const [user] = await database.select().from(users).where(eq(users.id, challenge.userId)).limit(1);
  if (!user) throw new Error("X_RECONNECT_REQUIRED");
  const post = await getXPost(parsed.postUrl);
  if (post.username.toLowerCase() !== user.xUsername.toLowerCase()) throw new Error("PROOF_AUTHOR_MISMATCH");
  if (!post.text.includes(challenge.token)) throw new Error("PROOF_CODE_MISSING");
  return { database, session, competition, proposal, challenge, user, post };
}

export function prepareProposalProof(proposalId: string, input: unknown) {
  return prepareProof(proposalId, input);
}

export async function verifyProposalProof(proposalId: string, input: unknown) {
  const context = await loadVerifiedProof(proposalId, input);
  const { database, session, competition, proposal, challenge, user, post } = context;
  if (proposal.creatorUserId !== session.user.id || proposal.status !== "draft") throw new Error("PROPOSAL_NOT_FOUND");
  const proposalAssetRows = await database.select({ id: eligibleAssets.id, symbol: eligibleAssets.symbol })
    .from(proposalAssets)
    .innerJoin(eligibleAssets, eq(eligibleAssets.id, proposalAssets.assetId))
    .where(eq(proposalAssets.proposalId, proposal.id));
  const acceptedAt = new Date();
  let priceCapture: Awaited<ReturnType<typeof captureAssetPrices>>;
  try {
    priceCapture = await captureAssetPrices({ assetIds: proposalAssetRows.map((asset) => asset.id), sampledAt: acceptedAt });
  } catch (error) {
    console.error("Proposal price validation failed", { proposalId: proposal.id, missingSymbols: proposalAssetRows.map((asset) => asset.symbol), error: error instanceof Error ? error.message : "UNKNOWN" });
    throw new PublicApiError("PROPOSAL_PRICE_UNAVAILABLE", { missingSymbols: proposalAssetRows.map((asset) => asset.symbol) });
  }
  const initialPriceCaptureRunId = assertCompleteProposalPriceCapture(priceCapture, proposalAssetRows);
  const result = await database.transaction(async (transaction) => {
    const [consumed] = await transaction.update(xActionChallenges).set({ consumedAt: acceptedAt }).where(and(eq(xActionChallenges.id, challenge.id), isNull(xActionChallenges.consumedAt), gt(xActionChallenges.expiresAt, acceptedAt))).returning({ id: xActionChallenges.id });
    if (!consumed) throw new Error("CHALLENGE_EXPIRED");
    const [openCompetition] = await transaction.select({ id: competitions.id }).from(competitions).where(and(eq(competitions.id, competition.id), eq(competitions.phase, "open"), sql`${competitions.endsAt} > now()`)).limit(1);
    if (!openCompetition) throw new Error("COMPETITION_NOT_OPEN");
    const [evidence] = await transaction.insert(tweetEvidence).values({
      action: "submission", competitionId: competition.id, userId: session.user.id, proposalId: proposal.id,
      xPostId: post.id, xAuthorId: user.xUserId, xAuthorUsername: user.xUsername, postUrl: post.postUrl, postedAt: acceptedAt, editHistoryIds: [post.id],
      evidenceHash: hashXPostText(post.text), status: "valid", verifiedAt: acceptedAt, lastCheckedAt: acceptedAt,
      rawText: post.text, rawTextExpiresAt: new Date(Date.now() + 30 * 86_400_000)
    }).returning();
    await transaction.insert(evidenceChecks).values({ evidenceId: evidence.id, status: "valid", reason: "oembed-single-use-challenge" });
    const [accepted] = await transaction.update(proposals).set({ status: "accepted", acceptedAt, initialPriceCaptureRunId, updatedAt: acceptedAt }).where(and(eq(proposals.id, proposal.id), eq(proposals.status, "draft"))).returning();
    if (!accepted) throw new Error("PROPOSAL_NOT_FOUND");
    await transaction.insert(activityEvents).values({ competitionId: competition.id, actorUserId: session.user.id, proposalId: proposal.id, evidenceId: evidence.id, eventType: "proposal.accepted", occurredAt: acceptedAt, ruleVersion: competition.ruleVersion, metadata: { ticker: proposal.ticker, xPostId: post.id, verifiedBy: "oembed-challenge" } });
    return { action: "submission" as const, proposalId: proposal.id, slug: proposal.slug, postUrl: evidence.postUrl };
  });
  await recomputeLiveXp().catch((error) => console.error("Live XP recalculation after proposal acceptance failed", { error: error instanceof Error ? error.message : "UNKNOWN" }));
  return result;
}
