import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "./schema";
import {
  assetPricingConfigs,
  ballots,
  competitions,
  eligibleAssets,
  priceCaptureRuns,
  proposalAssets,
  proposals,
  proposalStatus,
  voteStatus,
  voteTranches,
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

  it("has no obsolete quality cohort columns on vote tranches", () => {
    expect(getTableColumns(voteTranches)).not.toHaveProperty("performanceCohort");
  });

  it("keeps all vote-specific evidence and chronology on tranches", () => {
    expect(getTableColumns(ballots)).not.toHaveProperty("evidenceId");
    expect(getTableColumns(ballots)).not.toHaveProperty("activatedAt");
    expect(getTableColumns(voteTranches)).toHaveProperty("evidenceId");
    expect(getTableColumns(voteTranches)).toHaveProperty("acceptedAt");
  });

  it("does not expose retired finalization, snapshot, launch queue, or activity tables", () => {
    for (const exportName of [
      "activityEvents",
      "finalizationRuns",
      "xpCalculationRuns",
      "xpSnapshotRows",
      "leaderboardSnapshots",
      "leaderboardRows",
      "launchQueue",
    ]) expect(schema).not.toHaveProperty(exportName);
    expect(getTableColumns(competitions)).not.toHaveProperty("launchStartAt");
    expect(getTableColumns(competitions)).not.toHaveProperty("rulesFrozenAt");
    expect(getTableColumns(competitions)).not.toHaveProperty("finalizedAt");
  });

  it("keys price capture runs for cross-instance cron idempotency", () => {
    expect(getTableColumns(priceCaptureRuns)).toHaveProperty("captureKey");
  });

  it("uses only the three user-facing submission states", () => {
    expect(proposalStatus.enumValues).toEqual(["draft", "confirmed", "deleted"]);
    expect(getTableConfig(proposals).indexes.map((index) => index.config.name)).not.toContain("proposal_one_creator_uq");
  });

  it("uses only persisted aggregate ballot states", () => {
    expect(voteStatus.enumValues).toEqual(["valid", "invalid"]);
  });
});
