import { randomBytes } from "node:crypto";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { PROPOSAL_DRAFT_TTL_MS } from "@/lib/competition";
import type { ProposalDraft } from "@/lib/types";
import { pricingConfigAddresses } from "@/lib/pricing-config";
import { approximateXPostLength, buildSubmissionPost, buildXIntentUrl, normalizeXPostText, slugifyProposalName } from "@/lib/x-post";
import { proposalInputSchema, xPostActionSchema, xPostProofSchema } from "@/lib/validation";
import { requireDb } from "./db";
import {
  assetRegistry, competitions, evidenceChecks, proposalAssets, proposals,
  assetMarkets, tweetEvidence, users, verifiedAssets, xActionChallenges
} from "./db/schema";
import { requireEligibleActor, requireSession } from "./guards";
import { getXPost, hashXPostText } from "./x";
import { validateUnlistedAsset } from "./unlisted-asset-validation";

const challengeLifetimeMs = 15 * 60_000;
type LaunchDatabase = ReturnType<typeof requireDb>;
type LaunchTransaction = Parameters<Parameters<LaunchDatabase["transaction"]>[0]>[0];
type UnlistedAssetValidation = Awaited<ReturnType<typeof validateUnlistedAsset>>;

function validProposalId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function expireStaleDrafts(
  database: Pick<LaunchDatabase, "execute">,
  now: Date,
  scope: { competitionId?: string; userId?: string } = {},
) {
  await database.execute(sql`
    update ${proposals}
    set ${proposals.status} = 'expired', ${proposals.updatedAt} = ${now}
    where ${proposals.status} = 'draft'
      and ${proposals.draftExpiresAt} is not null
      and ${proposals.draftExpiresAt} <= ${now}
      ${scope.competitionId ? sql`and ${proposals.competitionId} = ${scope.competitionId}` : sql``}
      ${scope.userId ? sql`and ${proposals.creatorUserId} = ${scope.userId}` : sql``}
  `);
}

export async function expireProposalDrafts(competitionId: string, userId: string, now: Date = new Date()) {
  await expireStaleDrafts(requireDb(), now, { competitionId, userId });
}

export async function getProposalDraftForResume(proposalId: string): Promise<ProposalDraft | null> {
  if (!validProposalId(proposalId)) return null;
  const database = requireDb();
  const { session, competition } = await requireEligibleActor();
  const now = new Date();
  await expireStaleDrafts(database, now, { competitionId: competition.id, userId: session.user.id });
  const [proposal] = await database.select({
    id: proposals.id,
    name: proposals.name,
    ticker: proposals.ticker,
    thesis: proposals.thesis,
    draftAllocations: proposals.draftAllocations,
    draftExpiresAt: proposals.draftExpiresAt,
  }).from(proposals).where(and(
    eq(proposals.id, proposalId),
    eq(proposals.competitionId, competition.id),
    eq(proposals.creatorUserId, session.user.id),
    eq(proposals.status, "draft"),
    gt(proposals.draftExpiresAt, now),
  )).limit(1);
  if (!proposal?.draftExpiresAt) return null;
  const parsed = proposalInputSchema.parse({
    name: proposal.name,
    ticker: proposal.ticker,
    thesis: proposal.thesis,
    allocations: proposal.draftAllocations,
  });
  return {
    id: proposal.id,
    name: parsed.name,
    ticker: parsed.ticker,
    thesis: parsed.thesis,
    draftExpiresAt: proposal.draftExpiresAt.toISOString(),
    allocations: parsed.allocations,
  };
}

