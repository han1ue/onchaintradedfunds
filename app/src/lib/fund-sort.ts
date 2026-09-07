import type { FactoryVaultSummary } from "./vault-summary";

export type FundSortKey = "nav" | "apy" | "assets";
export type FundSort = `${FundSortKey}-${"asc" | "desc"}`;

export function sortFunds(
  funds: readonly FactoryVaultSummary[],
  sort: FundSort,
  value: (fund: FactoryVaultSummary, key: FundSortKey) => number | undefined,
): FactoryVaultSummary[] {
  const [key, direction] = sort.split("-") as [FundSortKey, "asc" | "desc"];
  return [...funds].sort((left, right) => {
    const a = value(left, key);
    const b = value(right, key);
    const aMissing = a === undefined || !Number.isFinite(a);
    const bMissing = b === undefined || !Number.isFinite(b);
    if (aMissing || bMissing) return aMissing === bMissing ? 0 : aMissing ? 1 : -1;
    return direction === "asc" ? a! - b! : b! - a!;
  });
}
