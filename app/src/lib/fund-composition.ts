import { formatUnits, type Address } from "viem";
import verifiedAssets from "../config/verified_assets.json";

export function fundAssetsVerified(chainId: number, assets: readonly Address[]): boolean {
  const verified = new Set(verifiedAssets.filter((asset) => asset.chainId === chainId).map((asset) => asset.tokenAddress.toLowerCase()));
  return assets.length > 0 && assets.every((asset) => verified.has(asset.toLowerCase()));
}

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
