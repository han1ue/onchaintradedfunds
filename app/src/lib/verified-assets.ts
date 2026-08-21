import verifiedAssetsData from "../config/verified_assets.json";

export type ApprovedPricingConfig =
  | { source: "chainlink-direct"; feedAddress: string }
  | { source: "chainlink-weth"; assetWethFeedAddress: string; wethUsdFeedAddress: string }
  | { source: "uniswap-v3"; poolAddress: string };

export type NumericPricingConfig = {
  source: 0 | 1 | 2;
  primarySource: string;
  secondarySource: string;
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
    return { source: 0, primarySource: config.feedAddress, secondarySource: ZERO_ADDRESS };
  }
  if (config.source === "chainlink-weth") {
    return {
      source: 1,
      primarySource: config.assetWethFeedAddress,
      secondarySource: config.wethUsdFeedAddress,
    };
  }
  return { source: 2, primarySource: config.poolAddress, secondarySource: ZERO_ADDRESS };
}

export function approvedPricingConfigsFor(chainId: number, tokenAddress: string): NumericPricingConfig[] {
  return verifiedAssetFor(chainId, tokenAddress)?.approvedPricingConfigs.map(toNumericPricingConfig) ?? [];
}

export function pricingConfigsMatch(left: NumericPricingConfig, right: NumericPricingConfig): boolean {
  return left.source === right.source
    && sameAddress(left.primarySource, right.primarySource)
    && sameAddress(left.secondarySource, right.secondarySource);
}

export function isVerifiedPricingConfig(
  chainId: number,
  tokenAddress: string,
  config: NumericPricingConfig,
): boolean {
  return approvedPricingConfigsFor(chainId, tokenAddress)
    .some((approved) => pricingConfigsMatch(approved, config));
}
