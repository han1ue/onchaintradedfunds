import { z } from "zod";

export const allocationSchema = z.object({
  assetId: z.string().uuid(),
  weightBps: z.number().int().min(100).max(10_000)
});

export const proposalInputSchema = z.object({
  competitionId: z.string().uuid(),
  name: z.string().trim().min(5).max(80).refine((value) => value.endsWith(" OTF"), "Name must end in OTF"),
  ticker: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9-]{0,15}$/),
  thesis: z.string().trim().min(1, "Thesis is required").refine((value) => Buffer.byteLength(value, "utf8") <= 2048, "Thesis must be at most 2,048 bytes"),
  allocations: z.array(allocationSchema).min(2).superRefine((items, context) => {
    if (new Set(items.map((item) => item.assetId)).size !== items.length) context.addIssue({ code: "custom", message: "Assets must be unique" });
    if (items.reduce((sum, item) => sum + item.weightBps, 0) !== 10_000) context.addIssue({ code: "custom", message: "Weights must total 100%" });
  })
});

export const xPostReasonSchema = z.string().trim().min(20, "Add at least 20 characters of your own context").max(120, "Keep your context to 120 characters or fewer");

export const xPostActionSchema = z.object({
  reason: xPostReasonSchema,
  turnstileToken: z.string().optional()
});

export const xPostProofSchema = z.object({
  challengeId: z.string().uuid(),
  postUrl: z.string().url().max(300)
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

export function earliestLaunchAt(start: Date, rank: number, intervalDays = 4) {
  if (!Number.isInteger(rank) || rank < 1) throw new Error("INVALID_RANK");
  return new Date(start.getTime() + (rank - 1) * intervalDays * 86_400_000);
}
