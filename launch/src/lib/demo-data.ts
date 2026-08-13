import type { CompetitionSummary, EligibleAsset, LeaderboardEntry } from "./types";
import { launchAssets } from "./launch-assets";

export const demoAssets: EligibleAsset[] = launchAssets.map((asset, index) => {
  const tokenSuffix = (index + 1).toString(16).padStart(40, "0");
  const poolSuffix = (index + 101).toString(16).padStart(40, "0");
  return {
    id: `asset-${asset.symbol.toLowerCase()}`,
    robinhoodUid: `preview-${asset.symbol.toLowerCase()}`,
    symbol: asset.symbol,
    name: asset.name,
    contractAddress: `0x${tokenSuffix}`,
    feeTier: 3000,
    poolAddress: `0x${poolSuffix}`,
    observedAt: new Date().toISOString(),
    reason: "Preview data"
  };
});

const colors = ["#23d7b0", "#59a7ff", "#a982ff", "#f0b65a", "#e56f91"];

export const demoLeaderboard: LeaderboardEntry[] = [
  {
    id: "proposal-ai", slug: "ai-infrastructure-otf", rank: 1, name: "AI Infrastructure OTF", ticker: "AIX",
    thesis: "Own the compute, power and platform layer behind the next decade of applied artificial intelligence.",
    creator: { xId: "101", username: "satoshi_data", displayName: "Satoshi Data" }, votes: 1284, acceptedAt: "2026-07-19T10:04:00Z",
    allocations: [{ assetId: "asset-nvda", symbol: "NVDA", name: "NVIDIA", weightBps: 4000, color: colors[0] }, { assetId: "asset-msft", symbol: "MSFT", name: "Microsoft", weightBps: 3500, color: colors[1] }, { assetId: "asset-amd", symbol: "AMD", name: "AMD", weightBps: 2500, color: colors[2] }]
  },
  {
    id: "proposal-magnificent", slug: "magnificent-seven-otf", rank: 2, name: "Magnificent Seven OTF", ticker: "MAG7",
    thesis: "A concentrated basket of the category-defining US technology companies compounding at global scale.",
    creator: { xId: "102", username: "chaincap", displayName: "Chain Capital" }, votes: 982, acceptedAt: "2026-07-19T12:30:00Z",
    allocations: [{ assetId: "asset-aapl", symbol: "AAPL", name: "Apple", weightBps: 3000, color: colors[3] }, { assetId: "asset-msft", symbol: "MSFT", name: "Microsoft", weightBps: 2500, color: colors[1] }, { assetId: "asset-nvda", symbol: "NVDA", name: "NVIDIA", weightBps: 2500, color: colors[0] }, { assetId: "asset-tsla", symbol: "TSLA", name: "Tesla", weightBps: 2000, color: colors[4] }]
  },
  {
    id: "proposal-autonomy", slug: "autonomy-otf", rank: 3, name: "Autonomy OTF", ticker: "AUTO",
    thesis: "A focused portfolio for autonomous mobility, robotics and the silicon that makes physical AI possible.",
    creator: { xId: "103", username: "robotconomy", displayName: "Robotconomy" }, votes: 811, acceptedAt: "2026-07-19T14:15:00Z",
    allocations: [{ assetId: "asset-tsla", symbol: "TSLA", name: "Tesla", weightBps: 5000, color: colors[4] }, { assetId: "asset-nvda", symbol: "NVDA", name: "NVIDIA", weightBps: 3000, color: colors[0] }, { assetId: "asset-amd", symbol: "AMD", name: "AMD", weightBps: 2000, color: colors[2] }]
  },
  {
    id: "proposal-cloud", slug: "cloud-compounders-otf", rank: 4, name: "Cloud Compounders OTF", ticker: "CLDX",
    thesis: "Durable software and cloud platforms with strong recurring revenue and expanding operating leverage.",
    creator: { xId: "104", username: "marble_fund", displayName: "Marble Fund" }, votes: 623, acceptedAt: "2026-07-20T09:10:00Z",
    allocations: [{ assetId: "asset-msft", symbol: "MSFT", name: "Microsoft", weightBps: 5500, color: colors[1] }, { assetId: "asset-aapl", symbol: "AAPL", name: "Apple", weightBps: 4500, color: colors[3] }]
  }
];

export const demoCompetition: CompetitionSummary = {
  id: "preview-competition", slug: "genesis", name: "Genesis Competition", phase: "open",
  startsAt: "2026-07-15T12:00:00Z", endsAt: "2026-08-31T20:00:00Z", minFollowers: 100, minAccountAgeDays: 30,
  proposalCount: demoLeaderboard.length, verifiedVoteCount: demoLeaderboard.reduce((sum, row) => sum + row.votes, 0), uniqueVoterCount: 2_916
};