export async function saveProposalDraft(input: unknown, existingDraftId?: string) {
  const parsed = proposalInputSchema.parse(input);
  if (existingDraftId && !validProposalId(existingDraftId)) throw new Error("PROPOSAL_NOT_FOUND");
  const database = requireDb();
  const { session, competition } = await requireEligibleActor();
  if (parsed.allocations.length < competition.rules.minAssets) throw new Error("PROPOSAL_ASSET_MINIMUM");
  if (parsed.allocations.some((allocation) => allocation.weightBps < competition.rules.minAssetWeightBps)) throw new Error("PROPOSAL_WEIGHT_MINIMUM");
  if (parsed.allocations.reduce((sum, allocation) => sum + allocation.weightBps, 0) !== competition.rules.portfolioWeightBps) throw new Error("PROPOSAL_WEIGHT_TOTAL");

  const validatedManualAssets = new Map<string, UnlistedAssetValidation>();
  for (const allocation of parsed.allocations) {
    if (!("assetMetadata" in allocation)) continue;
    if (allocation.pricingConfig?.source !== "uniswap-v3") throw new Error("UNLISTED_ASSET_MARKET_REQUIRED");
    const validation = await validateUnlistedAsset({
      assetAddress: allocation.assetMetadata.contractAddress,
      poolAddress: allocation.pricingConfig.poolAddress,
      competitionStartsAt: competition.startsAt,
    });
    if (validation.status !== "pass") throw new Error("ASSET_MARKET_REQUIREMENTS_NOT_MET");
    validatedManualAssets.set(allocation.assetMetadata.contractAddress, validation);
  }

  return database.transaction(async (transaction) => {
    const selectedAssetIds = parsed.allocations.flatMap((allocation) => (
      "assetId" in allocation ? [allocation.assetId] : []
    ));
    const selectedAssets = selectedAssetIds.length
      ? await transaction.select({
        id: assetRegistry.id,
        verified: sql<boolean>`${verifiedAssets.assetAddress} is not null`,
        network: assetRegistry.network,
        contractAddress: assetRegistry.contractAddress,
      }).from(assetRegistry)
        .leftJoin(verifiedAssets, sql`lower(${verifiedAssets.assetAddress}) = lower(${assetRegistry.contractAddress})`)
        .where(inArray(assetRegistry.id, selectedAssetIds))
      : [];
    if (selectedAssets.length !== selectedAssetIds.length) throw new Error("ASSET_NOT_FOUND");
    const selectedAssetById = new Map(selectedAssets.map((asset) => [asset.id, asset]));
    const draftAllocations = parsed.allocations.map((allocation) => {
      if ("assetId" in allocation) {
        const asset = selectedAssetById.get(allocation.assetId);
        if (!asset) throw new Error("ASSET_NOT_FOUND");
        const pricingConfig = asset.verified ? null : allocation.pricingConfig;
        if (!asset.verified && !pricingConfig) throw new Error("PRICING_CONFIG_REQUIRED");
        return { ...allocation, pricingConfig };
      }
      const validation = validatedManualAssets.get(allocation.assetMetadata.contractAddress);
      const canonical = validation?.asset;
      if (!canonical) throw new Error("ASSET_VALIDATION_FAILED");
      return {
        ...allocation,
        assetMetadata: {
          ...allocation.assetMetadata,
          contractAddress: canonical.address,
          symbol: canonical.symbol,
          name: canonical.name,
          decimals: canonical.decimals as 18,
        },
      };
    });
    const identities = draftAllocations.map((allocation) => {
      if ("assetMetadata" in allocation) return `${allocation.assetMetadata.network}:${allocation.assetMetadata.contractAddress}`;
      const asset = selectedAssetById.get(allocation.assetId);
      return `${asset?.network}:${asset?.contractAddress.toLowerCase()}`;
    });
    if (new Set(identities).size !== identities.length) {
      throw new Error("ASSETS_NOT_UNIQUE");
    }

    const now = new Date();
    await expireStaleDrafts(transaction, now, { competitionId: competition.id, userId: session.user.id });
    const values = {
      competitionId: competition.id,
      creatorUserId: session.user.id,
      slug: slugifyProposalName(parsed.name),
      name: parsed.name,
      ticker: parsed.ticker,
      thesis: parsed.thesis,
      draftAllocations,
      updatedAt: now,
    };
    if (existingDraftId) {
      const [existing] = await transaction.select({ id: proposals.id }).from(proposals).where(and(
        eq(proposals.id, existingDraftId),
        eq(proposals.competitionId, competition.id),
        eq(proposals.creatorUserId, session.user.id),
        eq(proposals.status, "draft"),
        gt(proposals.draftExpiresAt, now),
      )).limit(1).for("update");
      if (!existing) throw new Error("DRAFT_EXPIRED");
      const [proposal] = await transaction.update(proposals).set(values).where(eq(proposals.id, existing.id)).returning();
      return proposal;
    }
    const [proposal] = await transaction.insert(proposals).values({
      ...values,
      draftExpiresAt: new Date(now.getTime() + PROPOSAL_DRAFT_TTL_MS),
    }).returning();
    return proposal;
  });
}

