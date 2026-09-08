import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { registryFixture } from "../test/registry-fixture";
import { fundAssetsVerified } from "./asset-catalog";
const registry = registryFixture.assets.filter(asset=>asset.verified);
import { formatAllocationQuantity, fundAllocationRows, fundAllocationWeights } from "./fund-composition";

const first = registry[0].address as Address;
const second = registry[1].address as Address;
const unknown = "0x0000000000000000000000000000000000000001" as Address;

describe("allocation amount display", () => {
  it("groups large balances and rounds token decimals without losing integer precision", () => {
    expect(formatAllocationQuantity("231195.834930059083634444")).toBe("231,195.83");
    expect(formatAllocationQuantity("287000.999")).toBe("287,001");
    expect(formatAllocationQuantity("123456789123456789")).toBe("123,456,789,123,456,789");
  });

  it("keeps small holdings visible and distinguishes dust from zero", () => {
    expect(formatAllocationQuantity("0.00123456789")).toBe("0.001235");
    expect(formatAllocationQuantity("0.000000000000000001")).toBe("<0.000001");
    expect(formatAllocationQuantity("0")).toBe("0");
  });
});

describe("fund verification", () => {
  it("requires every constituent on the same chain, regardless of address casing", () => {
    expect(fundAssetsVerified(registryFixture, 46630, [first.toLowerCase() as Address, second])).toBe(true);
    expect(fundAssetsVerified(registryFixture, 4663, [first, second])).toBe(false);
    expect(fundAssetsVerified(registryFixture, 46630, [first, unknown])).toBe(false);
    expect(fundAssetsVerified(registryFixture, 46630, [])).toBe(false);
  });
});

describe("onchain basket units", () => {
  const assets = [
    { address: first, symbol: "A", name: "Asset A", decimals: 6 },
    { address: second, symbol: "B", name: "Asset B", decimals: 18 },
  ];

  it("formats exact onchain units using each token’s decimals", () => {
    const rows = fundAllocationRows(assets, [3_000_001n, 6n * 10n ** 18n + 1n]);
    expect(rows.map((row) => row.quantity)).toEqual(["3.000001", "6.000000000000000001"]);
    expect(rows[0]).toMatchObject({ symbol: "A", name: "Asset A", quantityIsRaw: false });
  });

  it("shows exact raw units when token decimals cannot be read", () => {
    const rows = fundAllocationRows([{ address: unknown }], [123456789123456789n]);
    expect(rows[0]).toMatchObject({ quantity: "123456789123456789", quantityIsRaw: true });
  });

  it("preserves zero amounts and rejects invalid quantity arrays", () => {
    expect(fundAllocationRows(assets, [0n, 0n]).map((row) => row.quantity)).toEqual(["0", "0"]);
    expect(() => fundAllocationRows(assets, [1n])).toThrow("Invalid basket quantities");
    expect(() => fundAllocationRows(assets, [-1n, 1n])).toThrow("Invalid basket quantities");
  });
});

describe("current allocation and market-cap comparison", () => {
  const scale = 10n ** 18n;
  const assets = [
    { address: first, decimals: 6, priceUsd: "2", marketCapUsd: "200" },
    { address: second, decimals: 18, priceUsd: "3", marketCapUsd: "600" },
  ];
  const quantities = [3_000_000n, 6n * scale];

  it("compares current USD allocation using mixed token decimals", () => {
    const result = fundAllocationWeights(assets, quantities)!;
    expect(result.rows.map(row => row.percentageUnits)).toEqual([25n * scale, 75n * scale]);
    expect(result.rows.map(row => row.marketCapPercentageUnits)).toEqual([25n * scale, 75n * scale]);
    expect(result.matchesMarketCap).toBe(true);
    expect(fundAllocationWeights(assets, [6_000_000n, 6n * scale])?.matchesMarketCap).toBe(false);
  });

  it("preserves a match after price changes, but detects relative supply changes", () => {
    const changedPrice = [{ ...assets[0], priceUsd: "4", marketCapUsd: "400" }, assets[1]];
    expect(fundAllocationWeights(changedPrice, quantities)?.matchesMarketCap).toBe(true);
    expect(fundAllocationWeights([{ ...changedPrice[0], marketCapUsd: "800" }, assets[1]], quantities)?.matchesMarketCap).toBe(false);
  });

  it("withholds missing data without treating it as a mismatch", () => {
    const missingCap = fundAllocationWeights([{ ...assets[0], marketCapUsd: "" }, assets[1]], quantities)!;
    expect(missingCap.matchesMarketCap).toBeUndefined();
    expect(missingCap.rows[0].percentageUnits).toBe(25n * scale);
    expect(missingCap.rows.every(row => row.marketCapPercentageUnits === undefined)).toBe(true);
    expect(fundAllocationWeights([{ ...assets[0], priceUsd: "" }, assets[1]], quantities)).toBeUndefined();
    expect(fundAllocationWeights(assets, [0n, 0n])).toBeUndefined();
    expect(fundAllocationWeights(assets, [1n])).toBeUndefined();
  });

  it("allows only the stated 0.01 percentage-point tolerance", () => {
    const equal = assets.map(asset => ({ ...asset, decimals: 0, priceUsd: "1", marketCapUsd: "1" }));
    expect(fundAllocationWeights(equal, [5001n, 4999n])?.matchesMarketCap).toBe(true);
    expect(fundAllocationWeights(equal, [5002n, 4998n])?.matchesMarketCap).toBe(false);
  });
});
