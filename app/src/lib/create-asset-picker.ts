import { getAddress, isAddress, type Address } from "viem";
import type { CreationAssetData } from "./creation-model";

export type OnchainAssetMetadata = {
  name: string;
  symbol: string;
  decimals: number;
};

export function defaultCreationAssetSelection(
  assets: readonly CreationAssetData[],
  random: () => number = Math.random,
): CreationAssetData[] {
  const protocolOtf = assets.find((asset) => asset.verified && asset.symbol === "OTF");
  if (!protocolOtf) return assets.filter((asset) => asset.verified).slice(0, 2);
  const otherVerifiedAssets = assets.filter((asset) => (
    asset.verified && asset.address.toLowerCase() !== protocolOtf.address.toLowerCase()
  ));
  if (!otherVerifiedAssets.length) return [protocolOtf];
  const randomIndex = Math.min(
    otherVerifiedAssets.length - 1,
    Math.max(0, Math.floor(random() * otherVerifiedAssets.length)),
  );
  return [protocolOtf, otherVerifiedAssets[randomIndex]];
}

export function filterCreationAssetOptions(
  assets: readonly CreationAssetData[],
  selectedAddresses: readonly Address[],
  currentAddress: Address,
  query: string,
): CreationAssetData[] {
  const normalizedQuery = query.trim().toLowerCase();
  return assets.filter((asset) => {
    const alreadySelected = selectedAddresses.some((address) => (
      address.toLowerCase() === asset.address.toLowerCase()
      && address.toLowerCase() !== currentAddress.toLowerCase()
    ));
    return !alreadySelected && (
      !normalizedQuery
      || asset.name.toLowerCase().includes(normalizedQuery)
      || asset.symbol.toLowerCase().includes(normalizedQuery)
      || asset.address.toLowerCase().includes(normalizedQuery)
    );
  });
}

export function manualCreationAsset(
  address: string,
  metadata: OnchainAssetMetadata | undefined,
  valuationAssets: readonly CreationAssetData[],
): CreationAssetData | undefined {
  if (!isAddress(address) || !metadata || metadata.decimals !== 18) return undefined;
  const valuation = valuationAssets.find((asset) => (
    asset.address.toLowerCase() === address.toLowerCase()
    || asset.symbol.toLowerCase() === metadata.symbol.toLowerCase()
  ));
  if (!valuation) return undefined;
  return {
    ...valuation,
    address: getAddress(address),
    name: metadata.name || valuation.name,
    symbol: metadata.symbol || valuation.symbol,
    decimals: metadata.decimals,
    verified: valuation.address.toLowerCase() === address.toLowerCase() && valuation.verified,
  };
}
