import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../../../drizzle/0007_reset_launch_data.sql", import.meta.url), "utf8");
const truncateStatement = migration.slice(migration.indexOf("TRUNCATE TABLE"));

describe("launch data reset migration", () => {
  it("preserves users while resetting every other application table", () => {
    expect(truncateStatement).not.toContain('"users"');
    expect(truncateStatement.match(/^\s+"[a-z_]+",?$/gm)).toHaveLength(26);
  });

  it("also removes the obsolete ballot evidence column", () => {
    expect(migration).toContain('ALTER TABLE "ballots" DROP COLUMN IF EXISTS "evidence_id"');
  });
});
