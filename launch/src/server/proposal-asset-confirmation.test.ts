import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { validateExistingAssetSelection } from "./proposal-asset-confirmation";

const startsAt = new Date("2026-08-17T00:00:00Z");
const storedPool = "0x1111111111111111111111111111111111111111";
const arbitraryPool = "0x2222222222222222222222222222222222222222";
const assetAddress = "0x3333333333333333333333333333333333333333";

describe("existing proposal asset confirmation", () => {
  it("rejects an arbitrary pool submitted with an unverified registry asset ID", async () => {
    const assetId = randomUUID();
    const validate = vi.fn();

    await expect(validateExistingAssetSelection(
      { assetId, pricingConfig: { source: "uniswap-v3", poolAddress: arbitraryPool }, weightBps: 5_000 },
      { id: assetId, contractAddress: assetAddress, verified: false },
      [{ id: randomUUID(), assetId, poolAddress: storedPool, active: true }],
      startsAt,
      validate,
    )).rejects.toThrow("ASSET_MARKET_NOT_FOUND");
    expect(validate).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", []],
    ["inactive", [{ id: randomUUID(), assetId: "placeholder", poolAddress: storedPool, active: false }]],
  ])("rejects a %s stored market for an unverified asset", async (_label, marketRows) => {
    const assetId = randomUUID();
    const markets = marketRows.map((market) => ({ ...market, assetId }));
    await expect(validateExistingAssetSelection(
      { assetId, pricingConfig: { source: "uniswap-v3", poolAddress: storedPool }, weightBps: 5_000 },
      { id: assetId, contractAddress: assetAddress, verified: false },
      markets,
      startsAt,
      vi.fn(),
    )).rejects.toThrow("ASSET_MARKET_NOT_FOUND");
  });

  it("rejects a reused unverified market when exact asset/pool validation fails", async () => {
    const assetId = randomUUID();
    const marketId = randomUUID();
    const validate = vi.fn().mockResolvedValue({ status: "fail" });

    await expect(validateExistingAssetSelection(
      { assetId, pricingConfig: { source: "uniswap-v3", poolAddress: storedPool }, weightBps: 5_000 },
      { id: assetId, contractAddress: assetAddress, verified: false },
      [{ id: marketId, assetId, poolAddress: storedPool, active: true }],
      startsAt,
      validate,
    )).rejects.toThrow("ASSET_MARKET_REQUIREMENTS_NOT_MET");
    expect(validate).toHaveBeenCalledWith({ assetAddress, poolAddress: storedPool, competitionStartsAt: startsAt });
  });

  it("reuses the server-owned active market after exact asset/pool validation passes", async () => {
    const assetId = randomUUID();
    const marketId = randomUUID();
    const validate = vi.fn().mockResolvedValue({ status: "pass" });

    await expect(validateExistingAssetSelection(
      { assetId, pricingConfig: { source: "uniswap-v3", poolAddress: storedPool }, weightBps: 5_000 },
      { id: assetId, contractAddress: assetAddress, verified: false },
      [{ id: marketId, assetId, poolAddress: storedPool, active: true }],
      startsAt,
      validate,
    )).resolves.toEqual({
      assetId,
      marketId,
      pricingConfig: { source: "uniswap-v3", poolAddress: storedPool },
      weightBps: 5_000,
    });
    expect(validate).toHaveBeenCalledWith({ assetAddress, poolAddress: storedPool, competitionStartsAt: startsAt });
  });

  it("ignores proposal pricing configuration for a verified registry asset", async () => {
    const assetId = randomUUID();
    const validate = vi.fn();

    await expect(validateExistingAssetSelection(
      { assetId, pricingConfig: { source: "uniswap-v3", poolAddress: arbitraryPool }, weightBps: 5_000 },
      { id: assetId, contractAddress: assetAddress, verified: true },
      [],
      startsAt,
      validate,
    )).resolves.toEqual({ assetId, marketId: null, pricingConfig: null, weightBps: 5_000 });
    expect(validate).not.toHaveBeenCalled();
  });
});
