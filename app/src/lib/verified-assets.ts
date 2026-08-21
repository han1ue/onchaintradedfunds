import verifiedAssetsData from "../config/verified_assets.json";

export type ApprovedPricingConfig =
  | {
      source: "chainlink-direct";
      feedAddress: string;
      maxStaleness: number;
      validationMode: 0 | 1;
    }
  | {
      source: "chainlink-weth";
      assetWethFeedAddress: string;
      assetWethMaxStaleness: number;
      assetWethValidationMode: 0 | 1;
      wethUsdFeedAddress: string;
      wethUsdMaxStaleness: number;
      wethUsdValidationMode: 0 | 1;
    }
  | {
      source: "uniswap-v3";
      poolAddress: string;
      maxStaleness: number;
      validationMode: 0;
      quoteUsdFeedAddress: string;
      quoteUsdMaxStaleness: number;
      quoteUsdValidationMode: 0 | 1;
    };

export type NumericPricingConfig = {
  source: 0 | 1 | 2;
  primarySource: string;
  secondarySource: string;
  primaryMaxStaleness: number;
  secondaryMaxStaleness: number;
  primaryValidationMode: 0 | 1;
  secondaryValidationMode: 0 | 1;
};

export type PricingVerification = {
  verified: boolean;
  availabilityWarning: boolean;
};

export type VerifiedAsset = {
  chainId: number;
  tokenAddress: string;
  symbol: string;
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
  if (config.source === "chainlink-direct") {
    return {
      source: 0,
      primarySource: config.feedAddress,
      secondarySource: ZERO_ADDRESS,
      primaryMaxStaleness: config.maxStaleness,
      secondaryMaxStaleness: 0,
      primaryValidationMode: config.validationMode,
      secondaryValidationMode: 0,
    };
  }
  if (config.source === "chainlink-weth") {
    return {
      source: 1,
      primarySource: config.assetWethFeedAddress,
      secondarySource: config.wethUsdFeedAddress,
      primaryMaxStaleness: config.assetWethMaxStaleness,
      secondaryMaxStaleness: config.wethUsdMaxStaleness,
      primaryValidationMode: config.assetWethValidationMode,
      secondaryValidationMode: config.wethUsdValidationMode,
    };
  }
  return {
    source: 2,
    primarySource: config.poolAddress,
    secondarySource: config.quoteUsdFeedAddress,
    primaryMaxStaleness: config.maxStaleness,
    secondaryMaxStaleness: config.quoteUsdMaxStaleness,
    primaryValidationMode: config.validationMode,
    secondaryValidationMode: config.quoteUsdValidationMode,
  };
}

export function approvedPricingConfigsFor(chainId: number, tokenAddress: string): NumericPricingConfig[] {
  return verifiedAssetFor(chainId, tokenAddress)?.approvedPricingConfigs.map(toNumericPricingConfig) ?? [];
}

export function pricingConfigsMatch(left: NumericPricingConfig, right: NumericPricingConfig): boolean {
  return left.source === right.source
    && sameAddress(left.primarySource, right.primarySource)
    && sameAddress(left.secondarySource, right.secondarySource)
    && left.primaryValidationMode === right.primaryValidationMode
    && left.secondaryValidationMode === right.secondaryValidationMode
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
