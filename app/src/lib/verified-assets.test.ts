import { describe, expect, it } from "vitest";
import {
  approvedPricingConfigsFor,
  isVerifiedPricingConfig,
  ZERO_ADDRESS,
} from "./verified-assets";

const TESTNET_TSLA = "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E";
const MAINNET_NFLX = "0xE0444EF8BF4eD74f74FD73686e2ddF4C1c5591E8";

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

  it("supports every approved Mainnet pool choice", () => {
    const approved = approvedPricingConfigsFor(4663, MAINNET_NFLX);
    expect(approved).toHaveLength(2);
    expect(approved.every((config) => isVerifiedPricingConfig(4663, MAINNET_NFLX, config))).toBe(true);
    expect(isVerifiedPricingConfig(46630, MAINNET_NFLX, approved[0])).toBe(false);
  });
});
