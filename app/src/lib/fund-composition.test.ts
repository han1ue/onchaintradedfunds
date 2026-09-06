import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import registry from "../config/verified_assets.json";
import { fundAllocationRows, fundAssetsVerified } from "./fund-composition";

const first = registry[0].tokenAddress as Address;
const second = registry[1].tokenAddress as Address;
const unknown = "0x0000000000000000000000000000000000000001" as Address;

describe("fund verification", () => {
  it("requires every constituent on the same chain, regardless of address casing", () => {
    expect(fundAssetsVerified(46630, [first.toLowerCase() as Address, second])).toBe(true);
    expect(fundAssetsVerified(4663, [first, second])).toBe(false);
    expect(fundAssetsVerified(46630, [first, unknown])).toBe(false);
    expect(fundAssetsVerified(46630, [])).toBe(false);
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
