export type AssetQuality = "high" | "normal";

export type PricingConfig =
  | { source: "chainlink-direct"; feedAddress: string }
  | { source: "chainlink-weth"; assetWethFeedAddress: string; wethUsdFeedAddress: string }
  | { source: "uniswap-v3"; poolAddress: string };

export type KnownPricingConfig = PricingConfig & {
  id: string;
  active: boolean;
};

export type ProposalAssetMetadata = {
  network: "robinhood-mainnet";
  chainId: 4663;
  contractAddress: string;
  decimals: 18;
  symbol: string;
  name: string;
};

export type Allocation = {
  assetId: string;
  symbol: string;
  name: string;
  weightBps: number;
  contractAddress?: string;
  poolAddress?: string | null;
  pricingConfig?: PricingConfig | null;
  quality?: AssetQuality;
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
  quality?: AssetQuality;
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
  network: string;
  chainId: number | null;
  decimals: 18;
  quality: AssetQuality;
  priceSource: "robinhood-bid" | "coinbase-eth-usd-bid" | "coingecko-usd";
  latestPriceUsd: number | null;
  latestPriceAt: string | null;
  pricingConfigs: KnownPricingConfig[];
  markets: {
    id: string;
    marketId: string;
    poolAddress: string;
    feeTier: number;
    active: boolean;
    poolCreatedAt: string | null;
    quoteTokenAddress: string;
    evidenceStatus: "Pass" | "Pending" | "Fail" | null;
    evidenceReasons: string[];
  }[];
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

export type XpLeaderboardRow = {
  userId?: string;
  publicName: string;
  usesRealUsername: boolean;
  performanceXp: number;
  participationXp: number;
  creatorXp: number;
  creatorSupportXp?: number;
  creatorAwardXp?: number;
  totalXp: number;
  uniqueSupporterCount: number;
  submissionBoost: boolean;
  pendingTrancheCount: number;
};

export type XpLeaderboard = {
  status: "live" | "final";
  calculatedAt: string;
  priceCheckpointAt: string | null;
  released: { performance: number; verifiedPerformance: number; nonVerifiedPerformance: number; participation: number; creator: number; total: number };
  allocated: { performance: number; participation: number; creator: number; total: number };
  rows: XpLeaderboardRow[];
};
