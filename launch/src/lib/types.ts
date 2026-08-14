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
  creator: { xId: string; username: string; displayName: string; profileImageUrl?: string | null };
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
  voteCount: number;
  uniqueVoterCount: number;
};

export type EligibleAsset = {
  id: string;
  symbol: string;
  name: string;
  contractAddress: string;
};

export type ParticipationEligibility = {
  connected: boolean;
  eligible: boolean;
  verified: boolean | null;
  publicAccount: boolean | null;
  followersCount: number | null;
  minFollowers: number;
  oldEnough: boolean | null;
  minAccountAgeDays: number;
};

export type VoteAllocation = { proposalId: string; votes: number };

export type BallotSummary = {
  id: string;
  status: "posting" | "valid" | "invalid";
  activatedAt: string | null;
  updatedAt: string;
  updateAvailableAt: string;
  canUpdate: boolean;
  proofUrl?: string | null;
  allocations: VoteAllocation[];
};
