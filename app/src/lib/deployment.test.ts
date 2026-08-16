import { describe, expect, it } from "vitest";
import { parseKnownPricingConfigs } from "./deployment";

const ASSET = "0x1111111111111111111111111111111111111111";
const DIRECT = "0x2222222222222222222222222222222222222222";
const POOL = "0x3333333333333333333333333333333333333333";
const EXECUTION_POOL = "0x4444444444444444444444444444444444444444";

describe("deployment pricing suggestions", () => {
  it("prefers explicit pricing suggestions and never infers pricing from execution pools", () => {
    const configs = parseKnownPricingConfigs({
      pricingConfiguration: {
        suggestedInitialPricingConfigs: [{
          asset: ASSET,
          source: "ChainlinkDirect",
          primarySource: DIRECT,
          secondarySource: "0x0000000000000000000000000000000000000000",
        }],
        suggestedV3PricingConfigs: [{
          asset: ASSET,
          source: "UniswapV3Twap",
          primarySource: POOL,
        }],
      },
      executionRoutes: [{ asset: ASSET, pool: EXECUTION_POOL }],
    });

    expect(configs[0]).toMatchObject({
      asset: ASSET,
      config: { source: 0, primarySource: DIRECT },
    });
    expect(configs.some((record) => record.config.primarySource === EXECUTION_POOL)).toBe(false);
  });

  it("drops unsupported pricing-source names including V4", () => {
    expect(parseKnownPricingConfigs({
      pricingConfiguration: {
        suggestedInitialPricingConfigs: [{
          asset: ASSET,
          source: "UniswapV4",
          primarySource: POOL,
        }],
      },
    })).toEqual([]);
  });
});
