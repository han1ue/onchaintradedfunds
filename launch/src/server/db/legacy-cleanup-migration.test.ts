import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../../drizzle/0000_launch_baseline.sql", import.meta.url),
  "utf8",
);

describe("squashed launch baseline", () => {
  it("does not recreate retired workflow tables or enums", () => {
    for (const table of [
      "activity_events",
      "finalization_runs",
      "xp_calculation_runs",
      "xp_snapshot_rows",
      "leaderboard_snapshots",
      "leaderboard_rows",
      "launch_queue",
    ]) expect(migration).not.toContain(`CREATE TABLE "${table}"`);
    expect(migration).not.toContain('CREATE TYPE "public"."launch_status"');
    expect(migration).not.toContain('CREATE TYPE "public"."xp_run_status"');
  });

  it("creates only current ballot, competition rules, proposal, and vote states", () => {
    expect(migration).not.toContain('"activated_at"');
    expect(migration).not.toContain('"launch_start_at"');
    expect(migration).toContain('"rules_frozen_at"');
    expect(migration).toContain('"rules_hash"');
    expect(migration).not.toContain('"finalized_at"');
    expect(migration).toContain("CREATE TYPE \"public\".\"vote_status\" AS ENUM('valid', 'invalid')");
    expect(migration).toContain("CREATE TYPE \"public\".\"proposal_status\" AS ENUM('draft', 'confirmed', 'deleted')");
  });
});
