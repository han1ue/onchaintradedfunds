import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import { percentageUnits } from "./creation-model";
import {
  MULTIPLIER_SCALE,
  WeightingMethod,
  buildCreationMetadataDraft,
  classifyWeightingMethod,
  formatMarketCapMultiplier,
  loadCreationMetadata,
  marketCapMultiplierUnits,
  multiplierPosition,
  persistCreationMetadata,
  weightingMethodLabel,
} from "./creation-metadata";

function pct(value: string): bigint {
  const units = percentageUnits(value);
  if (units === undefined) throw new Error(`Invalid percentage: ${value}`);
  return units;
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

const assets = [
  { address: getAddress("0x0000000000000000000000000000000000000001"), symbol: "ALPHA", name: "Alpha", marketCapUsd: "3", finalPercentageUnits: pct("75") },
  { address: getAddress("0x0000000000000000000000000000000000000002"), symbol: "BETA", name: "Beta", marketCapUsd: "1", finalPercentageUnits: pct("25") },
] as const;

describe("weighting methodology", () => {
  it("classifies exact defaults without relying on touched state", () => {
    expect(classifyWeightingMethod([pct("75"), pct("25")], [pct("75"), pct("25")]))
      .toBe(WeightingMethod.MarketCapWeighted);
    expect(weightingMethodLabel(WeightingMethod.MarketCapWeighted)).toBe("Market-cap weighted");
  });

  it("classifies any exact-unit difference as modified", () => {
    expect(classifyWeightingMethod(
      [pct("75.000000000000000001"), pct("24.999999999999999999")],
      [pct("75"), pct("25")],
    )).toBe(WeightingMethod.ModifiedMarketCapWeighted);
    expect(weightingMethodLabel(WeightingMethod.ModifiedMarketCapWeighted))
      .toBe("Modified market-cap weighted");
  });

  it("restores market-cap classification when final values reset exactly", () => {
    const defaults = [pct("75"), pct("25")];
    const edited = [pct("80"), pct("20")];
    expect(classifyWeightingMethod(edited, defaults)).toBe(WeightingMethod.ModifiedMarketCapWeighted);
    expect(classifyWeightingMethod(defaults, defaults)).toBe(WeightingMethod.MarketCapWeighted);
  });

  it("formats tiny weights and large fixed-point multipliers without floating point", () => {
    const tinyDefault = 1n;
    const largeMultiplier = marketCapMultiplierUnits(pct("99"), tinyDefault);
    expect(formatMarketCapMultiplier(marketCapMultiplierUnits(1n, tinyDefault))).toBe("1.00×");
    expect(formatMarketCapMultiplier(largeMultiplier)).toBe("99,000,000,000,000,000,000×");
    expect(multiplierPosition(largeMultiplier)).toBe("overweight");
    expect(formatMarketCapMultiplier(1n)).toBe("<0.00000001×");
    expect(multiplierPosition(1n)).toBe("underweight");
    expect(multiplierPosition(MULTIPLIER_SCALE)).toBe("unchanged");
    expect(formatMarketCapMultiplier(MULTIPLIER_SCALE + 1n)).toBe("1.000000000000000001×");
    expect(formatMarketCapMultiplier(MULTIPLIER_SCALE - 1n)).toBe("0.999999999999999999×");
    expect(formatMarketCapMultiplier(MULTIPLIER_SCALE + MULTIPLIER_SCALE / 1_000n)).toBe("1.001×");
  });
});

describe("creation metadata persistence", () => {
  it("persists precise defaults, final weights, multipliers, method, and snapshot timestamp", () => {
    const storage = memoryStorage();
    const draft = buildCreationMetadataDraft({
      marketCapSnapshotAt: "2026-08-30T12:34:56.000Z",
      assets,
    });
    const vaultAddress = getAddress("0x00000000000000000000000000000000000000AA");
    persistCreationMetadata(storage, 46630, vaultAddress, draft);
    expect(loadCreationMetadata(storage, 46630, vaultAddress)).toEqual(expect.objectContaining({
      weightingMethod: WeightingMethod.MarketCapWeighted,
      marketCapSnapshotAt: "2026-08-30T12:34:56.000Z",
      constituents: [
        expect.objectContaining({ marketCapDefaultPercentageUnits: pct("75").toString(), finalPercentageUnits: pct("75").toString(), multiplierUnits: MULTIPLIER_SCALE.toString() }),
        expect.objectContaining({ marketCapDefaultPercentageUnits: pct("25").toString(), finalPercentageUnits: pct("25").toString(), multiplierUnits: MULTIPLIER_SCALE.toString() }),
      ],
    }));
    expect(draft).not.toHaveProperty("thesis");
  });

  it("returns unavailable for missing or malformed metadata instead of fabricating it", () => {
    const storage = memoryStorage();
    const vaultAddress = getAddress("0x00000000000000000000000000000000000000AA");
    expect(loadCreationMetadata(storage, 46630, vaultAddress)).toBeUndefined();
    storage.setItem(`otf:creation-metadata:46630:${vaultAddress.toLowerCase()}`, "{broken");
    expect(loadCreationMetadata(storage, 46630, vaultAddress)).toBeUndefined();
  });

  it("rejects the removed browser-metadata thesis shape without a compatibility fallback", () => {
    const storage = memoryStorage();
    const vaultAddress = getAddress("0x00000000000000000000000000000000000000AA");
    const metadata = persistCreationMetadata(storage, 46630, vaultAddress, buildCreationMetadataDraft({
      marketCapSnapshotAt: "2026-08-30T12:34:56.000Z",
      assets,
    }));
    storage.setItem(
      `otf:creation-metadata:46630:${vaultAddress.toLowerCase()}`,
      JSON.stringify({ ...metadata, thesis: "Removed browser thesis" }),
    );

    expect(loadCreationMetadata(storage, 46630, vaultAddress)).toBeUndefined();
  });

  it("provides both detail-page methodology labels", () => {
    expect(weightingMethodLabel(WeightingMethod.MarketCapWeighted)).toBe("Market-cap weighted");
    expect(weightingMethodLabel(WeightingMethod.ModifiedMarketCapWeighted)).toBe("Modified market-cap weighted");
  });
});
