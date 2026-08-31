import { getAddress, isAddress, type Address } from "viem";
import {
  PERCENT_DECIMALS,
  TOTAL_PERCENT_UNITS,
  formatFixedDecimal,
  formatPercentageDisplay,
  normalizeMarketCapPercentageUnits,
} from "./creation-model";

export enum WeightingMethod {
  MarketCapWeighted = "MARKET_CAP_WEIGHTED",
  ModifiedMarketCapWeighted = "MODIFIED_MARKET_CAP_WEIGHTED",
}

export const MARKET_CAP_WEIGHTED_LABEL = "Market-cap weighted";
export const MODIFIED_MARKET_CAP_WEIGHTED_LABEL = "Modified market-cap weighted";
export const MULTIPLIER_DECIMALS = 18;
export const MULTIPLIER_SCALE = 10n ** BigInt(MULTIPLIER_DECIMALS);

export type WeightingMethodLabel =
  | typeof MARKET_CAP_WEIGHTED_LABEL
  | typeof MODIFIED_MARKET_CAP_WEIGHTED_LABEL;

export type CreationMetadataAsset = {
  address: Address;
  symbol: string;
  name: string;
  marketCapUsd: string;
  finalPercentageUnits: bigint;
};

export type CreationMetadataConstituent = {
  address: Address;
  symbol: string;
  name: string;
  marketCapDefaultPercentageUnits: string;
  finalPercentageUnits: string;
  multiplierUnits: string;
};

export type OtfCreationMetadataDraft = {
  weightingMethod: WeightingMethod;
  marketCapSnapshotAt: string;
  constituents: CreationMetadataConstituent[];
};

export type OtfCreationMetadata = OtfCreationMetadataDraft & {
  chainId: number;
  vaultAddress: Address;
};

export type StorageReader = Pick<Storage, "getItem">;
export type StorageWriter = Pick<Storage, "setItem">;

const STORAGE_PREFIX = "otf:creation-metadata";

function roundedFixedDecimal(value: bigint, decimals: number, displayedDecimals: number): string {
  if (displayedDecimals >= decimals) return formatFixedDecimal(value, decimals);
  const divisor = 10n ** BigInt(decimals - displayedDecimals);
  return formatFixedDecimal((value + divisor / 2n) / divisor, displayedDecimals);
}

function groupedWhole(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
}

export function weightingMethodLabel(method: WeightingMethod): WeightingMethodLabel {
  return method === WeightingMethod.MarketCapWeighted
    ? MARKET_CAP_WEIGHTED_LABEL
    : MODIFIED_MARKET_CAP_WEIGHTED_LABEL;
}

export function classifyWeightingMethod(
  finalPercentageUnits: readonly bigint[],
  marketCapDefaultPercentageUnits: readonly bigint[],
): WeightingMethod {
  if (finalPercentageUnits.length !== marketCapDefaultPercentageUnits.length) {
    throw new Error("Final and market-cap weight counts must match.");
  }
  return finalPercentageUnits.every((value, index) => value === marketCapDefaultPercentageUnits[index])
    ? WeightingMethod.MarketCapWeighted
    : WeightingMethod.ModifiedMarketCapWeighted;
}

export function marketCapMultiplierUnits(finalPercentageUnits: bigint, defaultPercentageUnits: bigint): bigint {
  if (finalPercentageUnits < 0n) throw new Error("Final percentage cannot be negative.");
  if (defaultPercentageUnits <= 0n) throw new Error("Market-cap default percentage must be positive.");
  return finalPercentageUnits * MULTIPLIER_SCALE / defaultPercentageUnits;
}

export function formatMarketCapMultiplier(multiplierUnits: bigint): string {
  if (multiplierUnits < 0n) throw new Error("Market-cap multiplier cannot be negative.");
  if (multiplierUnits === MULTIPLIER_SCALE) return "1.00×";
  if (multiplierUnits === 0n) return "0.00×";
  const distanceFromOne = multiplierUnits > MULTIPLIER_SCALE
    ? multiplierUnits - MULTIPLIER_SCALE
    : MULTIPLIER_SCALE - multiplierUnits;
  // Avoid formatting a real tilt as exactly 1× after decimal rounding.
  if (distanceFromOne <= 5n * 10n ** 15n) {
    return `${formatFixedDecimal(multiplierUnits, MULTIPLIER_DECIMALS)}×`;
  }
  if (multiplierUnits < 10n ** 10n) return "<0.00000001×";
  if (multiplierUnits < 10n ** 16n) {
    return `${roundedFixedDecimal(multiplierUnits, MULTIPLIER_DECIMALS, 10)}×`;
  }
  if (multiplierUnits < MULTIPLIER_SCALE) {
    return `${roundedFixedDecimal(multiplierUnits, MULTIPLIER_DECIMALS, 4)}×`;
  }
  if (multiplierUnits < 1_000n * MULTIPLIER_SCALE) {
    return `${roundedFixedDecimal(multiplierUnits, MULTIPLIER_DECIMALS, 2)}×`;
  }
  if (multiplierUnits < 1_000_000n * MULTIPLIER_SCALE) {
    return `${roundedFixedDecimal(multiplierUnits, MULTIPLIER_DECIMALS, 1)}×`;
  }
  return `${groupedWhole(roundedFixedDecimal(multiplierUnits, MULTIPLIER_DECIMALS, 0))}×`;
}

export function multiplierPosition(multiplierUnits: bigint): "unchanged" | "overweight" | "underweight" {
  if (multiplierUnits === MULTIPLIER_SCALE) return "unchanged";
  return multiplierUnits > MULTIPLIER_SCALE ? "overweight" : "underweight";
}

