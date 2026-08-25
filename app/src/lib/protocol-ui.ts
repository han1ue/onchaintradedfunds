export type WeightBandLimits = {
  minCompletionDeviationBps: number;
  maxCompletionDeviationBps: number;
  minChallengeDeviationGapBps: number;
  maxChallengeDeviationBps: number;
};

export const DEFAULT_COMPLETION_DEVIATION_BPS = 100;
export const DEFAULT_CHALLENGE_DEVIATION_BPS = 250;
export const FRONTEND_MAX_TRACKED_ASSETS = 20;

export function trackedAssetUnionCount(
  currentAssets: readonly string[],
  proposedAssets: readonly string[],
): number {
  return new Set(
    [...currentAssets, ...proposedAssets].map((asset) => asset.trim().toLowerCase()),
  ).size;
}

export function percentToBps(value: string | number): number {
  const percentage = Number(value || 0);
  return Number.isFinite(percentage) ? Math.round(percentage * 100) : 0;
}

export function weightBandValidationError(
  completionDeviationBps: number,
  challengeDeviationBps: number,
  limits: WeightBandLimits,
): string | undefined {
  if (
    completionDeviationBps < limits.minCompletionDeviationBps
    || completionDeviationBps > limits.maxCompletionDeviationBps
  ) {
    return `Completion must be between ${limits.minCompletionDeviationBps / 100}% and ${limits.maxCompletionDeviationBps / 100}%.`;
  }
  const minimumChallenge = completionDeviationBps + limits.minChallengeDeviationGapBps;
  if (
    challengeDeviationBps < minimumChallenge
    || challengeDeviationBps > limits.maxChallengeDeviationBps
  ) {
    return `Challenge must be at least ${minimumChallenge / 100}% for this completion band and no more than ${limits.maxChallengeDeviationBps / 100}%.`;
  }
  return undefined;
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

export function chainlinkDescriptionMatchesPair(
  description: string,
  baseSymbol: string,
  quoteSymbol: string,
): boolean {
  const tokens = new Set(description.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean));
  const normalizedBase = baseSymbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const normalizedQuote = quoteSymbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const quoteAliases = normalizedQuote === "WETH"
    ? ["WETH", "ETH"]
    : normalizedQuote === "USDG"
      ? ["USDG", "USD"]
      : [normalizedQuote];
  return Boolean(normalizedBase) && tokens.has(normalizedBase) && quoteAliases.some((token) => tokens.has(token));
}

export const SUPPORTED_PRICING_SOURCES = Object.freeze([
  "chainlink-robinhood",
  "chainlink",
  "chainlink-composed",
  "uniswap-v3",
] as const);
