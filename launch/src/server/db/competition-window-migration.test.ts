import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../../drizzle/0002_start_competition_from_zero.sql", import.meta.url),
  "utf8",
);

describe("competition window reset migration", () => {
  it("starts at migration time and preserves the full 37-day competition", () => {
    expect(migration).toContain('statement_timestamp() AS "starts_at"');
    expect(migration).toContain('"starts_at" = "competition_clock"."starts_at"');
    expect(migration).toContain("interval '37 days'");
  });

  it("does not delete existing participation records", () => {
    expect(migration).not.toMatch(/\b(?:DELETE|TRUNCATE|DROP)\b/i);
  });
});
