import type { CompetitionRules } from "./competition";

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
  verified?: boolean;
  color?: string;
};

export type ProposalDraft = {
  id: string;
  name: string;
  ticker: string;
  thesis: string;
  draftExpiresAt: string;
  allocations: Array<({ assetId: string } | { assetMetadata: ProposalAssetMetadata }) & {
    pricingConfig?: PricingConfig | null;
    weightBps: number;
  }>;
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
  verified?: boolean;
  allocations: Allocation[];
  proofUrl?: string;
};

export type LeaderboardPage = {
  entries: LeaderboardEntry[];
  nextCursor: string | null;
};

export type LaunchOrderEntry = Pick<LeaderboardEntry, "rank" | "slug" | "name" | "ticker">;

export type LaunchOrderPage = {
  entries: LaunchOrderEntry[];
  nextCursor: string | null;
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
  rules: CompetitionRules;
  rulesHash: string;
  rulesFrozenAt: string;
  proposalCount: number;
  voteCount: number;
  uniqueVoterCount: number;
};

export type AssetRegistryEntry = {
  id: string;
  symbol: string;
  name: string;
  contractAddress: string;
  network: string;
  chainId: number | null;
  decimals: 18;
  verified: boolean;
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

export type VotePostTranche = {
  id: string;
  proposalId: string;
  proposalName: string;
  proposalSlug: string;
  proposalTicker: string;
  proposalStatus: "draft" | "confirmed" | "expired" | "deleted";
  votes: number;
  acceptedAt: string;
  createdAt: string;
};

export type BallotVotePost = {
  evidenceId: string;
  postUrl: string;
  status: "pending" | "valid" | "invalid" | "unavailable";
  acceptedAt: string;
  tranches: VotePostTranche[];
};

export type BallotSummary = {
  id: string;
  status: "valid" | "invalid";
  updatedAt: string;
  allocations: VoteAllocation[];
  votePosts: BallotVotePost[];
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
