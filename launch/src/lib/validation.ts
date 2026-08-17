import { z } from "zod";
import { COMPETITION_RULES } from "./competition";

export const evmAddressSchema = z.string().trim().regex(/^0x[0-9a-fA-F]{40}$/).transform((value) => value.toLowerCase());

export const pricingConfigSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("chainlink-direct"),
    feedAddress: evmAddressSchema,
  }).strict(),
  z.object({
    source: z.literal("chainlink-weth"),
    assetWethFeedAddress: evmAddressSchema,
    wethUsdFeedAddress: evmAddressSchema,
  }).strict(),
  z.object({
    source: z.literal("uniswap-v3"),
    poolAddress: evmAddressSchema,
  }).strict(),
]);

export const proposalAssetMetadataSchema = z.object({
  network: z.literal("robinhood-mainnet"),
  chainId: z.literal(4663),
  contractAddress: evmAddressSchema,
  decimals: z.literal(18),
  symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{0,15}$/),
  name: z.string().trim().min(1).max(80),
}).strict();

const allocationFields = {
  pricingConfig: pricingConfigSchema.nullable().optional(),
  weightBps: z.number().int().min(COMPETITION_RULES.minAssetWeightBps).max(COMPETITION_RULES.portfolioWeightBps),
};

export const allocationSchema = z.union([
  z.object({ assetId: z.string().uuid(), ...allocationFields }).strict(),
  z.object({ assetMetadata: proposalAssetMetadataSchema, ...allocationFields }).strict(),
]);

export const proposalInputSchema = z.object({
  name: z.string().trim().min(5).max(80).refine((value) => value.endsWith(" OTF"), "Name must end in OTF"),
  ticker: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{0,15}$/),
  thesis: z.string().trim().min(1, "Thesis is required").refine((value) => Buffer.byteLength(value, "utf8") <= 2048, "Thesis must be at most 2,048 bytes"),
  allocations: z.array(allocationSchema).min(COMPETITION_RULES.minAssets).superRefine((items, context) => {
    const identities = items.map((item) => "assetId" in item
      ? `id:${item.assetId}`
      : `${item.assetMetadata.network}:${item.assetMetadata.contractAddress}`);
    if (new Set(identities).size !== items.length) context.addIssue({ code: "custom", message: "Assets must be unique" });
    if (items.reduce((sum, item) => sum + item.weightBps, 0) !== COMPETITION_RULES.portfolioWeightBps) context.addIssue({ code: "custom", message: "Weights must total 100%" });
  })
});

export const xPostReasonSchema = z.string().trim().max(120, "Keep your context to 120 characters or fewer");

export const xPostActionSchema = z.object({
  reason: xPostReasonSchema,
  turnstileToken: z.string().optional()
});

export const xPostProofSchema = z.object({
  challengeId: z.string().uuid(),
  postUrl: z.string().url().max(300)
});

export const voteAllocationSchema = z.object({
  proposalId: z.string().uuid(),
  votes: z.number().int().min(1).max(COMPETITION_RULES.totalVotes)
});

export const voteDistributionSchema = z.array(voteAllocationSchema).min(1).superRefine((items, context) => {
  if (new Set(items.map((item) => item.proposalId)).size !== items.length) context.addIssue({ code: "custom", message: "OTF proposals must be unique" });
  if (items.reduce((sum, item) => sum + item.votes, 0) > COMPETITION_RULES.totalVotes) context.addIssue({ code: "custom", message: `Votes cannot exceed ${COMPETITION_RULES.totalVotes}` });
});

export const ballotActivationSchema = z.object({
  reason: xPostReasonSchema,
  allocations: voteDistributionSchema,
  revealVotes: z.boolean().default(false),
  turnstileToken: z.string().optional()
});

export function parseXPostId(value: string) {
  const url = new URL(value);
  if (!["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(url.hostname.toLowerCase())) throw new Error("PROOF_MISMATCH");
  const match = url.pathname.match(/^\/[A-Za-z0-9_]+\/status\/(\d+)/);
  if (!match) throw new Error("PROOF_MISMATCH");
  return match[1];
}

export type Rankable = { id: string; votes: number; acceptedAt: Date };

export function rankEntries<T extends Rankable>(entries: T[]) {
  return [...entries]
    .sort((a, b) => b.votes - a.votes || a.acceptedAt.getTime() - b.acceptedAt.getTime() || a.id.localeCompare(b.id))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

export function earliestLaunchAt(start: Date, rank: number, intervalDays = COMPETITION_RULES.launchIntervalDays) {
  if (!Number.isInteger(rank) || rank < 1) throw new Error("INVALID_RANK");
  return new Date(start.getTime() + (rank - 1) * intervalDays * 86_400_000);
}
