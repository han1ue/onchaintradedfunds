import { describe, expect, it } from "vitest";
import { getLaunchAssetName, isLaunchAsset, launchAssets } from "./launch-assets";

describe("launch asset catalog", () => {
  it("contains the 32 unique assets supported by the launch competition", () => {
    expect(launchAssets).toHaveLength(32);
    expect(new Set(launchAssets.map(({ symbol }) => symbol)).size).toBe(32);
  });

  it("matches symbols case-insensitively and preserves canonical names", () => {
    expect(isLaunchAsset("aapl")).toBe(true);
    expect(isLaunchAsset("ETH")).toBe(false);
    expect(getLaunchAssetName("sgov")).toBe("iShares 0–3 Month Treasury Bond ETF");
  });

  it("includes the Robinhood Chain contracts for DELL and RBLX", () => {
    expect(launchAssets.find(({ symbol }) => symbol === "DELL")?.contractAddress).toBe("0x941AE714EC6D8130c7B75d67160Ca08f1e7d11Dd");
    expect(launchAssets.find(({ symbol }) => symbol === "RBLX")?.contractAddress).toBe("0xF0C4BF4C582cb3836e98394b1d4e7B7281101bE8");
  });
});
