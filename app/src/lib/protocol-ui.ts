export type AssetQuality = "high" | "normal";

export function normalizeAssetQuality(value: unknown): AssetQuality {
  return value === "high" ? "high" : "normal";
}

export function deriveOtfQuality(values: readonly unknown[]): AssetQuality {
  return values.length > 0 && values.every((value) => normalizeAssetQuality(value) === "high")
    ? "high"
    : "normal";
}

export function primaryDepositsBlocked(input: {
  sunset: boolean;
  globalPause: boolean;
  localPause: boolean;
  pauseStatusAvailable: boolean;
  retiringAsset: boolean;
}): boolean {
  return input.sunset || input.globalPause || input.localPause || !input.pauseStatusAvailable || input.retiringAsset;
}

export const SUPPORTED_PRICING_SOURCES = Object.freeze([
  "chainlink-direct",
  "chainlink-weth",
  "uniswap-v3",
] as const);
