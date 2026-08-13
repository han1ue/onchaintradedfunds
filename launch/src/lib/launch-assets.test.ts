import { describe, expect, it } from "vitest";
import { getLaunchAssetName, isLaunchAsset, launchAssets } from "./launch-assets";

describe("launch asset catalog", () => {
  it("contains the 30 unique assets supported by the launch competition", () => {
    expect(launchAssets).toHaveLength(30);
    expect(new Set(launchAssets.map(({ symbol }) => symbol)).size).toBe(30);
  });

  it("matches symbols case-insensitively and preserves canonical names", () => {
    expect(isLaunchAsset("aapl")).toBe(true);
    expect(isLaunchAsset("ETH")).toBe(false);
    expect(getLaunchAssetName("sgov")).toBe("iShares 0–3 Month Treasury Bond ETF");
  });
});
