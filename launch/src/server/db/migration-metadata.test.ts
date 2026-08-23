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
const registrySnapshot = JSON.parse(readFileSync(
  new URL("../../../drizzle/meta/0004_snapshot.json", import.meta.url),
  "utf8",
));
const lifecycleSnapshot = JSON.parse(readFileSync(
  new URL("../../../drizzle/meta/0005_snapshot.json", import.meta.url),
  "utf8",
));
const priceSnapshot = JSON.parse(readFileSync(
  new URL("../../../drizzle/meta/0006_snapshot.json", import.meta.url),
  "utf8",
));
const invariantSnapshot = JSON.parse(readFileSync(
  new URL("../../../drizzle/meta/0007_snapshot.json", import.meta.url),
  "utf8",
));

describe("squashed migration metadata", () => {
  it("tracks the current schema migrations", () => {
    expect(journal.entries).toEqual([
      expect.objectContaining({ idx: 0, tag: "0000_launch_baseline" }),
      expect.objectContaining({ idx: 1, tag: "0001_frozen_competition_rules" }),
      expect.objectContaining({ idx: 2, tag: "0002_start_competition_from_zero" }),
      expect.objectContaining({ idx: 3, tag: "0003_stage_draft_allocations" }),
      expect.objectContaining({ idx: 4, tag: "0004_asset_registry_verification" }),
      expect.objectContaining({ idx: 5, tag: "0005_proposal_lifecycle" }),
      expect.objectContaining({ idx: 6, tag: "0006_price_capture_hardening" }),
      expect.objectContaining({ idx: 7, tag: "0007_launch_data_invariants" }),
    ]);
    expect(snapshot.prevId).toBe("00000000-0000-0000-0000-000000000000");
    expect(backfillSnapshot.prevId).toBe(snapshot.id);
    expect(lifecycleSnapshot.prevId).toBe(registrySnapshot.id);
    expect(priceSnapshot.prevId).toBe(lifecycleSnapshot.id);
    expect(invariantSnapshot.prevId).toBe(priceSnapshot.id);
    expect(lifecycleSnapshot.enums["public.proposal_status"].values).toEqual(["draft", "confirmed", "expired", "deleted"]);
    expect(lifecycleSnapshot.tables["public.proposals"].columns).toHaveProperty("draft_expires_at");
    expect(priceSnapshot.tables["public.price_capture_runs"].columns).toHaveProperty("ambiguous_symbols");
    expect(priceSnapshot.tables["public.asset_price_snapshots"].columns.bid_usd.type).toBe("numeric(38, 18)");
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
