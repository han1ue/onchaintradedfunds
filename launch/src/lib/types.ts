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
  uniqueSupporterCount?: number;
  submissionBoost?: boolean;
  allocations: Allocation[];
  proofUrl?: string;
};

export type VoterLeaderboardEntry = {
  rank: number;
  publicName: string;
  usesRealUsername: boolean;
  totalXp: number;
  votesCast: number;
  otfsSupported: number;
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
  priceSource: "robinhood-bid" | "coinbase-eth-usd-bid";
  latestPriceUsd: number | null;
  latestPriceAt: string | null;
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
  proofUrl?: string | null;
  allocations: VoteAllocation[];
};

export type PortfolioReturnPoint = {
  timestamp: string;
  returnPct: number;
};

export type PortfolioReturns = {
  proposedAt: string;
  trackingStartedAt: string | null;
  points: PortfolioReturnPoint[];
};

export type XpLeaderboardRow = {
  userId?: string;
  publicName: string;
  usesRealUsername: boolean;
  performanceXp: number;
  participationXp: number;
  creatorXp: number;
  totalXp: number;
  uniqueSupporterCount: number;
  submissionBoost: boolean;
  pendingTrancheCount: number;
};

export type XpLeaderboard = {
  status: "live" | "final";
  calculatedAt: string;
  priceCheckpointAt: string | null;
  released: { performance: number; participation: number; creator: number; total: number };
  allocated: { performance: number; participation: number; creator: number; total: number };
  policyVersion: string;
  rows: XpLeaderboardRow[];
};
