import { describe, expect, it } from "vitest";
import { deriveOtfQuality, normalizeAssetQuality } from "./asset-quality";

describe("asset quality metadata", () => {
  it("normalizes unknown and legacy values to normal", () => {
    expect(normalizeAssetQuality(undefined)).toBe("normal");
    expect(normalizeAssetQuality("qualified")).toBe("normal");
    expect(normalizeAssetQuality("high")).toBe("high");
  });

  it("derives high quality live only when every current constituent is high quality", () => {
    expect(deriveOtfQuality(["high", "high"])).toBe("high");
    expect(deriveOtfQuality(["high", "normal"])).toBe("normal");
    expect(deriveOtfQuality([])).toBe("normal");
  });
});
