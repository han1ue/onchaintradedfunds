import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "./schema";
import {
  assetPricingConfigs,
  assetRegistry,
  ballots,
  competitions,
  priceCaptureRuns,
  assetPriceSnapshots,
  proposalAssets,
  proposals,
  proposalStatus,
  voteStatus,
  voteTranches,
  verifiedAssets,
} from "./schema";

describe("unified asset database schema", () => {
  it("separates asset metadata from address-only verification", () => {
    expect(getTableColumns(assetRegistry)).not.toHaveProperty("quality");
    expect(Object.keys(getTableColumns(verifiedAssets))).toEqual(["assetAddress"]);
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

  it("has no obsolete performance cohort columns on vote tranches", () => {
    expect(getTableColumns(voteTranches)).not.toHaveProperty("performanceCohort");
  });

  it("keeps all vote-specific evidence and chronology on tranches", () => {
    expect(getTableColumns(ballots)).not.toHaveProperty("evidenceId");
    expect(getTableColumns(ballots)).not.toHaveProperty("activatedAt");
    expect(getTableColumns(voteTranches)).toHaveProperty("evidenceId");
    expect(getTableColumns(voteTranches)).toHaveProperty("acceptedAt");
  });

  it("does not expose retired finalization, ranking snapshot, launch queue, or activity tables", () => {
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
    expect(getTableColumns(competitions)).not.toHaveProperty("finalizedAt");
  });

  it("stores a frozen, hashed rules snapshot on the competition", () => {
    expect(getTableColumns(competitions)).toMatchObject({
      rules: expect.anything(),
      rulesHash: expect.anything(),
      rulesFrozenAt: expect.anything(),
    });
  });

  it("keys price capture runs for cross-instance cron idempotency", () => {
    expect(getTableColumns(priceCaptureRuns)).toHaveProperty("captureKey");
    expect(getTableColumns(priceCaptureRuns)).toHaveProperty("ambiguousSymbols");
  });

  it("stores USD price snapshots at hardened precision", () => {
    expect(getTableColumns(assetPriceSnapshots).bidUsd.getSQLType()).toBe("numeric(38, 18)");
  });

  it("persists draft expiry separately from confirmed and deleted proposals", () => {
    expect(proposalStatus.enumValues).toEqual(["draft", "confirmed", "expired", "deleted"]);
    expect(getTableColumns(proposals)).toHaveProperty("draftAllocations");
    expect(getTableColumns(proposals)).toHaveProperty("draftExpiresAt");
    expect(getTableConfig(proposals).indexes.map((index) => index.config.name)).not.toContain("proposal_one_creator_uq");
  });

  it("uses only persisted aggregate ballot states", () => {
    expect(voteStatus.enumValues).toEqual(["valid", "invalid"]);
  });
});
