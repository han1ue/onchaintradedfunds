import type { AssetRegistryEntry, CompetitionSummary, LeaderboardEntry } from "./types";
import { COMPETITION_IDENTITY, COMPETITION_RULES, COMPETITION_RULES_HASH, DAY_MS } from "./competition";

export const demoAssetRegistry: AssetRegistryEntry[] = [];

const colors = [
  "var(--chart-series-1)",
  "var(--chart-series-3)",
  "var(--chart-series-5)",
  "var(--chart-series-4)",
  "var(--chart-series-6)",
];

export const demoLeaderboard: LeaderboardEntry[] = [
  {
    id: "proposal-ai", slug: "ai-infrastructure-otf", rank: 1, name: "AI Infrastructure OTF", ticker: "AIX",
    thesis: "Own the compute, power and platform layer behind the next decade of applied artificial intelligence.",
    creator: { xId: "101", username: "satoshi_data", displayName: "Satoshi Data", verified: true }, votes: 42, acceptedAt: "2026-08-09T10:04:00Z",
    allocations: [{ assetId: "asset-nvda", symbol: "NVDA", name: "NVIDIA", weightBps: 4000, color: colors[0] }, { assetId: "asset-msft", symbol: "MSFT", name: "Microsoft", weightBps: 3500, color: colors[1] }, { assetId: "asset-amd", symbol: "AMD", name: "AMD", weightBps: 2500, color: colors[2] }]
  },
  {
    id: "proposal-magnificent", slug: "magnificent-seven-otf", rank: 2, name: "Magnificent Seven OTF", ticker: "MAG7",
    thesis: "A concentrated basket of the category-defining US technology companies compounding at global scale.",
    creator: { xId: "102", username: "chaincap", displayName: "Chain Capital", verified: true }, votes: 35, acceptedAt: "2026-08-10T12:30:00Z",
    allocations: [{ assetId: "asset-aapl", symbol: "AAPL", name: "Apple", weightBps: 3000, color: colors[3] }, { assetId: "asset-msft", symbol: "MSFT", name: "Microsoft", weightBps: 2500, color: colors[1] }, { assetId: "asset-nvda", symbol: "NVDA", name: "NVIDIA", weightBps: 2500, color: colors[0] }, { assetId: "asset-tsla", symbol: "TSLA", name: "Tesla", weightBps: 2000, color: colors[4] }]
  },
  {
    id: "proposal-autonomy", slug: "autonomy-otf", rank: 3, name: "Autonomy OTF", ticker: "AUTO",
    thesis: "A focused portfolio for autonomous mobility, robotics and the silicon that makes physical AI possible.",
    creator: { xId: "103", username: "robotconomy", displayName: "Robotconomy", verified: false }, votes: 28, acceptedAt: "2026-08-11T14:15:00Z",
    allocations: [{ assetId: "asset-tsla", symbol: "TSLA", name: "Tesla", weightBps: 5000, color: colors[4] }, { assetId: "asset-nvda", symbol: "NVDA", name: "NVIDIA", weightBps: 3000, color: colors[0] }, { assetId: "asset-amd", symbol: "AMD", name: "AMD", weightBps: 2000, color: colors[2] }]
  },
  {
    id: "proposal-cloud", slug: "cloud-compounders-otf", rank: 4, name: "Cloud Compounders OTF", ticker: "CLDX",
    thesis: "Durable software and cloud platforms with strong recurring revenue and expanding operating leverage.",
    creator: { xId: "104", username: "marble_fund", displayName: "Marble Fund", verified: true }, votes: 19, acceptedAt: "2026-08-12T09:10:00Z",
    allocations: [{ assetId: "asset-msft", symbol: "MSFT", name: "Microsoft", weightBps: 5500, color: colors[1] }, { assetId: "asset-aapl", symbol: "AAPL", name: "Apple", weightBps: 4500, color: colors[3] }]
  }
];

const previewStartsAt = new Date(Date.now() - COMPETITION_RULES.submissionOnlyDays * DAY_MS - 60_000);
const previewEndsAt = new Date(previewStartsAt.getTime() + (COMPETITION_RULES.submissionOnlyDays + COMPETITION_RULES.votingDays) * DAY_MS);

export const demoCompetition: CompetitionSummary = {
  id: "preview-competition", ...COMPETITION_IDENTITY, phase: "open",
  startsAt: previewStartsAt.toISOString(), endsAt: previewEndsAt.toISOString(),
  rules: COMPETITION_RULES, rulesHash: COMPETITION_RULES_HASH, rulesFrozenAt: previewStartsAt.toISOString(),
  minFollowers: COMPETITION_RULES.minFollowers, minAccountAgeDays: COMPETITION_RULES.minAccountAgeDays,
  proposalCount: demoLeaderboard.length, voteCount: demoLeaderboard.reduce((sum, row) => sum + row.votes, 0), uniqueVoterCount: 37
};
