import type { BallotVotePost, VotePostTranche } from "./types";

export type VoteTranchePostRow = {
  trancheId: string;
  evidenceId: string;
  postUrl: string;
  evidenceStatus: BallotVotePost["status"];
  acceptedAt: Date;
  createdAt: Date;
  proposalId: string;
  proposalName: string;
  proposalSlug: string;
  proposalTicker: string;
  proposalStatus: VotePostTranche["proposalStatus"];
  votes: number;
};

export function buildBallotVotePosts(rows: VoteTranchePostRow[]): BallotVotePost[] {
  const orderedRows = [...rows].sort((left, right) => (
    left.acceptedAt.getTime() - right.acceptedAt.getTime()
    || left.createdAt.getTime() - right.createdAt.getTime()
    || left.trancheId.localeCompare(right.trancheId)
  ));
  const posts = new Map<string, BallotVotePost>();

  for (const row of orderedRows) {
    const tranche: VotePostTranche = {
      id: row.trancheId,
      proposalId: row.proposalId,
      proposalName: row.proposalName,
      proposalSlug: row.proposalSlug,
      proposalTicker: row.proposalTicker,
      proposalStatus: row.proposalStatus,
      votes: row.votes,
      acceptedAt: row.acceptedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
    const existing = posts.get(row.evidenceId);
    if (existing) {
      existing.tranches.push(tranche);
      continue;
    }
    posts.set(row.evidenceId, {
      evidenceId: row.evidenceId,
      postUrl: row.postUrl,
      status: row.evidenceStatus,
      acceptedAt: row.acceptedAt.toISOString(),
      tranches: [tranche],
    });
  }

  return [...posts.values()];
}
