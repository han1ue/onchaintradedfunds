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

export function parseProposalInput(input: unknown) {
  const result = proposalInputSchema.safeParse(input);
  if (result.success) return result.data;
  const issues = result.error.issues;
  if (issues.some((issue) => issue.path[0] === "allocations" && issue.path.length === 1 && issue.code === "too_small")) {
    throw new Error("PROPOSAL_ASSET_MINIMUM");
  }
  if (issues.some((issue) => issue.path.includes("weightBps") && issue.code === "too_small")) {
    throw new Error("PROPOSAL_WEIGHT_MINIMUM");
  }
  if (issues.some((issue) => issue.message === "Assets must be unique")) throw new Error("ASSETS_NOT_UNIQUE");
  if (issues.some((issue) => issue.message === "Weights must total 100%")) throw new Error("WEIGHTS_NOT_100");
  if (issues.some((issue) => issue.path[0] === "name")) throw new Error("PROPOSAL_NAME_INVALID");
  if (issues.some((issue) => issue.path[0] === "ticker")) throw new Error("PROPOSAL_TICKER_INVALID");
  if (issues.some((issue) => issue.path[0] === "thesis")) throw new Error("PROPOSAL_THESIS_INVALID");
  if (issues.some((issue) => issue.path.includes("pricingConfig"))) throw new Error("PRICING_CONFIG_INVALID");
  if (issues.some((issue) => issue.path.includes("assetMetadata") || issue.path.includes("assetId"))) throw new Error("ASSET_METADATA_INVALID");
  throw new Error("INVALID_PROPOSAL");
}

export const xPostReasonSchema = z.string().trim().max(120, "Keep your context to 120 characters or fewer");

export const xPostActionSchema = z.object({
  reason: xPostReasonSchema,
  turnstileToken: z.string().optional()
});

const xPostUrlSchema = z.string().trim().max(300).transform((value) =>
  /^(?:www\.)?(?:x|twitter)\.com\//i.test(value) ? `https://${value}` : value
).pipe(z.string().url());

export const xPostProofSchema = z.object({
  challengeId: z.string().uuid(),
  postUrl: xPostUrlSchema,
});

export const voteAllocationSchema = z.object({
  proposalId: z.string().uuid(),
  votes: z.number().int().min(1).max(COMPETITION_RULES.totalVotes)
});

export const voteAdditionsSchema = z.array(voteAllocationSchema).min(1).superRefine((items, context) => {
  if (new Set(items.map((item) => item.proposalId)).size !== items.length) context.addIssue({ code: "custom", message: "OTF proposals must be unique" });
  if (items.reduce((sum, item) => sum + item.votes, 0) > COMPETITION_RULES.totalVotes) context.addIssue({ code: "custom", message: `Votes cannot exceed ${COMPETITION_RULES.totalVotes}` });
});

export const ballotActivationSchema = z.object({
  reason: xPostReasonSchema,
  additions: voteAdditionsSchema,
  revealVotes: z.boolean().default(false),
  turnstileToken: z.string().optional()
});

export function parseXPostId(value: string) {
  const url = new URL(value);
  if (!["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(url.hostname.toLowerCase())) throw new Error("PROOF_MISMATCH");
  const match = url.pathname.match(/^\/(?:[A-Za-z0-9_]+\/status|i\/(?:web\/)?status)\/(\d+)/);
  if (!match) throw new Error("PROOF_MISMATCH");
  return match[1];
}

export type Rankable = { id: string; votes: number; acceptedAt: Date };

export function rankEntries<T extends Rankable>(entries: T[]) {
  return [...entries]
    .sort((a, b) => b.votes - a.votes || a.acceptedAt.getTime() - b.acceptedAt.getTime() || a.id.localeCompare(b.id))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}
