import { describe, expect, it } from "vitest";
import {
  otfPoolDiscovery,
  productionAssetsForChain,
  testnetAssetById,
  testnetFundAssets,
  testnetPoolRouteAllowed,
  testnetPools,
  testnetQuoteAssets,
  testnetSwapPairAllowed,
  testnetVenue,
} from "./asset-catalog";
import verifiedAssets from "../config/verified_assets.json";

const OTF_A = { address: "0x00000000000000000000000000000000000000F1" as const, kind: "otf" as const };
const OTF_B = { address: "0x00000000000000000000000000000000000000F2" as const, kind: "otf" as const };

describe("asset catalogs", () => {
  it("separates testnet quote rails from the five fund constituents", () => {
    expect(testnetQuoteAssets.map((asset) => [asset.symbol, asset.decimals])).toEqual([
      ["USDG", 6],
      ["WETH", 18],
    ]);
    expect(testnetFundAssets.map((asset) => asset.symbol)).toEqual(["TSLA", "AMZN", "PLTR", "NFLX", "AMD"]);
    expect(testnetPools).toHaveLength(6);
    expect(testnetPools.find((pool) => pool.id === "weth-usdg")).toMatchObject({ fee: 100 });
    expect(otfPoolDiscovery).toMatchObject({ quoteAsset: { symbol: "USDG" }, fee: 500 });
    expect(testnetVenue.name).toBe("Synthra V3");
  });

  it("keeps constituent pool routes internal and requires an OTF in user swaps", () => {
    const usdg = { address: testnetAssetById("usdg")!.address, kind: "erc20" as const };
    const weth = { address: testnetAssetById("weth")!.address, kind: "erc20" as const };
    const tsla = { address: testnetAssetById("tsla")!.address, kind: "erc20" as const };
    const amzn = { address: testnetAssetById("amzn")!.address, kind: "erc20" as const };

    expect(testnetPoolRouteAllowed(usdg, weth)).toBe(true);
    expect(testnetPoolRouteAllowed(usdg, tsla)).toBe(true);
    expect(testnetPoolRouteAllowed(weth, tsla)).toBe(true);
    expect(testnetSwapPairAllowed(usdg, weth)).toBe(false);
    expect(testnetSwapPairAllowed(usdg, tsla)).toBe(false);
    expect(testnetSwapPairAllowed(OTF_A, usdg)).toBe(true);
    expect(testnetSwapPairAllowed(OTF_A, weth)).toBe(true);
    expect(testnetSwapPairAllowed(OTF_A, OTF_B)).toBe(true);
    expect(testnetSwapPairAllowed(tsla, amzn)).toBe(false);
    expect(testnetSwapPairAllowed(OTF_A, tsla)).toBe(false);
  });

  it("keeps production discovery chain-aware and informational", () => {
    expect(productionAssetsForChain(4663).map((asset) => asset.symbol)).toEqual(["USDG", "WETH"]);
    expect(productionAssetsForChain(46630)).toEqual([]);
  });

  it("registers the protocol OTF and every testnet fund constituent as verified", () => {
    const verifiedTestnetAddresses = verifiedAssets
      .filter((asset) => asset.chainId === 46630)
      .map((asset) => asset.tokenAddress.toLowerCase());
    expect(verifiedTestnetAddresses).toContain("0x568133fa261d979e0e24c2e81bde2fac9b8a3842");
    expect(testnetFundAssets.every((asset) => (
      verifiedTestnetAddresses.includes(asset.address.toLowerCase())
    ))).toBe(true);
  });
});
