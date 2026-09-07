import { describe, expect, it } from "vitest";
import { sortFunds, type FundSortKey } from "./fund-sort";
import type { FactoryVaultSummary } from "./vault-summary";

describe("fund sorting", () => {
  const funds = [
    { name: "Small", assetCount: 2 },
    { name: "Large", assetCount: 12 },
    { name: "Unknown", assetCount: 3 },
  ] as FactoryVaultSummary[];
  const value = (fund: FactoryVaultSummary, key: FundSortKey) => key === "assets" ? fund.assetCount
    : fund.name === "Unknown" ? undefined : fund.name === "Small" ? 9 : 100;
  it("sorts numbers rather than formatted strings in either direction and retains unknowns last", () => {
    for (const key of ["nav", "apy"] as const) {
      expect(sortFunds(funds, `${key}-asc`, value).map((fund) => fund.name)).toEqual(["Small", "Large", "Unknown"]);
      expect(sortFunds(funds, `${key}-desc`, value).map((fund) => fund.name)).toEqual(["Large", "Small", "Unknown"]);
    }
    expect(sortFunds(funds, "assets-desc", value).map((fund) => fund.assetCount)).toEqual([12, 3, 2]);
    expect(funds[0].name).toBe("Small");
  });
  it("keeps stable ordering for equal or unavailable values", () => {
    expect(sortFunds(funds, "nav-desc", () => 0)).toEqual(funds);
    expect(sortFunds(funds, "nav-asc", () => NaN)).toEqual(funds);
  });
});
