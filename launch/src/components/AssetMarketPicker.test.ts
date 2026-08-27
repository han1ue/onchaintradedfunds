import { describe, expect, it } from "vitest";
import type { AssetRegistryEntry } from "@/lib/types";
import { selectableRegistryAssetForAddress } from "./AssetMarketPicker";

const AMD: AssetRegistryEntry = {
  id: "asset-amd",
  symbol: "AMD",
  name: "Advanced Micro Devices",
  contractAddress: "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC",
  network: "robinhood-mainnet",
  chainId: 4663,
  decimals: 18,
  verified: true,
  priceSource: "robinhood-bid",
  latestPriceUsd: null,
  latestPriceAt: null,
  pricingConfigs: [],
  markets: [],
};

describe("manual asset registry resolution", () => {
  it("resolves a verified token address case-insensitively instead of treating it as unlisted", () => {
    expect(selectableRegistryAssetForAddress([AMD], AMD.contractAddress.toLowerCase())).toBe(AMD);
  });
});
