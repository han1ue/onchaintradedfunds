import type { AssetQuality } from "./types";

export function normalizeAssetQuality(value: unknown): AssetQuality {
  return value === "high" ? "high" : "normal";
}

export function deriveOtfQuality(values: readonly unknown[]): AssetQuality {
  return values.length > 0 && values.every((value) => normalizeAssetQuality(value) === "high")
    ? "high"
    : "normal";
}
