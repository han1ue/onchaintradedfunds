import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../../drizzle/0010_remove_legacy_launch_state.sql", import.meta.url),
  "utf8",
);

describe("legacy launch state cleanup migration", () => {
  it("drops every retired workflow table and enum", () => {
    for (const table of [
      "activity_events",
      "finalization_runs",
      "xp_calculation_runs",
      "xp_snapshot_rows",
      "leaderboard_snapshots",
      "leaderboard_rows",
      "launch_queue",
    ]) expect(migration).toContain(`DROP TABLE IF EXISTS "${table}"`);
    expect(migration).toContain('DROP TYPE IF EXISTS "public"."launch_status"');
    expect(migration).toContain('DROP TYPE IF EXISTS "public"."xp_run_status"');
  });

  it("removes legacy columns without dropping active competition, asset, or vote tables", () => {
    expect(migration).toContain('ALTER TABLE "ballots" DROP COLUMN IF EXISTS "activated_at"');
    expect(migration).toContain('ALTER TABLE "competitions" DROP COLUMN IF EXISTS "launch_start_at"');
    expect(migration).toContain('ALTER TABLE "competitions" DROP COLUMN IF EXISTS "rules_frozen_at"');
    expect(migration).toContain('ALTER TABLE "competitions" DROP COLUMN IF EXISTS "finalized_at"');
    expect(migration).toContain('CREATE TYPE "public"."vote_status_new" AS ENUM(\'valid\', \'invalid\')');
    expect(migration).toContain('WHERE "status" = \'posting\'');
    for (const table of ["users", "competitions", "eligible_assets", "proposals", "ballots", "vote_tranches"]) {
      expect(migration).not.toContain(`DROP TABLE IF EXISTS "${table}"`);
    }
  });
});