async function validateDraftAllocationsForConfirmation(
  proposal: { name: string; ticker: string; thesis: string; draftAllocations: unknown[] },
  competitionStartsAt: Date,
) {
  const parsed = proposalInputSchema.parse({
    name: proposal.name,
    ticker: proposal.ticker,
    thesis: proposal.thesis,
    allocations: proposal.draftAllocations,
  });
  const validations = new Map<string, UnlistedAssetValidation>();
  for (const allocation of parsed.allocations) {
    if (!("assetMetadata" in allocation)) continue;
    const poolAddress = allocation.pricingConfig?.source === "uniswap-v3" ? allocation.pricingConfig.poolAddress : null;
    if (!poolAddress) throw new Error("UNLISTED_ASSET_MARKET_REQUIRED");
    const validation = await validateUnlistedAsset({ assetAddress: allocation.assetMetadata.contractAddress, poolAddress, competitionStartsAt });
    if (validation.status !== "pass") throw new Error("ASSET_MARKET_REQUIREMENTS_NOT_MET");
    if (!validation.asset || !validation.marketDetails) throw new Error("ASSET_VALIDATION_FAILED");
    validations.set(allocation.assetMetadata.contractAddress, validation);
  }
  return { allocations: parsed.allocations, validations };
}

async function registerAndLinkProposalAssets(
  transaction: LaunchTransaction,
  proposalId: string,
  prepared: Awaited<ReturnType<typeof validateDraftAllocationsForConfirmation>>,
) {
  const selectedAssetIds = prepared.allocations.flatMap((allocation) => "assetId" in allocation ? [allocation.assetId] : []);
  const selectedAssets = selectedAssetIds.length
    ? await transaction.select({
      id: assetRegistry.id,
      verified: sql<boolean>`${verifiedAssets.assetAddress} is not null`,
    }).from(assetRegistry)
      .leftJoin(verifiedAssets, sql`lower(${verifiedAssets.assetAddress}) = lower(${assetRegistry.contractAddress})`)
      .where(inArray(assetRegistry.id, selectedAssetIds))
    : [];
  if (selectedAssets.length !== selectedAssetIds.length) throw new Error("ASSET_NOT_FOUND");
  const selectedAssetVerification = new Map(selectedAssets.map((asset) => [asset.id, asset.verified]));
  const resolvedAllocations: {
    assetId: string;
    marketId: string | null;
    pricingConfig: (typeof prepared.allocations)[number]["pricingConfig"];
    weightBps: number;
  }[] = [];

  for (const allocation of prepared.allocations) {
    if ("assetId" in allocation) {
      const pricingConfig = selectedAssetVerification.get(allocation.assetId) ? null : allocation.pricingConfig;
      if (!selectedAssetVerification.get(allocation.assetId) && !pricingConfig) throw new Error("PRICING_CONFIG_REQUIRED");
      resolvedAllocations.push({ assetId: allocation.assetId, marketId: null, pricingConfig, weightBps: allocation.weightBps });
      continue;
    }

    const metadata = allocation.assetMetadata;
    const validation = prepared.validations.get(metadata.contractAddress);
    const canonical = validation?.asset;
    const marketDetails = validation?.marketDetails;
    const manualPricing = allocation.pricingConfig;
    if (!canonical) throw new Error("ASSET_VALIDATION_FAILED");
    if (!marketDetails || !manualPricing || manualPricing.source !== "uniswap-v3") throw new Error("ASSET_MARKET_REQUIREMENTS_NOT_MET");
    const findAsset = () => transaction.select({ id: assetRegistry.id }).from(assetRegistry).where(and(
      eq(assetRegistry.network, metadata.network),
      sql`lower(${assetRegistry.contractAddress}) = ${canonical.address}`,
    )).limit(1);
    let [asset] = await findAsset();
    if (!asset) {
      [asset] = await transaction.insert(assetRegistry).values({
        symbol: canonical.symbol,
        name: canonical.name,
        contractAddress: canonical.address,
        network: metadata.network,
        chainId: metadata.chainId,
        decimals: canonical.decimals,
        priceSource: "coingecko-usd",
      }).onConflictDoNothing().returning({ id: assetRegistry.id });
      if (!asset) [asset] = await findAsset();
    }
    if (!asset) throw new Error("ASSET_NOT_FOUND");

    const findMarket = () => transaction.select({ id: assetMarkets.id, assetId: assetMarkets.assetId })
      .from(assetMarkets)
      .where(sql`lower(${assetMarkets.poolAddress}) = ${manualPricing.poolAddress}`)
      .limit(1);
    let [market] = await findMarket();
    if (!market) {
      [market] = await transaction.insert(assetMarkets).values({
        assetId: asset.id,
        marketId: `uniswap-v3:${metadata.network}:${manualPricing.poolAddress}`,
        poolAddress: manualPricing.poolAddress,
        factoryAddress: marketDetails.factoryAddress,
        quoteTokenAddress: marketDetails.quoteTokenAddress,
        feeTier: marketDetails.feeTier,
        poolCreatedAt: marketDetails.poolCreatedAt,
      }).onConflictDoNothing().returning({ id: assetMarkets.id, assetId: assetMarkets.assetId });
      if (!market) [market] = await findMarket();
    }
    if (!market || market.assetId !== asset.id) throw new Error("ASSET_MARKET_NOT_FOUND");
    resolvedAllocations.push({ assetId: asset.id, marketId: market.id, pricingConfig: manualPricing, weightBps: allocation.weightBps });
  }

  if (new Set(resolvedAllocations.map((allocation) => allocation.assetId)).size !== resolvedAllocations.length) {
    throw new Error("ASSETS_NOT_UNIQUE");
  }
  await transaction.insert(proposalAssets).values(resolvedAllocations.map((allocation, position) => {
    const addresses = allocation.pricingConfig ? pricingConfigAddresses(allocation.pricingConfig) : { primaryAddress: null, secondaryAddress: null };
    return {
      proposalId,
      assetId: allocation.assetId,
      marketId: allocation.marketId,
      pricingSource: allocation.pricingConfig?.source ?? null,
      primaryAddress: addresses.primaryAddress,
      secondaryAddress: addresses.secondaryAddress,
      weightBps: allocation.weightBps,
      position,
    };
  }));
}