export function buildCreationMetadataDraft(input: {
  marketCapSnapshotAt: string;
  assets: readonly CreationMetadataAsset[];
}): OtfCreationMetadataDraft {
  if (!input.assets.length || input.assets.length > 20) throw new Error("Creation metadata needs 1–20 assets.");
  if (!Number.isFinite(Date.parse(input.marketCapSnapshotAt))) {
    throw new Error("Market-cap snapshot timestamp is invalid.");
  }
  const defaults = normalizeMarketCapPercentageUnits(input.assets.map((asset) => asset.marketCapUsd));
  const finals = input.assets.map((asset) => asset.finalPercentageUnits);
  if (finals.some((value) => value <= 0n)) throw new Error("Final percentages must be positive.");
  if (finals.reduce((sum, value) => sum + value, 0n) !== TOTAL_PERCENT_UNITS) {
    throw new Error("Final percentages must total exactly 100%.");
  }
  return {
    weightingMethod: classifyWeightingMethod(finals, defaults),
    marketCapSnapshotAt: new Date(input.marketCapSnapshotAt).toISOString(),
    constituents: input.assets.map((asset, index) => ({
      address: getAddress(asset.address),
      symbol: asset.symbol,
      name: asset.name,
      marketCapDefaultPercentageUnits: defaults[index].toString(),
      finalPercentageUnits: finals[index].toString(),
      multiplierUnits: marketCapMultiplierUnits(finals[index], defaults[index]).toString(),
    })),
  };
}

export function creationMetadataStorageKey(chainId: number, vaultAddress: Address): string {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("Chain ID is invalid.");
  return `${STORAGE_PREFIX}:${chainId}:${vaultAddress.toLowerCase()}`;
}

export function persistCreationMetadata(
  storage: StorageWriter,
  chainId: number,
  vaultAddress: Address,
  draft: OtfCreationMetadataDraft,
): OtfCreationMetadata {
  const metadata = { ...draft, chainId, vaultAddress: getAddress(vaultAddress) } satisfies OtfCreationMetadata;
  storage.setItem(creationMetadataStorageKey(chainId, metadata.vaultAddress), JSON.stringify(metadata));
  return metadata;
}

function positiveIntegerString(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d*$/u.test(value);
}

function nonnegativeIntegerString(value: unknown): value is string {
  return typeof value === "string" && /^\d+$/u.test(value);
}

function parseCreationMetadata(value: unknown, chainId: number, vaultAddress: Address): OtfCreationMetadata | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    record.chainId !== chainId
    || Object.hasOwn(record, "thesis")
    || typeof record.vaultAddress !== "string" || !isAddress(record.vaultAddress)
    || getAddress(record.vaultAddress) !== getAddress(vaultAddress)
    || !Object.values(WeightingMethod).includes(record.weightingMethod as WeightingMethod)
    || typeof record.marketCapSnapshotAt !== "string"
    || !Number.isFinite(Date.parse(record.marketCapSnapshotAt))
    || !Array.isArray(record.constituents)
    || record.constituents.length === 0 || record.constituents.length > 20
  ) return undefined;

  const constituents = record.constituents.flatMap((value): CreationMetadataConstituent[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    if (
      typeof row.address !== "string" || !isAddress(row.address)
      || typeof row.symbol !== "string" || !row.symbol
      || typeof row.name !== "string" || !row.name
      || !positiveIntegerString(row.marketCapDefaultPercentageUnits)
      || !positiveIntegerString(row.finalPercentageUnits)
      || !nonnegativeIntegerString(row.multiplierUnits)
    ) return [];
    return [{
      address: getAddress(row.address),
      symbol: row.symbol.slice(0, 16),
      name: row.name.slice(0, 80),
      marketCapDefaultPercentageUnits: row.marketCapDefaultPercentageUnits,
      finalPercentageUnits: row.finalPercentageUnits,
      multiplierUnits: row.multiplierUnits,
    }];
  });
  if (constituents.length !== record.constituents.length) return undefined;
  const defaults = constituents.map((row) => BigInt(row.marketCapDefaultPercentageUnits));
  const finals = constituents.map((row) => BigInt(row.finalPercentageUnits));
  if (
    defaults.reduce((sum, value) => sum + value, 0n) !== TOTAL_PERCENT_UNITS
    || finals.reduce((sum, value) => sum + value, 0n) !== TOTAL_PERCENT_UNITS
    || constituents.some((row, index) => (
      BigInt(row.multiplierUnits) !== marketCapMultiplierUnits(finals[index], defaults[index])
    ))
  ) return undefined;
  const weightingMethod = record.weightingMethod as WeightingMethod;
  if (classifyWeightingMethod(finals, defaults) !== weightingMethod) return undefined;
  return {
    chainId,
    vaultAddress: getAddress(vaultAddress),
    weightingMethod,
    marketCapSnapshotAt: new Date(record.marketCapSnapshotAt).toISOString(),
    constituents,
  };
}

export function loadCreationMetadata(
  storage: StorageReader,
  chainId: number,
  vaultAddress: Address,
): OtfCreationMetadata | undefined {
  try {
    const stored = storage.getItem(creationMetadataStorageKey(chainId, vaultAddress));
    return stored ? parseCreationMetadata(JSON.parse(stored), chainId, vaultAddress) : undefined;
  } catch {
    return undefined;
  }
}

export function formatStoredPercentage(units: string): string {
  return formatPercentageDisplay(BigInt(units));
}

export function formatStoredPercentageExact(units: string): string {
  return `${formatFixedDecimal(BigInt(units), PERCENT_DECIMALS)}%`;
}

export function formatMarketCapSnapshotTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}
