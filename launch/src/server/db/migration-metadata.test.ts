import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const journal = JSON.parse(readFileSync(
  new URL("../../../drizzle/meta/_journal.json", import.meta.url),
  "utf8",
));
const snapshot = JSON.parse(readFileSync(
  new URL("../../../drizzle/meta/0000_snapshot.json", import.meta.url),
  "utf8",
));
const backfillSnapshot = JSON.parse(readFileSync(
  new URL("../../../drizzle/meta/0001_snapshot.json", import.meta.url),
  "utf8",
));

describe("squashed migration metadata", () => {
  it("tracks the current baseline, rules backfill, and competition clock reset", () => {
    expect(journal.entries).toEqual([
      expect.objectContaining({ idx: 0, tag: "0000_launch_baseline" }),
      expect.objectContaining({ idx: 1, tag: "0001_frozen_competition_rules" }),
      expect.objectContaining({ idx: 2, tag: "0002_start_competition_from_zero" }),
      expect.objectContaining({ idx: 3, tag: "0003_stage_draft_allocations" }),
    ]);
    expect(snapshot.prevId).toBe("00000000-0000-0000-0000-000000000000");
    expect(backfillSnapshot.prevId).toBe(snapshot.id);
    expect(Object.keys(snapshot.tables)).toHaveLength(20);
    expect(Object.keys(backfillSnapshot.tables)).toHaveLength(20);
  });

  it("does not describe retired tables or columns", () => {
    for (const table of [
      "activity_events",
      "finalization_runs",
      "xp_calculation_runs",
      "xp_snapshot_rows",
      "leaderboard_snapshots",
      "leaderboard_rows",
      "launch_queue",
    ]) expect(snapshot.tables).not.toHaveProperty(`public.${table}`);

    expect(snapshot.tables["public.ballots"].columns).not.toHaveProperty("evidence_id");
    expect(snapshot.tables["public.ballots"].columns).not.toHaveProperty("activated_at");
    expect(snapshot.tables["public.competitions"].columns).toHaveProperty("rules");
    expect(snapshot.tables["public.competitions"].columns).toHaveProperty("rules_hash");
    expect(snapshot.tables["public.competitions"].columns).toHaveProperty("rules_frozen_at");
    expect(snapshot.tables["public.competitions"].columns).not.toHaveProperty("launch_start_at");
    expect(snapshot.tables["public.competitions"].columns).not.toHaveProperty("finalized_at");
  });
});
