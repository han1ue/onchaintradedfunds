import type { Allocation, PortfolioReturnPoint } from "./types";

export type AssetPriceSnapshot = {
  assetId: string;
  sampledAt: string;
  bidUsd: number;
};

export function calculatePortfolioReturns(
  allocations: Allocation[],
  snapshots: AssetPriceSnapshot[]
): PortfolioReturnPoint[] {
  if (allocations.length === 0 || snapshots.length === 0) return [];

  const weights = new Map(allocations.map((allocation) => [allocation.assetId, allocation.weightBps / 10_000]));
  const observations = new Map<string, Map<string, number>>();

  for (const snapshot of snapshots) {
    if (!weights.has(snapshot.assetId) || !Number.isFinite(snapshot.bidUsd) || snapshot.bidUsd <= 0) continue;
    const bucket = observations.get(snapshot.sampledAt) ?? new Map<string, number>();
    bucket.set(snapshot.assetId, snapshot.bidUsd);
    observations.set(snapshot.sampledAt, bucket);
  }

  const complete = [...observations.entries()]
    .filter(([, prices]) => allocations.every((allocation) => prices.has(allocation.assetId)))
    .sort(([left], [right]) => new Date(left).getTime() - new Date(right).getTime());
  if (complete.length === 0) return [];

  const baseline = complete[0][1];
  return complete.map(([timestamp, prices]) => {
    const indexedValue = allocations.reduce((total, allocation) => {
      const initialBid = baseline.get(allocation.assetId)!;
      const currentBid = prices.get(allocation.assetId)!;
      return total + weights.get(allocation.assetId)! * (currentBid / initialBid);
    }, 0);
    return { timestamp, returnPct: Number(((indexedValue - 1) * 100).toFixed(4)) };
  });
}
