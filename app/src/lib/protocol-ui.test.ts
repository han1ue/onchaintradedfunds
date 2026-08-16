import { describe, expect, it } from "vitest";
import {
  deriveOtfQuality,
  normalizeAssetQuality,
  primaryDepositsBlocked,
  SUPPORTED_PRICING_SOURCES,
} from "./protocol-ui";

describe("protocol UI policy", () => {
  it("derives live OTF quality and treats unknown metadata as normal", () => {
    expect(normalizeAssetQuality("blocked")).toBe("normal");
    expect(deriveOtfQuality(["high", "high"])).toBe("high");
    expect(deriveOtfQuality(["high", "normal"])).toBe("normal");
    expect(deriveOtfQuality([])).toBe("normal");
  });

  it("supports exactly the three requested pricing routes and no V4", () => {
    expect(SUPPORTED_PRICING_SOURCES).toEqual([
      "chainlink-direct",
      "chainlink-weth",
      "uniswap-v3",
    ]);
    expect(SUPPORTED_PRICING_SOURCES).not.toContain("uniswap-v4");
  });

  it("fails primary deposits closed when either pause is active or unreadable", () => {
    const open = { sunset: false, globalPause: false, localPause: false, pauseStatusAvailable: true, retiringAsset: false };
    expect(primaryDepositsBlocked(open)).toBe(false);
    expect(primaryDepositsBlocked({ ...open, globalPause: true })).toBe(true);
    expect(primaryDepositsBlocked({ ...open, localPause: true })).toBe(true);
    expect(primaryDepositsBlocked({ ...open, pauseStatusAvailable: false })).toBe(true);
  });
});
