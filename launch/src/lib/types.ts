export type Allocation = {
  assetId: string;
  symbol: string;
  name: string;
  weightBps: number;
  color?: string;
};

export type LeaderboardEntry = {
  id: string;
  slug: string;
  rank: number;
  name: string;
  ticker: string;
  thesis: string;
  creator: { xId: string; username: string; displayName: string };
  votes: number;
  acceptedAt: string;
  allocations: Allocation[];
  proofUrl?: string;
};

export type CompetitionSummary = {
  id: string;
  slug: string;
  name: string;
  phase: "draft" | "scheduled" | "open" | "auditing" | "final" | "cancelled";
  startsAt: string;
  endsAt: string;
  minFollowers: number;
  minAccountAgeDays: number;
  proposalCount: number;
  verifiedVoteCount: number;
  uniqueVoterCount: number;
};

export type EligibleAsset = {
  id: string;
  robinhoodUid: string;
  symbol: string;
  name: string;
  contractAddress: string;
  logoUrl?: string | null;
  feeTier: number;
  poolAddress: string;
  observedAt: string;
  reason: string;
};
