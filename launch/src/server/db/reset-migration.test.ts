import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../../drizzle/0000_launch_baseline.sql", import.meta.url),
  "utf8",
);
const assetRegistryMigration = readFileSync(
  new URL("../../../drizzle/0004_asset_registry_verification.sql", import.meta.url),
  "utf8",
);

describe("launch baseline migration", () => {
  it("creates the current schema without destructive reset statements", () => {
    for (const table of ["users", "competitions", "eligible_assets", "proposals", "ballots", "vote_tranches"]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
    }
    expect(migration).not.toContain("TRUNCATE TABLE");
    expect(migration).not.toContain("DROP TABLE");
  });

  it("seeds one competition and the canonical API-priced asset catalog", () => {
    expect(migration).toContain('INSERT INTO "competitions"');
    expect(migration).toContain('INSERT INTO "eligible_assets"');
    expect(migration).toContain("('AAPL', 'Apple'");
    expect(migration).toContain("('ETH', 'Ethereum'");
    expect(migration).toContain("('USAR', 'USA Rare Earth'");
    expect(migration.match(/'high'\)/g)).toHaveLength(46);
    expect(migration).toContain("'coinbase-eth-usd-bid', 'high'");
    expect(migration).toContain('SET "chain_id" = 4663');
  });
});

describe("asset registry migration", () => {
  it("moves verification addresses into their own table and removes registry quality", () => {
    expect(assetRegistryMigration).toContain('CREATE TABLE "verified_assets"');
    expect(assetRegistryMigration).toContain('RENAME TO "asset_registry"');
    expect(assetRegistryMigration).toContain('SELECT "contract_address" FROM "asset_registry" WHERE "quality" = \'high\'');
    expect(assetRegistryMigration).toContain('DROP COLUMN "quality"');
  });
});
