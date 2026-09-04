import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import {
  defaultCreationAssetSelection,
  filterCreationAssetOptions,
  manualCreationAsset,
} from "./create-asset-picker";
import type { CreationAssetData } from "./creation-model";

const alpha: CreationAssetData = {
  address: getAddress("0x0000000000000000000000000000000000000001"),
  symbol: "ALPHA",
  name: "Alpha Asset",
  decimals: 18,
  priceUsd: "12.5",
  marketCapUsd: "1000000",
  verified: true,
};
const beta: CreationAssetData = {
  ...alpha,
  address: getAddress("0x0000000000000000000000000000000000000002"),
  symbol: "BETA",
  name: "Beta Asset",
};
const otf: CreationAssetData = {
  ...alpha,
  address: getAddress("0x0000000000000000000000000000000000000003"),
  symbol: "OTF",
  name: "Onchain Traded Funds",
};

describe("creation asset picker", () => {
  it("starts with OTF and one randomly selected verified asset", () => {
    const gamma = {
      ...beta,
      address: getAddress("0x0000000000000000000000000000000000000004"),
      symbol: "GAMMA",
    };
    expect(defaultCreationAssetSelection([alpha, otf, beta, gamma], () => 0.6))
      .toEqual([otf, beta]);
    expect(defaultCreationAssetSelection([{ ...alpha, verified: false }, otf], () => 0))
      .toEqual([otf]);
  });

  it("searches names, tickers, and addresses while excluding other selected rows", () => {
    expect(filterCreationAssetOptions([alpha, beta], [alpha.address], beta.address, "beta")).toEqual([beta]);
    expect(filterCreationAssetOptions([alpha, beta], [], alpha.address, alpha.address)).toEqual([alpha]);
    expect(filterCreationAssetOptions([alpha, beta], [alpha.address], beta.address, "asset")).toEqual([beta]);
  });

  it("resolves an 18-decimal address against available valuation data and marks a new contract unverified", () => {
    expect(manualCreationAsset(
      "0x0000000000000000000000000000000000000003",
      { name: "Alpha Test Token", symbol: "ALPHA", decimals: 18 },
      [alpha],
    )).toEqual(expect.objectContaining({
      address: getAddress("0x0000000000000000000000000000000000000003"),
      name: "Alpha Test Token",
      symbol: "ALPHA",
      priceUsd: "12.5",
      marketCapUsd: "1000000",
      verified: false,
    }));
  });

  it("rejects unsupported precision and addresses without valuation data", () => {
    expect(manualCreationAsset(alpha.address, { name: "Alpha", symbol: "ALPHA", decimals: 6 }, [alpha])).toBeUndefined();
    expect(manualCreationAsset(
      "0x0000000000000000000000000000000000000003",
      { name: "Unknown", symbol: "UNKNOWN", decimals: 18 },
      [alpha],
    )).toBeUndefined();
  });
});
