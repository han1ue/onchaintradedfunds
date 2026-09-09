import { getAddress, isAddress, type Address } from "viem";
import type { CreationAssetData } from "./creation-model";

export type OnchainAssetMetadata = {
  name: string;
  symbol: string;
  decimals: number;
};

export function creationAssetSnapshot(value: unknown): { assets: CreationAssetData[]; collectedAt?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("ASSET_DATA_UNAVAILABLE");
  const payload = value as Record<string, unknown>;
  if (!Array.isArray(payload.data)) throw new Error("ASSET_DATA_UNAVAILABLE");
  const assets = payload.data.flatMap((value) => {
    const asset = creationAsset(value);
    return asset ? [asset] : [];
  });
  if (!assets.length) return { assets };
  if (typeof payload.collectedAt !== "string" || !Number.isFinite(Date.parse(payload.collectedAt))) {
    throw new Error("ASSET_SNAPSHOT_UNAVAILABLE");
  }
  return { assets, collectedAt: new Date(payload.collectedAt).toISOString() };
}

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

function creationAsset(value: unknown): CreationAssetData | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const asset = value as Record<string, unknown>;
  if (
    typeof asset.address !== "string" || !isAddress(asset.address)
    || typeof asset.symbol !== "string" || typeof asset.name !== "string"
    || typeof asset.priceUsd !== "string" || typeof asset.marketCapUsd !== "string"
    || !Number.isInteger(asset.decimals)
  ) return undefined;
  return {
    address: getAddress(asset.address),
    symbol: asset.symbol,
    name: asset.name,
    decimals: Number(asset.decimals),
    priceUsd: asset.priceUsd,
    marketCapUsd: asset.marketCapUsd,
    priceUpdatedAt: typeof asset.priceUpdatedAt === "string" ? asset.priceUpdatedAt : undefined,
    verified: asset.verified === true,
  };
}
