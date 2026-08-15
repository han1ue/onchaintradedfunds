import { describe, expect, it } from "vitest";
import { calculatePortfolioReturns } from "./returns";

const allocations = [
  { assetId: "asset-a", symbol: "AAA", name: "Asset A", weightBps: 6000 },
  { assetId: "asset-b", symbol: "BBB", name: "Asset B", weightBps: 4000 },
];

describe("calculatePortfolioReturns", () => {
  it("indexes an initial-weight portfolio to its first complete observation", () => {
    const points = calculatePortfolioReturns(allocations, [
      { assetId: "asset-a", sampledAt: "2026-08-15T10:00:00.000Z", bidUsd: 100 },
      { assetId: "asset-b", sampledAt: "2026-08-15T10:00:00.000Z", bidUsd: 50 },
      { assetId: "asset-a", sampledAt: "2026-08-15T11:00:00.000Z", bidUsd: 110 },
      { assetId: "asset-b", sampledAt: "2026-08-15T11:00:00.000Z", bidUsd: 45 },
    ]);

    expect(points).toEqual([
      { timestamp: "2026-08-15T10:00:00.000Z", returnPct: 0 },
      { timestamp: "2026-08-15T11:00:00.000Z", returnPct: 2 },
    ]);
  });

  it("omits incomplete observations rather than inventing prices", () => {
    const points = calculatePortfolioReturns(allocations, [
      { assetId: "asset-a", sampledAt: "2026-08-15T10:00:00.000Z", bidUsd: 100 },
      { assetId: "asset-a", sampledAt: "2026-08-15T11:00:00.000Z", bidUsd: 105 },
      { assetId: "asset-b", sampledAt: "2026-08-15T11:00:00.000Z", bidUsd: 50 },
    ]);

    expect(points).toEqual([{ timestamp: "2026-08-15T11:00:00.000Z", returnPct: 0 }]);
  });
});
