import { describe, expect, it } from "vitest";
import { registryFixture } from "../test/registry-fixture";
import { mainnetStockAssetsFromRobinhood as select } from "./mainnet-creation-assets";

const mainnetStockAssetsFromRobinhood = (payload: unknown) => select(payload, registryFixture.assets);
const stock = registryFixture.assets.filter(asset=>asset.chainId===4663).find((asset) => asset.symbol === "TSLA")!;
const row = {
  tokenSymbol: stock.symbol, tokenDecimals: stock.decimals, status: "ASSET_STATUS_ACTIVE",
  currentMultiplier: "1.000000000000000000",
  deployments: [{ chainId: 4663, contractAddress: stock.address.toLowerCase() }],
};
describe("mainnet stock identity selection", () => {
  it("matches a configured stock using its chain and address", () => {
    expect(mainnetStockAssetsFromRobinhood({ assets: [row, row] })).toEqual([stock]);
  });
  it.each([
    { deployments: [{ chainId: 46630, contractAddress: stock.address }] },
    { deployments: [{ chainId: 4663, contractAddress: "0x0000000000000000000000000000000000000001" }] },
    { tokenDecimals: 6 }, { tokenSymbol: "FAKE" }, { status: "ASSET_STATUS_INACTIVE" },
    { currentMultiplier: "2" }, { currentMultiplier: "invalid" },
  ])("rejects an identity or pricing mismatch: %j", (override) => {
    expect(mainnetStockAssetsFromRobinhood({ assets: [{ ...row, ...override }] })).toEqual([]);
  });
  it("rejects an unavailable or malformed upstream list", () => {
    for (const payload of [null, {}, [], { assets: [null, "bad"] }]) expect(mainnetStockAssetsFromRobinhood(payload)).toEqual([]);
  });
});
