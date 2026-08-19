import { describe, expect, it } from "vitest";
import type { BallotSummary } from "./types";
import { getCommittedBallotState } from "./ballot-state";

const ballot = (proposalId: string): BallotSummary => ({
  id: "11111111-1111-4111-8111-111111111111",
  status: "valid",
  activatedAt: "2026-08-19T01:00:00.000Z",
  updatedAt: "2026-08-19T01:00:00.000Z",
  allocations: [{ proposalId, votes: 1 }],
  votePosts: [],
});

describe("committed ballot state", () => {
  it("counts votes on deleted OTFs while keeping them out of active proposal rows", () => {
    const state = getCommittedBallotState(
      ["33333333-3333-4333-8333-333333333333"],
      ballot("22222222-2222-4222-8222-222222222222"),
    );

    expect(state).toEqual({
      committedVotes: { "33333333-3333-4333-8333-333333333333": 0 },
      castTotal: 1,
    });
    expect(3 - state.castTotal).toBe(2);
  });

  it("shows committed votes beside an active OTF", () => {
    const proposalId = "22222222-2222-4222-8222-222222222222";
    expect(getCommittedBallotState([proposalId], ballot(proposalId))).toMatchObject({
      committedVotes: { [proposalId]: 1 },
      castTotal: 1,
    });
  });
});
