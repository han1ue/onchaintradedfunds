import type { KnownPricingConfig, PricingConfig } from "./types";

export type PricingSource = PricingConfig["source"];

export const PRICING_SOURCE_OPTIONS: { source: PricingSource; label: string }[] = [
  { source: "chainlink-direct", label: "Chainlink · ASSET/USD" },
  { source: "chainlink-weth", label: "Chainlink · ASSET/WETH × WETH/USD" },
  { source: "uniswap-v3", label: "Uniswap V3 TWAP" },
];

export const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export function clonePricingConfig(config: PricingConfig): PricingConfig {
  if (config.source === "chainlink-direct") return { source: config.source, feedAddress: config.feedAddress };
  if (config.source === "chainlink-weth") return {
    source: config.source,
    assetWethFeedAddress: config.assetWethFeedAddress,
    wethUsdFeedAddress: config.wethUsdFeedAddress,
  };
  return { source: config.source, poolAddress: config.poolAddress };
}

export function preferredPricingConfig(configs: readonly KnownPricingConfig[]): PricingConfig | null {
  const active = configs.filter((config) => config.active);
  const known = active.find((config) => config.source === "chainlink-direct")
    ?? active.find((config) => config.source === "chainlink-weth")
    ?? active.find((config) => config.source === "uniswap-v3");
  return known ? clonePricingConfig(known) : null;
}

export function preferredActiveMarketPricingConfig(
  markets: readonly { active: boolean; poolAddress: string }[],
): Extract<PricingConfig, { source: "uniswap-v3" }> | null {
  const market = markets.find((candidate) => candidate.active);
  return market ? { source: "uniswap-v3", poolAddress: market.poolAddress } : null;
}

export function pricingConfigComplete(config: PricingConfig | null | undefined): config is PricingConfig {
  if (!config) return false;
  if (config.source === "chainlink-direct") return EVM_ADDRESS_PATTERN.test(config.feedAddress);
  if (config.source === "chainlink-weth") return EVM_ADDRESS_PATTERN.test(config.assetWethFeedAddress)
    && EVM_ADDRESS_PATTERN.test(config.wethUsdFeedAddress);
  return EVM_ADDRESS_PATTERN.test(config.poolAddress);
}

export function pricingConfigLabel(config: PricingConfig) {
  return PRICING_SOURCE_OPTIONS.find((option) => option.source === config.source)?.label ?? config.source;
}

export function pricingConfigAddresses(config: PricingConfig): { primaryAddress: string; secondaryAddress: string | null } {
  if (config.source === "chainlink-direct") return { primaryAddress: config.feedAddress, secondaryAddress: null };
  if (config.source === "chainlink-weth") return {
    primaryAddress: config.assetWethFeedAddress,
    secondaryAddress: config.wethUsdFeedAddress,
  };
  return { primaryAddress: config.poolAddress, secondaryAddress: null };
}

export function pricingConfigSummary(config: PricingConfig) {
  const addresses = pricingConfigAddresses(config);
  return `${pricingConfigLabel(config)} · ${addresses.primaryAddress}${addresses.secondaryAddress ? ` · ${addresses.secondaryAddress}` : ""}`;
}
