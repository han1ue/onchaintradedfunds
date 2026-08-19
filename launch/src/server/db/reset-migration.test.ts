import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../../drizzle/0008_reset_participation_data.sql", import.meta.url),
  "utf8",
);
const truncateStatement = migration.slice(migration.indexOf("TRUNCATE TABLE"));

describe("launch data reset migration", () => {
  it("preserves users, competition configuration, and all asset data", () => {
    const preservedTables = [
      "users",
      "competitions",
      "eligible_assets",
      "asset_pricing_configs",
      "asset_markets",
      "asset_eligibility_snapshots",
      "asset_market_requests",
      "price_capture_runs",
      "asset_price_snapshots",
    ];
    for (const table of preservedTables) expect(truncateStatement).not.toContain(`"${table}"`);
    expect(truncateStatement.match(/^\s+"[a-z_]+",?$/gm)).toHaveLength(18);
  });

  it("also removes the obsolete ballot evidence column", () => {
    expect(migration).toContain('ALTER TABLE "ballots" DROP COLUMN IF EXISTS "evidence_id"');
  });

  it("repairs a competition and the canonical asset catalog if the old reset removed them", () => {
    expect(migration).toContain('WHERE NOT EXISTS (SELECT 1 FROM "competitions")');
    expect(migration).toContain('INSERT INTO "eligible_assets"');
    expect(migration).toContain("('AAPL', 'Apple'");
    expect(migration).toContain("('ETH', 'Ethereum'");
    expect(migration).toContain("('USAR', 'USA Rare Earth'");
    expect(migration.match(/'high'\)/g)).toHaveLength(46);
    expect(migration).toContain("ON CONFLICT DO NOTHING");
  });
});