function newChallengeToken() {
  return `OTF-${randomBytes(8).toString("hex").toUpperCase()}`;
}

async function prepareProof(proposalId: string, input: unknown) {
  const { reason } = xPostActionSchema.parse(input);
  const database = requireDb();
  const { session, competition } = await requireEligibleActor();
  const now = new Date();
  await expireStaleDrafts(database, now, { competitionId: competition.id, userId: session.user.id });
  const [proposal] = await database.select().from(proposals).where(and(
    eq(proposals.id, proposalId),
    eq(proposals.competitionId, competition.id),
    eq(proposals.creatorUserId, session.user.id),
    eq(proposals.status, "draft"),
    gt(proposals.draftExpiresAt, now),
  )).limit(1);
  if (!proposal) throw new Error("PROPOSAL_NOT_FOUND");

  const token = newChallengeToken();
  const postText = buildSubmissionPost(reason, proposal, token);
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
  const now = new Date();
  await expireStaleDrafts(database, now, { competitionId: competition.id, userId: session.user.id });
  const [proposal] = await database.select().from(proposals).where(and(
    eq(proposals.id, proposalId), eq(proposals.competitionId, competition.id),
    eq(proposals.status, "draft"), gt(proposals.draftExpiresAt, now),
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
  if (normalizeXPostText(post.text) !== normalizeXPostText(challenge.postText)) throw new Error("PROOF_TEXT_MISMATCH");
  return { database, session, competition, proposal, challenge, user, post };
}

export function prepareProposalProof(proposalId: string, input: unknown) {
  return prepareProof(proposalId, input);
}

export async function verifyProposalProof(proposalId: string, input: unknown) {
  const context = await loadVerifiedProof(proposalId, input);
  const { database, session, competition, proposal, challenge, user, post } = context;
  if (proposal.creatorUserId !== session.user.id || proposal.status !== "draft") throw new Error("PROPOSAL_NOT_FOUND");
  const preparedAssets = await validateDraftAllocationsForConfirmation(proposal, competition.startsAt);
  const acceptedAt = new Date();
  const result = await database.transaction(async (transaction) => {
    const [openCompetition] = await transaction.select({ id: competitions.id, rules: competitions.rules }).from(competitions).where(and(eq(competitions.id, competition.id), eq(competitions.phase, "open"), sql`${competitions.endsAt} > now()`)).limit(1).for("update");
    if (!openCompetition) throw new Error("COMPETITION_NOT_OPEN");
    const [{ confirmedCount }] = await transaction.select({
      confirmedCount: sql<number>`count(*)::int`,
    }).from(proposals).where(and(
      eq(proposals.competitionId, competition.id),
      eq(proposals.creatorUserId, session.user.id),
      eq(proposals.status, "confirmed"),
    ));
    const proposalLimit = openCompetition.rules.maxProposalsPerAccount;
    if (proposalLimit !== null && confirmedCount >= proposalLimit) throw new Error("PROPOSAL_LIMIT_REACHED");
    const [consumed] = await transaction.update(xActionChallenges).set({ consumedAt: acceptedAt }).where(and(eq(xActionChallenges.id, challenge.id), isNull(xActionChallenges.consumedAt), gt(xActionChallenges.expiresAt, acceptedAt))).returning({ id: xActionChallenges.id });
    if (!consumed) throw new Error("CHALLENGE_EXPIRED");
    const [evidence] = await transaction.insert(tweetEvidence).values({
      action: "submission", competitionId: competition.id, userId: session.user.id, proposalId: proposal.id,
      xPostId: post.id, xAuthorId: user.xUserId, xAuthorUsername: user.xUsername, postUrl: post.postUrl, postedAt: acceptedAt, editHistoryIds: [post.id],
      evidenceHash: hashXPostText(post.text), status: "valid", verifiedAt: acceptedAt, lastCheckedAt: acceptedAt,
      rawText: post.text, rawTextExpiresAt: new Date(Date.now() + 30 * 86_400_000)
    }).returning();
    await transaction.insert(evidenceChecks).values({ evidenceId: evidence.id, status: "valid", reason: "oembed-single-use-challenge" });
    await registerAndLinkProposalAssets(transaction, proposal.id, preparedAssets);
    const [confirmed] = await transaction.update(proposals).set({
      status: "confirmed",
      draftAllocations: [],
      draftExpiresAt: null,
      acceptedAt,
      updatedAt: acceptedAt,
    }).where(and(eq(proposals.id, proposal.id), eq(proposals.status, "draft"), gt(proposals.draftExpiresAt, acceptedAt))).returning();
    if (!confirmed) throw new Error("PROPOSAL_NOT_FOUND");
    return { action: "submission" as const, proposalId: proposal.id, slug: proposal.slug, postUrl: evidence.postUrl };
  });
  return result;
}

export async function deleteProposal(proposalId: string, confirmationName: string) {
  const database = requireDb();
  const session = await requireSession();
  const deletedAt = new Date();
  return database.transaction(async (transaction) => {
    const [competition] = await transaction.select({ id: competitions.id, phase: competitions.phase, endsAt: competitions.endsAt })
      .from(competitions).limit(1).for("update");
    if (!competition) throw new Error("COMPETITION_NOT_OPEN");
    await expireStaleDrafts(transaction, deletedAt, { competitionId: competition.id, userId: session.user.id });
    const [proposal] = await transaction.select({ name: proposals.name, status: proposals.status }).from(proposals).where(and(
      eq(proposals.id, proposalId),
      eq(proposals.competitionId, competition.id),
      eq(proposals.creatorUserId, session.user.id),
    )).limit(1).for("update");
    if (!proposal) throw new Error("PROPOSAL_NOT_FOUND");
    if (proposal.name !== confirmationName) throw new Error("PROPOSAL_NAME_MISMATCH");
    if (proposal.status === "confirmed" && (competition.phase !== "open" || competition.endsAt <= deletedAt)) throw new Error("COMPETITION_NOT_OPEN");
    const [deleted] = await transaction.update(proposals).set({ status: "deleted", draftAllocations: [], updatedAt: deletedAt }).where(and(
      eq(proposals.id, proposalId),
      eq(proposals.competitionId, competition.id),
      eq(proposals.creatorUserId, session.user.id),
      inArray(proposals.status, ["draft", "confirmed", "expired"]),
    )).returning();
    if (!deleted) throw new Error("PROPOSAL_NOT_FOUND");
    return deleted;
  });
}
