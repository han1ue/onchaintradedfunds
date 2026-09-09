import { beforeEach, describe, expect, it, vi } from "vitest";
import { creationAssetSnapshot, defaultCreationAssetSelection } from "@/lib/create-asset-picker";
import { resetToMarketCapPercentageUnits, TOTAL_PERCENT_UNITS } from "@/lib/creation-model";

const { readPrices } = vi.hoisted(() => ({ readPrices: vi.fn() }));
vi.mock("@/server/pricing", () => ({ readPrices }));
import { GET } from "./route";

const collectedAt = "2026-09-09T01:00:00.000Z";
const assets = ["OTF", "ALPHA", "BETA"].map((symbol, index) => ({
  address: `0x${String(index + 1).padStart(40, "0")}`,
  symbol, name: symbol, decimals: 18, verified: true, usable: true,
  priceUsd: "2", marketCapUsd: "1000000", collectedAt,
}));

beforeEach(() => { readPrices.mockReset(); });

describe("creation asset API and form contract", () => {
  it("loads the API snapshot into default constituents and leaves another asset to add", async () => {
    readPrices.mockResolvedValue(assets);
    const response = await GET(new Request("http://localhost/api/creation-assets?chainId=46630"));
    expect(response.status).toBe(200);
    const snapshot = creationAssetSnapshot(await response.json());
    expect(snapshot.collectedAt).toBe(collectedAt);
    const selected = defaultCreationAssetSelection(snapshot.assets, () => 0);
    expect(selected.map((asset) => asset.symbol)).toEqual(["OTF", "ALPHA"]);
    expect(resetToMarketCapPercentageUnits(selected.map((asset) => asset.marketCapUsd))
      .reduce((sum, weight) => sum + weight, 0n)).toBe(TOTAL_PERCENT_UNITS);
    expect(snapshot.assets.filter((asset) => !selected.includes(asset)).map((asset) => asset.symbol)).toEqual(["BETA"]);
  });

  it("reports an empty snapshot when no assets have usable prices and market caps", async () => {
    readPrices.mockResolvedValue([{ ...assets[0], usable: false }, { ...assets[1], marketCapUsd: undefined }]);
    const response = await GET(new Request("http://localhost/api/creation-assets?chainId=46630"));
    expect(creationAssetSnapshot(await response.json())).toEqual({ assets: [] });
  });

  it("rejects a nonempty snapshot without a valid collection timestamp", () => {
    expect(() => creationAssetSnapshot({ data: assets })).toThrow("ASSET_SNAPSHOT_UNAVAILABLE");
    expect(() => creationAssetSnapshot({ data: assets, collectedAt: "invalid" })).toThrow("ASSET_SNAPSHOT_UNAVAILABLE");
    expect(() => creationAssetSnapshot({ error: "ASSET_DATA_UNAVAILABLE" })).toThrow("ASSET_DATA_UNAVAILABLE");
  });

  it("returns a recoverable service error when price loading fails", async () => {
    readPrices.mockRejectedValue(new Error("DATABASE_UNAVAILABLE"));
    const response = await GET(new Request("http://localhost/api/creation-assets?chainId=46630"));
    expect(response.status).toBe(503);
  });
});
