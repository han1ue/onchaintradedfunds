import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  assetPricingConfigs,
  ballots,
  eligibleAssets,
  priceCaptureRuns,
  proposalAssets,
  proposals,
  proposalStatus,
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

  it("keeps voting evidence on tranches rather than the aggregate ballot", () => {
    expect(getTableColumns(ballots)).not.toHaveProperty("evidenceId");
    expect(getTableColumns(voteTranches)).toHaveProperty("evidenceId");
  });

  it("keys price capture runs for cross-instance cron idempotency", () => {
    expect(getTableColumns(priceCaptureRuns)).toHaveProperty("captureKey");
  });

  it("uses only the three user-facing submission states", () => {
    expect(proposalStatus.enumValues).toEqual(["draft", "confirmed", "deleted"]);
    expect(getTableConfig(proposals).indexes.map((index) => index.config.name)).not.toContain("proposal_one_creator_uq");
  });
});
