import { describe, expect, it } from "vitest";
import {
  configuredTestnetCreationAssets,
  marketCapUsdFromYahoo,
  protocolOtfCreationAsset,
  stockPriceUsdFromYahoo,
} from "./testnet-creation-assets";
import { getAddress } from "viem";

const sourceRows = {
  data: ["TSLA", "AMZN", "PLTR", "NFLX", "AMD"].map((symbol, index) => ({
    chainId: 4_663,
    contractAddress: `0x${String(index + 1).padStart(40, "0")}`,
    decimals: 18,
    symbol,
    name: symbol,
    verified: true,
    latestPriceUsdExact: `${100 + index}.25`,
    latestPriceAt: "2026-08-31T00:00:00.000Z",
    marketCapUsd: null,
  })),
};

describe("configured Robinhood testnet creation assets", () => {
  it("aliases current stock data onto the five configured testnet token addresses", () => {
    const marketCaps = Object.fromEntries(
      ["TSLA", "AMZN", "PLTR", "NFLX", "AMD"].map((symbol, index) => [symbol, `${index + 1}000000000`]),
    );
    const assets = configuredTestnetCreationAssets(sourceRows, marketCaps);

    expect(assets.map((asset) => asset.symbol)).toEqual(["TSLA", "AMZN", "PLTR", "NFLX", "AMD"]);
    expect(assets.map((asset) => asset.address)).toEqual([
      "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E",
      "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02",
      "0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0",
      "0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93",
      "0x71178BAc73cBeb415514eB542a8995b82669778d",
    ]);
    expect(assets[0]).toEqual(expect.objectContaining({ priceUsd: "100.25", marketCapUsd: "1000000000" }));
  });

  it("reads the newest trailing market cap and falls back to quarterly data", () => {
    expect(marketCapUsdFromYahoo({ timeseries: { result: [{
      meta: { type: ["trailingMarketCap"] },
      trailingMarketCap: [
        { reportedValue: { raw: 100 } },
        { reportedValue: { raw: 125 } },
      ],
    }] } })).toBe("125");
    expect(marketCapUsdFromYahoo({ timeseries: { result: [{
      meta: { type: ["quarterlyMarketCap"] },
      quarterlyMarketCap: [{ reportedValue: { raw: "90.5" } }],
    }] } })).toBe("90.5");
  });

  it("reads a current Yahoo chart price and timestamp", () => {
    expect(stockPriceUsdFromYahoo({ chart: { result: [{ meta: {
      regularMarketPrice: 376.37,
      regularMarketTime: 1_788_220_800,
    } }] } })).toEqual({
      priceUsd: "376.37",
      priceUpdatedAt: "2026-09-01T00:00:00.000Z",
    });
    expect(stockPriceUsdFromYahoo({ chart: { result: null } })).toBeUndefined();
  });

  it("builds the protocol OTF constituent from current onchain values", () => {
    expect(protocolOtfCreationAsset({
      address: getAddress("0xdaB5d0511bf6e6E7D53047C321FF7cCDD030B5EA"),
      priceWethWad: 20_000_000_000n,
      ethUsdAnswer: 350_000_000_000n,
      totalSupply: 1_000_000_000n * 10n ** 18n,
    })).toEqual(expect.objectContaining({
      symbol: "OTF",
      priceUsd: "0.00007",
      marketCapUsd: "70000",
      decimals: 18,
      verified: true,
    }));
  });
});
