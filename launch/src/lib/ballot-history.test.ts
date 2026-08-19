import { describe, expect, it } from "vitest";
import { buildBallotVotePosts, type VoteTranchePostRow } from "./ballot-history";

const row = (overrides: Partial<VoteTranchePostRow> = {}): VoteTranchePostRow => ({
  trancheId: "11111111-1111-4111-8111-111111111111",
  evidenceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  postUrl: "https://x.com/voter/status/100",
  evidenceStatus: "valid",
  acceptedAt: new Date("2026-08-10T10:00:00.000Z"),
  createdAt: new Date("2026-08-10T10:00:01.000Z"),
  proposalId: "22222222-2222-4222-8222-222222222222",
  proposalName: "First OTF",
  proposalSlug: "first-otf",
  proposalTicker: "FIRST",
  proposalStatus: "confirmed",
  votes: 1,
  ...overrides,
});

describe("ballot vote-post history", () => {
  it("orders posts by the earliest tranche acceptance time", () => {
    const posts = buildBallotVotePosts([
      row({
        trancheId: "33333333-3333-4333-8333-333333333333",
        evidenceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        postUrl: "https://x.com/voter/status/200",
        acceptedAt: new Date("2026-08-12T10:00:00.000Z"),
      }),
      row(),
    ]);

    expect(posts.map((post) => post.evidenceId)).toEqual([
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ]);
  });

  it("uses tranche creation time to break equal acceptance times", () => {
    const posts = buildBallotVotePosts([
      row({
        trancheId: "33333333-3333-4333-8333-333333333333",
        evidenceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        postUrl: "https://x.com/voter/status/200",
        createdAt: new Date("2026-08-10T10:00:02.000Z"),
      }),
      row(),
    ]);

    expect(posts.map((post) => post.evidenceId)).toEqual([
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    ]);
  });

  it("deduplicates evidence while preserving every tranche in that post", () => {
    const posts = buildBallotVotePosts([
      row({
        trancheId: "33333333-3333-4333-8333-333333333333",
        proposalId: "44444444-4444-4444-8444-444444444444",
        proposalName: "Second OTF",
        proposalSlug: "second-otf",
        proposalTicker: "SECOND",
        votes: 2,
        createdAt: new Date("2026-08-10T10:00:02.000Z"),
      }),
      row(),
    ]);

    expect(posts).toHaveLength(1);
    expect(posts[0].tranches.map((tranche) => [tranche.proposalTicker, tranche.votes])).toEqual([
      ["FIRST", 1],
      ["SECOND", 2],
    ]);
  });
});
