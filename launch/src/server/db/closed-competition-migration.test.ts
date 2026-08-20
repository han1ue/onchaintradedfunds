import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../../drizzle/0011_freeze_closed_competition.sql", import.meta.url),
  "utf8",
);

describe("closed competition input freeze migration", () => {
  it("freezes every table that can change ranking inputs", () => {
    for (const table of ["proposals", "proposal_assets", "ballots", "ballot_allocations", "vote_tranches"]) {
      expect(migration).toContain(`ON "${table}"`);
    }
  });

  it("uses database time and also freezes terminal phases", () => {
    expect(migration).toContain('"ends_at" <= statement_timestamp()');
    expect(migration).toContain("'auditing', 'final', 'cancelled'");
    expect(migration).toContain("RAISE EXCEPTION 'COMPETITION_NOT_OPEN'");
  });
});
