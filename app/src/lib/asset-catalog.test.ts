import { describe, expect, it } from "vitest";
import { assetCatalog, fundAssetsVerified, testnetSwapPairAllowed } from "./asset-catalog";
import { registryFixture, testnetAssetById, testnetFundAssets, testnetPools, testnetQuoteAssets } from "../test/registry-fixture";
import { registeredCandidates } from "./registered-routes";

describe("database registry projections", () => {
  it("preserves quote rails, constituents and the imported verification decisions", () => {
    expect(testnetQuoteAssets.map(a=>[a.symbol,a.decimals])).toEqual([["USDG",6],["WETH",18]]);
    expect(testnetFundAssets.map(a=>a.symbol)).toEqual(["TSLA","AMZN","PLTR","NFLX","AMD"]);
    expect(testnetPools).toHaveLength(6);
    expect(registryFixture.assets.filter(a=>a.verified)).toHaveLength(6);
    expect(testnetQuoteAssets.every(a=>!a.verified)).toBe(true);
    expect(fundAssetsVerified(registryFixture,46630,testnetFundAssets.map(a=>a.address))).toBe(true);
    expect(fundAssetsVerified(registryFixture,4663,testnetFundAssets.map(a=>a.address))).toBe(false);
  });
  it("keeps verification separate from pool approval and filters disabled assets", () => {
    const registry=structuredClone(registryFixture);
    registry.assets.find(a=>a.chainId===46630 && a.id==="tsla")!.verified=false;
    expect(assetCatalog(registry,46630).pools).toHaveLength(6);
    registry.assets.find(a=>a.chainId===46630 && a.id==="tsla")!.enabled=false;
    expect(assetCatalog(registry,46630).assets.some(a=>a.id==="tsla")).toBe(false);
    expect(assetCatalog(registry,46630).pools).toHaveLength(5);
  });
  it("supports competing pools but never discovers share pools", () => {
    const weth=testnetAssetById("weth")!.address,usdg=testnetAssetById("usdg")!.address;
    const pool=testnetPools.find(p=>p.id.endsWith(":weth-usdg"))!;
    const competing={...pool,id:"second-weth-usdg",fee:3000};
    expect(registeredCandidates([pool,competing],46630,weth,usdg,weth)).toHaveLength(2);
    expect(registeredCandidates([pool,competing],4663,weth,usdg,weth)).toHaveLength(0);
    expect(registeredCandidates([pool],46630,weth,"0x00000000000000000000000000000000000000f1",weth)).toHaveLength(0);
    expect(testnetSwapPairAllowed({address:weth,kind:"erc20"},{address:usdg,kind:"erc20"})).toBe(false);
  });
});
