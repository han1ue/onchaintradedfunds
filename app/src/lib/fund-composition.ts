import { formatUnits, type Address } from "viem";
import { parseFixedDecimal, TOTAL_PERCENT_UNITS } from "./creation-model";


type AllocationAsset = {
  address: Address;
  symbol?: string;
  name?: string;
  decimals?: number;
};

export type FundAllocationRow = {
  address: Address;
  symbol: string;
  name: string;
  quantity: string;
  quantityIsRaw: boolean;
};

export function formatAllocationQuantity(quantity: string): string {
  const [whole, fraction = ""] = quantity.split(".");
  const digits = BigInt(whole) === 0n ? 6 : 2;
  const scale = 10n ** BigInt(digits);
  const units = BigInt(whole) * scale + BigInt(fraction.slice(0, digits).padEnd(digits, "0"));
  if (units === 0n && /[1-9]/u.test(fraction)) return "<0.000001";
  const rounded = units + (Number(fraction[digits] ?? "0") >= 5 ? 1n : 0n);
  const decimals = (rounded % scale).toString().padStart(digits, "0").replace(/0+$/u, "");
  const integer = (rounded / scale).toLocaleString("en-US");
  return decimals ? `${integer}.${decimals}` : integer;
}

export function fundAllocationRows(assets: readonly AllocationAsset[], quantities: readonly bigint[]): FundAllocationRow[] {
  if (assets.length !== quantities.length || quantities.some((quantity) => quantity < 0n)) {
    throw new Error("Invalid basket quantities.");
  }
  const decimalsFor = (asset: AllocationAsset) => Number.isInteger(asset.decimals) && asset.decimals! >= 0 && asset.decimals! <= 255 ? asset.decimals : undefined;
  return assets.map((asset, index) => {
    const decimals = decimalsFor(asset);
    return {
      address: asset.address,
      symbol: asset.symbol || "Token",
      name: asset.name || "",
      quantity: decimals === undefined ? quantities[index].toString() : formatUnits(quantities[index], decimals),
      quantityIsRaw: decimals === undefined,
    };
  });
}

export type FundAllocationWeights = {
  rows: { address: Address; percentageUnits: bigint; marketCapPercentageUnits?: bigint }[];
  matchesMarketCap?: boolean;
};

// Allow one basis point of allocation difference for token and price rounding.
export const MARKET_CAP_MATCH_TOLERANCE = 10n ** 16n;

export function fundAllocationWeights(
  assets: readonly { address: Address; decimals: number; priceUsd: string; marketCapUsd: string }[],
  quantities: readonly bigint[],
): FundAllocationWeights | undefined {
  if (!assets.length || assets.length !== quantities.length || quantities.some((quantity) => quantity < 0n)) return undefined;
  const values = assets.map((asset, index) => {
    const price = parseFixedDecimal(asset.priceUsd, 18);
    if (!price || !Number.isInteger(asset.decimals) || asset.decimals < 0 || asset.decimals > 255) return undefined;
    return quantities[index] * price / 10n ** BigInt(asset.decimals);
  });
  if (values.some((value) => value === undefined)) return undefined;
  const totalValue = values.reduce<bigint>((total, value) => total + value!, 0n);
  if (totalValue === 0n) return undefined;
  const caps = assets.map((asset) => parseFixedDecimal(asset.marketCapUsd, 18));
  const totalCap = caps.every((cap) => cap !== undefined && cap > 0n)
    ? caps.reduce<bigint>((total, cap) => total + cap!, 0n)
    : undefined;
  const rows = assets.map((asset, index) => ({
    address: asset.address,
    percentageUnits: values[index]! * TOTAL_PERCENT_UNITS / totalValue,
    marketCapPercentageUnits: totalCap === undefined ? undefined : caps[index]! * TOTAL_PERCENT_UNITS / totalCap,
  }));
  return {
    rows,
    matchesMarketCap: totalCap === undefined ? undefined : rows.every((row) => {
      const difference = row.percentageUnits - row.marketCapPercentageUnits!;
      return difference >= -MARKET_CAP_MATCH_TOLERANCE && difference <= MARKET_CAP_MATCH_TOLERANCE;
    }),
  };
}
