import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  assetPricingConfigs,
  eligibleAssets,
  proposalAssets,
  voteTranches,
  xpSnapshotRows,
} from "./schema";

describe("unified asset database schema", () => {
  it("stores only informational high/normal asset quality metadata", () => {
    const columns = getTableColumns(eligibleAssets);
    expect(columns).toHaveProperty("quality");
    expect(columns).not.toHaveProperty("qualityStatus");
  });

  it("stores reusable configs separately and snapshots exact proposal config addresses", () => {
    expect(getTableColumns(assetPricingConfigs)).toMatchObject({
      source: expect.anything(),
      primaryAddress: expect.anything(),
      secondaryAddress: expect.anything(),
    });
    expect(getTableColumns(proposalAssets)).toMatchObject({
      pricingSource: expect.anything(),
      primaryAddress: expect.anything(),
      secondaryAddress: expect.anything(),
    });
  });

  it("has no quality cohort columns in new XP state", () => {
    expect(getTableColumns(voteTranches)).not.toHaveProperty("performanceCohort");
    expect(getTableColumns(xpSnapshotRows)).not.toHaveProperty("qualifiedPerformanceXp");
    expect(getTableColumns(xpSnapshotRows)).not.toHaveProperty("experimentalPerformanceXp");
  });
});
