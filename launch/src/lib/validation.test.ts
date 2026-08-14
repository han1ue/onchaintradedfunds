import { describe, expect, it } from "vitest";
import { earliestLaunchAt, parseXPostId, proposalInputSchema, rankEntries } from "./validation";

const assetA = "11111111-1111-4111-8111-111111111111";
const assetB = "22222222-2222-4222-8222-222222222222";
const competitionId = "33333333-3333-4333-8333-333333333333";

describe("proposal validation", () => {
  it("accepts exactly 10,000 basis points across distinct assets", () => {
    expect(proposalInputSchema.parse({ competitionId, name: "Compute OTF", ticker: "CMP", thesis: "A long-term thesis for compute infrastructure.", allocations: [{ assetId: assetA, weightBps: 6000 }, { assetId: assetB, weightBps: 4000 }] }).allocations).toHaveLength(2);
  });
  it("accepts a thesis of any non-empty length", () => {
    expect(proposalInputSchema.parse({ competitionId, name: "Compute OTF", ticker: "CMP", thesis: "A", allocations: [{ assetId: assetA, weightBps: 6000 }, { assetId: assetB, weightBps: 4000 }] }).thesis).toBe("A");
  });
  it("rejects allocations that do not total 100%", () => {
    expect(() => proposalInputSchema.parse({ competitionId, name: "Compute OTF", ticker: "CMP", thesis: "A long-term thesis for compute infrastructure.", allocations: [{ assetId: assetA, weightBps: 6000 }, { assetId: assetB, weightBps: 3000 }] })).toThrow(/100%/);
  });
  it("rejects duplicate assets and names without the OTF suffix", () => {
    expect(() => proposalInputSchema.parse({ competitionId, name: "Compute", ticker: "CMP", thesis: "A long-term thesis for compute infrastructure.", allocations: [{ assetId: assetA, weightBps: 5000 }, { assetId: assetA, weightBps: 5000 }] })).toThrow();
  });
});

describe("proof links", () => {
  it("extracts an immutable post id from X and Twitter URLs", () => {
    expect(parseXPostId("https://x.com/otf/status/1234567890")).toBe("1234567890");
    expect(parseXPostId("https://twitter.com/otf/status/987654321")).toBe("987654321");
  });
  it("rejects lookalike hosts", () => expect(() => parseXPostId("https://x.com.evil.test/a/status/1")).toThrow("PROOF_MISMATCH"));
});

describe("ranking and launch windows", () => {
  it("sorts votes, acceptance time, then immutable id into ordinal ranks", () => {
    const time = new Date("2026-01-01T00:00:00Z");
    const ranked = rankEntries([{ id: "b", votes: 10, acceptedAt: time }, { id: "a", votes: 10, acceptedAt: time }, { id: "c", votes: 11, acceptedAt: new Date("2026-01-02") }]);
    expect(ranked.map((row) => [row.id, row.rank])).toEqual([["c", 1], ["a", 2], ["b", 3]]);
  });
  it("uses independent four-day eligibility intervals", () => {
    expect(earliestLaunchAt(new Date("2026-01-01T00:00:00Z"), 3).toISOString()).toBe("2026-01-09T00:00:00.000Z");
  });
});
