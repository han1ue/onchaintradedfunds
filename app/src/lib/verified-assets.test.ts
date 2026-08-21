import { describe, expect, it } from "vitest";
import {
  approvedPricingConfigsFor,
  isVerifiedPricingConfig,
  ZERO_ADDRESS,
} from "./verified-assets";

const TESTNET_TSLA = "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E";

describe("frontend asset pricing verification", () => {
  it("matches chain, token, source and every address case-insensitively", () => {
    const approved = approvedPricingConfigsFor(46630, TESTNET_TSLA)[0];
    expect(isVerifiedPricingConfig(46630, TESTNET_TSLA.toLowerCase(), {
      ...approved,
      primarySource: approved.primarySource.toLowerCase(),
    })).toBe(true);
  });

  it("rejects a different chain, source, or address and verifies again when restored", () => {
    const approved = approvedPricingConfigsFor(46630, TESTNET_TSLA)[0];
    expect(isVerifiedPricingConfig(4663, TESTNET_TSLA, approved)).toBe(false);
    expect(isVerifiedPricingConfig(46630, TESTNET_TSLA, { ...approved, source: 2 })).toBe(false);
    expect(isVerifiedPricingConfig(46630, TESTNET_TSLA, {
      ...approved,
      primarySource: "0x1111111111111111111111111111111111111111",
    })).toBe(false);
    expect(isVerifiedPricingConfig(46630, TESTNET_TSLA, {
      source: 0,
      primarySource: approved.primarySource,
      secondarySource: ZERO_ADDRESS,
    })).toBe(true);
  });
});
