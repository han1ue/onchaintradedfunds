import { describe, expect, it } from "vitest";
import {
  approvedPricingConfigsFor,
  isVerifiedPricingConfig,
  pricingVerification,
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
      ...approved,
      primaryValidationMode: approved.primaryValidationMode === 0 ? 1 : 0,
    })).toBe(false);
    expect(isVerifiedPricingConfig(46630, TESTNET_TSLA, {
      ...approved,
      primaryMaxStaleness: 0,
    })).toBe(false);
  });

  it("keeps shorter nonzero limits verified and reports only an availability warning", () => {
    const approved = approvedPricingConfigsFor(46630, TESTNET_TSLA)[0];
    const shorter = { ...approved, primaryMaxStaleness: approved.primaryMaxStaleness - 1 };
    expect(pricingVerification(46630, TESTNET_TSLA, shorter)).toEqual({
      verified: true,
      availabilityWarning: true,
    });
    expect(isVerifiedPricingConfig(46630, TESTNET_TSLA, {
      ...approved,
      primaryMaxStaleness: approved.primaryMaxStaleness + 1,
    })).toBe(false);
  });

  it("does not verify legacy V3 pools without a pinned quote/USD feed", () => {
    const approved = approvedPricingConfigsFor(4663, MAINNET_NFLX);
    expect(approved).toHaveLength(0);
  });
});
