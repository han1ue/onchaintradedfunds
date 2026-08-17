import { randomBytes } from "node:crypto";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { pricingConfigAddresses } from "@/lib/pricing-config";
import { approximateXPostLength, buildSubmissionPost, buildXIntentUrl, slugifyProposalName } from "@/lib/x-post";
import { proposalInputSchema, xPostActionSchema, xPostProofSchema } from "@/lib/validation";
import { requireDb } from "./db";
import {
  activityEvents, competitions, eligibleAssets, evidenceChecks, proposalAssets, proposals,
  tweetEvidence, users, xActionChallenges
} from "./db/schema";
import { requireEligibleActor } from "./guards";
import { env } from "./env";
import { getXPost, hashXPostText } from "./x";

const challengeLifetimeMs = 15 * 60_000;

export async function saveProposalDraft(input: unknown) {
  const parsed = proposalInputSchema.parse(input);
  const database = requireDb();
  const { session, competition } = await requireEligibleActor();

  return database.transaction(async (transaction) => {
    const selectedAssetIds = parsed.allocations.flatMap((allocation) => (
      "assetId" in allocation ? [allocation.assetId] : []
    ));
    const selectedAssets = selectedAssetIds.length
      ? await transaction.select({ id: eligibleAssets.id, quality: eligibleAssets.quality }).from(eligibleAssets)
        .where(inArray(eligibleAssets.id, selectedAssetIds))
      : [];
    if (selectedAssets.length !== selectedAssetIds.length) throw new Error("ASSET_NOT_FOUND");

    const resolvedAllocations = [];
    for (const allocation of parsed.allocations) {
      if ("assetId" in allocation) {
        resolvedAllocations.push({ ...allocation, assetId: allocation.assetId });
        continue;
      }

      const metadata = allocation.assetMetadata;
      const findMetadataRow = () => transaction.select({ id: eligibleAssets.id }).from(eligibleAssets)
        .where(and(
          eq(eligibleAssets.network, metadata.network),
          sql`lower(${eligibleAssets.contractAddress}) = ${metadata.contractAddress}`,
        ))
        .limit(1);
      let [asset] = await findMetadataRow();
      if (!asset) {
        [asset] = await transaction.insert(eligibleAssets).values({
          symbol: metadata.symbol,
          name: metadata.name,
          contractAddress: metadata.contractAddress,
          network: metadata.network,
          chainId: metadata.chainId,
          decimals: metadata.decimals,
          quality: "normal",
          priceSource: "robinhood-bid",
        }).onConflictDoNothing().returning({ id: eligibleAssets.id });
        if (!asset) [asset] = await findMetadataRow();
      }
      if (!asset) throw new Error("ASSET_NOT_FOUND");
      resolvedAllocations.push({ ...allocation, assetId: asset.id });
    }
    if (new Set(resolvedAllocations.map((allocation) => allocation.assetId)).size !== resolvedAllocations.length) {
      throw new Error("ASSETS_NOT_UNIQUE");
    }
    const resolvedAssetRows = await transaction.select({ id: eligibleAssets.id, quality: eligibleAssets.quality })
      .from(eligibleAssets)
      .where(inArray(eligibleAssets.id, resolvedAllocations.map((allocation) => allocation.assetId)));
    const assetQuality = new Map(resolvedAssetRows.map((asset) => [asset.id, asset.quality]));
    if (resolvedAllocations.some((allocation) => assetQuality.get(allocation.assetId) !== "high" && !allocation.pricingConfig)) {
      throw new Error("PRICING_CONFIG_REQUIRED");
    }

    const [existing] = await transaction.select().from(proposals)
      .where(and(eq(proposals.competitionId, competition.id), eq(proposals.creatorUserId, session.user.id))).limit(1);
    if (existing && existing.status !== "draft") throw new Error("PROPOSAL_IMMUTABLE");
    const values = { competitionId: competition.id, creatorUserId: session.user.id, slug: slugifyProposalName(parsed.name), name: parsed.name, ticker: parsed.ticker, thesis: parsed.thesis, updatedAt: new Date() };
    const [proposal] = existing
      ? await transaction.update(proposals).set(values).where(eq(proposals.id, existing.id)).returning()
      : await transaction.insert(proposals).values(values).returning();
    await transaction.delete(proposalAssets).where(eq(proposalAssets.proposalId, proposal.id));
    await transaction.insert(proposalAssets).values(resolvedAllocations.map((allocation, position) => {
      const addresses = allocation.pricingConfig ? pricingConfigAddresses(allocation.pricingConfig) : { primaryAddress: null, secondaryAddress: null };
      return {
        proposalId: proposal.id,
        assetId: allocation.assetId,
        marketId: null,
        pricingSource: allocation.pricingConfig?.source ?? null,
        primaryAddress: addresses.primaryAddress,
        secondaryAddress: addresses.secondaryAddress,
        weightBps: allocation.weightBps,
        position,
      };
    }));
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
  const proof = xPostProofSchema.safeParse(input);
  if (!proof.success) throw new Error("PROOF_MISMATCH");
  const parsed = proof.data;
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
  const acceptedAt = new Date();
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
    const [accepted] = await transaction.update(proposals).set({ status: "accepted", acceptedAt, updatedAt: acceptedAt }).where(and(eq(proposals.id, proposal.id), eq(proposals.status, "draft"))).returning();
    if (!accepted) throw new Error("PROPOSAL_NOT_FOUND");
    await transaction.insert(activityEvents).values({ competitionId: competition.id, actorUserId: session.user.id, proposalId: proposal.id, evidenceId: evidence.id, eventType: "proposal.accepted", occurredAt: acceptedAt, ruleVersion: competition.ruleVersion, metadata: { ticker: proposal.ticker, xPostId: post.id, verifiedBy: "oembed-challenge" } });
    return { action: "submission" as const, proposalId: proposal.id, slug: proposal.slug, postUrl: evidence.postUrl };
  });
  return result;
}
