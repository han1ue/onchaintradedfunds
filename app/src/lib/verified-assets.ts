import verifiedAssetsData from "../config/verified_assets.json";

export type ApprovedPricingConfig =
  | {
      source: "chainlink" | "chainlink-robinhood";
      feedAddress: string;
      maxStaleness: number;
    }
  | {
      source: "chainlink-composed";
      quoteToken: string;
      assetQuoteFeedAddress: string;
      assetQuoteMaxStaleness: number;
      quoteUsdFeedAddress: string;
      quoteUsdMaxStaleness: number;
    }
  | {
      source: "uniswap-v3";
      quoteToken: string;
      poolAddress: string;
      maxStaleness: number;
      quoteUsdFeedAddress: string;
      quoteUsdMaxStaleness: number;
    };

export type NumericPricingConfig = {
  source: 0 | 1 | 2 | 3;
  quoteToken: string;
  primarySource: string;
  secondarySource: string;
  primaryMaxStaleness: number;
  secondaryMaxStaleness: number;
};

export type PricingVerification = {
  verified: boolean;
  availabilityWarning: boolean;
};

export type VerifiedAsset = {
  chainId: number;
  tokenAddress: string;
  approvedPricingConfigs: ApprovedPricingConfig[];
};

export const verifiedAssets = verifiedAssetsData as VerifiedAsset[];
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const sameAddress = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

export function verifiedAssetFor(chainId: number, tokenAddress: string): VerifiedAsset | undefined {
  return verifiedAssets.find((asset) =>
    asset.chainId === chainId && sameAddress(asset.tokenAddress, tokenAddress),
  );
}

export function toNumericPricingConfig(config: ApprovedPricingConfig): NumericPricingConfig {
  if (config.source === "chainlink" || config.source === "chainlink-robinhood") {
    return {
      source: config.source === "chainlink-robinhood" ? 3 : 0,
      quoteToken: ZERO_ADDRESS,
      primarySource: config.feedAddress,
      secondarySource: ZERO_ADDRESS,
      primaryMaxStaleness: config.maxStaleness,
      secondaryMaxStaleness: 0,
    };
  }
  if (config.source === "chainlink-composed") {
    return {
      source: 1,
      quoteToken: config.quoteToken,
      primarySource: config.assetQuoteFeedAddress,
      secondarySource: config.quoteUsdFeedAddress,
      primaryMaxStaleness: config.assetQuoteMaxStaleness,
      secondaryMaxStaleness: config.quoteUsdMaxStaleness,
    };
  }
  if (config.source !== "uniswap-v3") {
    throw new Error(`Unsupported pricing source: ${config.source}`);
  }
  return {
    source: 2,
    quoteToken: config.quoteToken,
    primarySource: config.poolAddress,
    secondarySource: config.quoteUsdFeedAddress,
    primaryMaxStaleness: config.maxStaleness,
    secondaryMaxStaleness: config.quoteUsdMaxStaleness,
  };
}

export function approvedPricingConfigsFor(chainId: number, tokenAddress: string): NumericPricingConfig[] {
  return verifiedAssetFor(chainId, tokenAddress)?.approvedPricingConfigs.map(toNumericPricingConfig) ?? [];
}

export function pricingConfigsMatch(left: NumericPricingConfig, right: NumericPricingConfig): boolean {
  return left.source === right.source
    && sameAddress(left.quoteToken, right.quoteToken)
    && sameAddress(left.primarySource, right.primarySource)
    && sameAddress(left.secondarySource, right.secondarySource)
    && right.primaryMaxStaleness > 0
    && right.primaryMaxStaleness <= left.primaryMaxStaleness
    && (right.source === 1 || right.source === 2
      ? right.secondaryMaxStaleness > 0
        && right.secondaryMaxStaleness <= left.secondaryMaxStaleness
      : right.secondaryMaxStaleness === 0);
}

export function pricingVerification(
  chainId: number,
  tokenAddress: string,
  config: NumericPricingConfig,
): PricingVerification {
  const approved = approvedPricingConfigsFor(chainId, tokenAddress)
    .find((candidate) => pricingConfigsMatch(candidate, config));
  if (!approved) return { verified: false, availabilityWarning: false };
  return {
    verified: true,
    availabilityWarning: config.primaryMaxStaleness < approved.primaryMaxStaleness
      || ((config.source === 1 || config.source === 2)
        && config.secondaryMaxStaleness < approved.secondaryMaxStaleness),
  };
}

export function isVerifiedPricingConfig(
  chainId: number,
  tokenAddress: string,
  config: NumericPricingConfig,
): boolean {
  return pricingVerification(chainId, tokenAddress, config).verified;
}
