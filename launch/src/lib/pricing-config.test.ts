import { describe, expect, it } from "vitest";
import { preferredActiveMarketPricingConfig, preferredPricingConfig, pricingConfigComplete } from "./pricing-config";

describe("pricing configuration", () => {
  const address = (suffix: string) => `0x${suffix.padStart(40, "0")}`;

  it("prefers a known Chainlink route before a known V3 pool", () => {
    expect(preferredPricingConfig([
      { id: "v3", active: true, source: "uniswap-v3", poolAddress: address("1") },
      { id: "feed", active: true, source: "chainlink-direct", feedAddress: address("2") },
    ])).toEqual({ source: "chainlink-direct", feedAddress: address("2") });
  });

  it("uses only an active stored market when autocompleting an unverified asset pool", () => {
    expect(preferredActiveMarketPricingConfig([
      { active: false, poolAddress: address("1") },
      { active: true, poolAddress: address("2") },
    ])).toEqual({ source: "uniswap-v3", poolAddress: address("2") });
    expect(preferredActiveMarketPricingConfig([
      { active: false, poolAddress: address("1") },
    ])).toBeNull();
  });

  it("requires both concrete feed addresses for the composed Chainlink route", () => {
    expect(pricingConfigComplete({
      source: "chainlink-weth",
      assetWethFeedAddress: address("1"),
      wethUsdFeedAddress: "",
    })).toBe(false);
    expect(pricingConfigComplete({
      source: "chainlink-weth",
      assetWethFeedAddress: address("1"),
      wethUsdFeedAddress: address("2"),
    })).toBe(true);
  });
});
