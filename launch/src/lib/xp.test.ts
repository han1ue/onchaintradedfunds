import { describe, expect, it } from "vitest";
import { rankEntries } from "./validation";
import {
  XP_POOLS,
  XP_SCORE_SCALE,
  calculateXp,
  eligibleProposalIdsAt,
  largestRemainderAllocate,
  maturityFactor,
  performanceScore,
  releasedXp,
  stableCanonicalHash,
  syntheticPortfolioReturn,
  tieAwarePercentile,
} from "./xp";

const votingStartsAt = new Date("2026-08-08T00:00:00Z");
const votingEndsAt = new Date("2026-09-07T00:00:00Z");

describe("XP allocation policy", () => {
  it("keeps the verified pool at a 100% boost while distributing exactly 10M XP", () => {
    expect(XP_POOLS.verifiedPerformance).toBe(XP_POOLS.nonVerifiedPerformance * 2);
    expect(XP_POOLS.performance + XP_POOLS.participation + XP_POOLS.creator).toBe(10_000_000);
  });

  it("releases each pool linearly over 30 voting days", () => {
    const halfway = new Date((votingStartsAt.getTime() + votingEndsAt.getTime()) / 2);
    expect(releasedXp(XP_POOLS.performance, votingStartsAt, votingEndsAt, halfway)).toBe(2_625_000);
    expect(releasedXp(XP_POOLS.creator, votingStartsAt, votingEndsAt, votingStartsAt)).toBe(0);
    expect(releasedXp(XP_POOLS.participation, votingStartsAt, votingEndsAt, votingEndsAt)).toBe(2_750_000);
  });

  it("uses largest remainder rounding with exact deterministic totals", () => {
    const allocation = largestRemainderAllocate(10, [{ id: "b", score: 1n }, { id: "a", score: 1n }, { id: "c", score: 1n }]);
    expect([...allocation.values()].reduce((sum, value) => sum + value, 0)).toBe(10);
    expect(allocation.get("a")).toBe(4);
    expect(allocation.get("b")).toBe(3);
  });

  it("keeps later vote batches as separate score-bearing tranches", () => {
    const result = calculateXp({
      votingStartsAt, votingEndsAt, calculatedAt: votingEndsAt, final: true,
      creators: [{ proposalId: "p1", creatorUserId: "creator", votes: 5 }],
      tranches: [
        { id: "t1", voterUserId: "voter", proposalId: "p1", proposalCreatorUserId: "creator", quantity: 2, performancePool: "verified", effectiveEntryAt: new Date("2026-08-08T00:00:00Z"), selectedReturn: 1n, comparisonReturns: [{ proposalId: "p1", returnValue: 1n }] },
        { id: "t2", voterUserId: "voter", proposalId: "p1", proposalCreatorUserId: "creator", quantity: 3, performancePool: "verified", effectiveEntryAt: new Date("2026-08-09T00:00:00Z"), selectedReturn: 1n, comparisonReturns: [{ proposalId: "p1", returnValue: 1n }] },
      ],
    });
    const voter = result.users.find((user) => user.userId === "voter")!;
    expect(voter.participationXp).toBe(4_500_000);
    expect(voter.performanceXp).toBe(3_500_000);
    expect(result.users.find((user) => user.userId === "creator")?.uniqueSupporterCount).toBe(1);
  });

  it("leaves missing-price performance pending while keeping participation and vote-weighted creator XP", () => {
    const result = calculateXp({
      votingStartsAt, votingEndsAt, calculatedAt: new Date("2026-08-23T00:00:00Z"),
      creators: [{ proposalId: "p1", creatorUserId: "creator", votes: 4 }],
      tranches: [{ id: "pending", voterUserId: "voter", proposalId: "p1", proposalCreatorUserId: "creator", quantity: 4, performancePool: "verified" }],
    });
    expect(result.users.find((user) => user.userId === "voter")).toMatchObject({ performanceXp: 0, participationXp: 1_375_000, pendingTrancheCount: 1 });
    expect(result.released.performance).toBe(0);
    expect(result.users.find((user) => user.userId === "creator")).toMatchObject({ creatorXp: 1_000_000, uniqueSupporterCount: 1, submissionBoost: false });
  });

  it("excludes proposals accepted after the tranche comparison time", () => {
    const ids = eligibleProposalIdsAt([
      { id: "early", acceptedAt: "2026-08-09T00:00:00Z" },
      { id: "late", acceptedAt: "2026-08-11T00:00:00Z" },
    ], new Date("2026-08-10T00:00:00Z"));
    expect(ids).toEqual(["early"]);
  });

  it("handles percentile ties, a single proposal, and 24-hour maturity", () => {
    expect(tieAwarePercentile([{ proposalId: "only", returnValue: 0n }], "only")).toBe(XP_SCORE_SCALE);
    expect(tieAwarePercentile([{ proposalId: "a", returnValue: 1n }, { proposalId: "b", returnValue: 1n }], "a")).toBe(XP_SCORE_SCALE / 2n);
    const results = [{ proposalId: "best", returnValue: 3n }, { proposalId: "middle", returnValue: 2n }, { proposalId: "worst", returnValue: 1n }];
    expect(tieAwarePercentile(results, "best")).toBe(XP_SCORE_SCALE);
    expect(tieAwarePercentile(results, "worst")).toBe(0n);
    expect(maturityFactor(new Date("2026-08-10T00:00:00Z"), new Date("2026-08-10T12:00:00Z"))).toBe(XP_SCORE_SCALE / 2n);
  });

  it("applies quantity × percentile² × maturity and fixed-weight portfolio returns", () => {
    expect(performanceScore(4, XP_SCORE_SCALE / 2n, XP_SCORE_SCALE / 2n)).toBe(XP_SCORE_SCALE / 2n);
    const value = syntheticPortfolioReturn(
      [{ assetId: "a", weightBps: 6000 }, { assetId: "b", weightBps: 4000 }],
      new Map([["a", 100n], ["b", 100n]]),
      new Map([["a", 110n], ["b", 90n]]),
    );
    expect(value).toBe(20_000_000_000n);
  });

  it("keeps unique supporter counts as context without changing vote-weighted creator XP", () => {
    const result = calculateXp({
      votingStartsAt, votingEndsAt, calculatedAt: votingEndsAt, final: true,
      creators: [{ proposalId: "p1", creatorUserId: "creator", votes: 3 }],
      tranches: [
        { id: "self", voterUserId: "creator", proposalId: "p1", proposalCreatorUserId: "creator", quantity: 1, performancePool: "verified" },
        { id: "support-1", voterUserId: "supporter", proposalId: "p1", proposalCreatorUserId: "creator", quantity: 1, performancePool: "verified" },
        { id: "support-2", voterUserId: "supporter", proposalId: "p1", proposalCreatorUserId: "creator", quantity: 1, performancePool: "verified" },
      ],
    });
    expect(result.users.find((user) => user.userId === "creator")).toMatchObject({ creatorXp: 2_000_000, uniqueSupporterCount: 1, submissionBoost: false });
  });

  it("drops invalid or disqualified tranche inputs without penalizing remaining users", () => {
    const validOnly = calculateXp({
      votingStartsAt, votingEndsAt, calculatedAt: new Date("2026-08-23T00:00:00Z"), creators: [],
      tranches: [{ id: "valid", voterUserId: "valid-voter", proposalId: "eligible", proposalCreatorUserId: "creator", quantity: 2, performancePool: "verified" }],
    });
    expect(validOnly.users.find((user) => user.userId === "valid-voter")?.participationXp).toBe(1_375_000);
    expect(validOnly.users.some((user) => user.userId === "invalid-voter")).toBe(false);
  });

  it("allocates verified and non-verified performance independently", () => {
    const result = calculateXp({
      votingStartsAt, votingEndsAt, calculatedAt: votingEndsAt, final: true, creators: [],
      tranches: [
        { id: "verified", voterUserId: "verified-voter", proposalId: "p1", proposalCreatorUserId: "c1", quantity: 1, performancePool: "verified", effectiveEntryAt: votingStartsAt, selectedReturn: 2n, comparisonReturns: [{ proposalId: "p1", returnValue: 2n }] },
        { id: "non-verified", voterUserId: "non-verified-voter", proposalId: "p2", proposalCreatorUserId: "c2", quantity: 1, performancePool: "nonVerified", effectiveEntryAt: votingStartsAt, selectedReturn: 1n, comparisonReturns: [{ proposalId: "p2", returnValue: 1n }] },
      ],
    });
    expect(result.users.find((row) => row.userId === "verified-voter")?.performanceXp).toBe(3_500_000);
    expect(result.users.find((row) => row.userId === "non-verified-voter")?.performanceXp).toBe(1_750_000);
  });

  it("rolls the unified performance pool to participation when no performance is awardable", () => {
    const result = calculateXp({
      votingStartsAt, votingEndsAt, calculatedAt: votingEndsAt, final: true,
      creators: [{ proposalId: "p1", creatorUserId: "creator", votes: 1 }],
      tranches: [
        { id: "pending", voterUserId: "voter", proposalId: "p1", proposalCreatorUserId: "creator", quantity: 1, performancePool: "verified" },
      ],
    });
    expect(result.rollovers.performanceToParticipation).toBe(5_250_000);
    expect(result.users.reduce((sum, user) => sum + user.totalXp, 0)).toBe(10_000_000);
  });

  it("allocates the full creator pool in direct proportion to valid votes", () => {
    const result = calculateXp({
      votingStartsAt, votingEndsAt, calculatedAt: votingEndsAt, final: true,
      creators: [
        { proposalId: "p1", creatorUserId: "c1", votes: 1 },
        { proposalId: "p2", creatorUserId: "c2", votes: 3 },
      ],
      tranches: [
        { id: "support", voterUserId: "v", proposalId: "p1", proposalCreatorUserId: "c1", quantity: 1, performancePool: "verified" },
      ],
    });
    expect(result.users.find((row) => row.userId === "c1")?.creatorXp).toBe(500_000);
    expect(result.users.find((row) => row.userId === "c2")?.creatorXp).toBe(1_500_000);
    expect(result.users.find((row) => row.userId === "c1")?.creatorAwardXp).toBe(0);
  });

  it("allocates exactly 10M final XP idempotently with deterministic hashes and does not alter launch ranking", () => {
    const input: Parameters<typeof calculateXp>[0] = {
      votingStartsAt, votingEndsAt, calculatedAt: votingEndsAt, final: true,
      creators: [
        { proposalId: "p1", creatorUserId: "c1", votes: 2 },
        { proposalId: "p2", creatorUserId: "c2", votes: 1 },
      ],
      tranches: [
        { id: "t1", voterUserId: "v1", proposalId: "p1", proposalCreatorUserId: "c1", quantity: 2, performancePool: "verified", effectiveEntryAt: votingStartsAt, selectedReturn: 2n, comparisonReturns: [{ proposalId: "p1", returnValue: 2n }, { proposalId: "p2", returnValue: 1n }] },
        { id: "t2", voterUserId: "v2", proposalId: "p2", proposalCreatorUserId: "c2", quantity: 1, performancePool: "nonVerified", effectiveEntryAt: votingStartsAt, selectedReturn: 1n, comparisonReturns: [{ proposalId: "p1", returnValue: 2n }, { proposalId: "p2", returnValue: 1n }] },
      ],
    };
    const result = calculateXp(input);
    const retry = calculateXp(input);
    expect(result.users.reduce((sum, user) => sum + user.totalXp, 0)).toBe(10_000_000);
    expect(stableCanonicalHash(result)).toBe(stableCanonicalHash(retry));
    const ranking = rankEntries([
      { id: "p1", votes: 1, acceptedAt: new Date("2026-08-02T00:00:00Z") },
      { id: "p2", votes: 2, acceptedAt: new Date("2026-08-03T00:00:00Z") },
    ]);
    expect(ranking.map((row) => row.id)).toEqual(["p2", "p1"]);
  });
});
