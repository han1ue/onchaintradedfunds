import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHALLENGE_DEVIATION_BPS,
  DEFAULT_COMPLETION_DEVIATION_BPS,
  deriveOtfQuality,
  normalizeAssetQuality,
  percentToBps,
  primaryDepositsBlocked,
  SUPPORTED_PRICING_SOURCES,
  weightBandValidationError,
} from "./protocol-ui";

describe("protocol UI policy", () => {
  it("derives live OTF quality and treats unknown metadata as normal", () => {
    expect(normalizeAssetQuality("blocked")).toBe("normal");
    expect(deriveOtfQuality(["high", "high"])).toBe("high");
    expect(deriveOtfQuality(["high", "normal"])).toBe("normal");
    expect(deriveOtfQuality([])).toBe("normal");
  });

  it("supports exactly the four requested pricing routes and no V4", () => {
    expect(SUPPORTED_PRICING_SOURCES).toEqual([
      "chainlink-robinhood",
      "chainlink",
      "chainlink-composed",
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

  it("uses the requested creation defaults and converts fixed portfolio percentages to bps", () => {
    expect(DEFAULT_COMPLETION_DEVIATION_BPS).toBe(100);
    expect(DEFAULT_CHALLENGE_DEVIATION_BPS).toBe(250);
    expect(percentToBps("0.25")).toBe(25);
    expect(percentToBps("1")).toBe(100);
    expect(percentToBps("2.5")).toBe(250);
  });

  it("validates weight bands against supplied factory limits", () => {
    const limits = {
      minCompletionDeviationBps: 25,
      maxCompletionDeviationBps: 500,
      minChallengeDeviationGapBps: 25,
      maxChallengeDeviationBps: 1_500,
    };
    expect(weightBandValidationError(25, 50, limits)).toBeUndefined();
    expect(weightBandValidationError(500, 1_500, limits)).toBeUndefined();
    expect(weightBandValidationError(24, 250, limits)).toContain("Completion");
    expect(weightBandValidationError(100, 124, limits)).toContain("Challenge");
  });
});
