import { z } from "zod";

export const allocationSchema = z.object({
  assetId: z.string().uuid(),
  weightBps: z.number().int().min(100).max(10_000)
});

export const proposalInputSchema = z.object({
  competitionId: z.string().uuid(),
  name: z.string().trim().min(5).max(80).refine((value) => value.endsWith(" OTF"), "Name must end in OTF"),
  ticker: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{0,15}$/),
  thesis: z.string().trim().min(20).refine((value) => Buffer.byteLength(value, "utf8") <= 2048, "Thesis must be at most 2,048 bytes"),
  allocations: z.array(allocationSchema).min(2).superRefine((items, context) => {
    if (new Set(items.map((item) => item.assetId)).size !== items.length) context.addIssue({ code: "custom", message: "Assets must be unique" });
    if (items.reduce((sum, item) => sum + item.weightBps, 0) !== 10_000) context.addIssue({ code: "custom", message: "Weights must total 100%" });
  })
});

export const proofInputSchema = z.object({ challengeId: z.string().uuid(), postUrl: z.string().url() });

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

export function earliestLaunchAt(start: Date, rank: number, intervalDays = 4) {
  if (!Number.isInteger(rank) || rank < 1) throw new Error("INVALID_RANK");
  return new Date(start.getTime() + (rank - 1) * intervalDays * 86_400_000);
}

export const errorMessages: Record<string, string> = {
  X_NOT_VERIFIED: "A verified, public X account is required.",
  FOLLOWER_THRESHOLD: "Your X account does not meet the follower requirement.",
  ASSET_INELIGIBLE: "One or more portfolio assets are not currently eligible.",
  WEIGHTS_NOT_100: "Portfolio weights must total 100%.",
  PROOF_EXPIRED: "This proof link expired. Create a new one and try again.",
  PROOF_MISMATCH: "The X post does not match this action.",
  PROOF_REUSED: "That X post has already been used.",
  DUPLICATE_VOTE: "You have already voted for this OTF."
};
