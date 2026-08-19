import type { BallotSummary } from "./types";

export function getCommittedBallotState(proposalIds: string[], ballot: BallotSummary | null) {
  const committedVotes = Object.fromEntries(proposalIds.map((proposalId) => [proposalId, 0])) as Record<string, number>;
  if (ballot?.status !== "valid") return { committedVotes, castTotal: 0 };

  const activeProposalIds = new Set(proposalIds);
  let castTotal = 0;
  for (const allocation of ballot.allocations) {
    castTotal += allocation.votes;
    if (activeProposalIds.has(allocation.proposalId)) committedVotes[allocation.proposalId] = allocation.votes;
  }

  return { committedVotes, castTotal };
}
