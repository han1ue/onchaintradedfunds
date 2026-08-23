import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const actions = readFileSync(new URL("./actions.ts", import.meta.url), "utf8");
const submitWizard = readFileSync(new URL("../components/SubmitWizard.tsx", import.meta.url), "utf8");
const assetPicker = readFileSync(new URL("../components/AssetMarketPicker.tsx", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../../drizzle/0000_launch_baseline.sql", import.meta.url),
  "utf8",
);

describe("proposal asset trust boundaries", () => {
  it("persists validator-owned identity for unlisted assets", () => {
    expect(actions).toContain('if (!canonical) throw new Error("ASSET_VALIDATION_FAILED")');
    expect(actions).toContain("symbol: canonical.symbol");
    expect(actions).toContain("name: canonical.name");
    expect(actions).toContain("contractAddress: canonical.address");
    expect(actions).toContain("decimals: canonical.decimals");
    expect(actions).not.toContain("symbol: metadata.symbol");
    expect(actions).not.toContain("name: metadata.name");
  });

  it("keeps verified assets on their registry API source without proposal pricing config", () => {
    expect(actions).toContain("asset.verified ? null : allocation.pricingConfig");
    expect(actions).toContain("!asset.verified && !pricingConfig");
    expect(submitWizard).toContain("asset?.verified || pricingConfigComplete(row.pricingConfig)");
    expect(assetPicker).toContain("asset.verified ? null : preferredActiveMarketPricingConfig(asset.markets)");
  });

  it("offers reused unverified registry assets with their server-returned active pool", () => {
    expect(submitWizard).toContain("<AssetMarketPicker assets={assets}");
    expect(assetPicker).toContain("asset.verified || preferredActiveMarketPricingConfig(asset.markets)");
    expect(assetPicker).toContain("Saved pool ·");
  });

  it("seeds ETH as canonical WETH and rejects non-address catalog values", () => {
    expect(migration).toContain("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
    expect(migration).toContain("eligible_asset_contract_address");
    expect(migration).toContain("^0x[0-9a-fA-F]{40}$");
  });
});
