import { describe, expect, it } from "vitest";
import {
  robinhoodMainnetAddresses,
  robinhoodTestnetAddresses,
  robinhoodTestnetV4,
  robinhoodTestnetV4AdapterReady,
} from "./deployment";

describe("Robinhood Testnet V4 deployment", () => {
  it("rejects the superseded testnet deployment while preserving verified mirror dependencies", () => {
    expect(robinhoodTestnetV4AdapterReady).toBe(false);
    expect(robinhoodTestnetAddresses.uniswapV4Adapter).toBeUndefined();
    expect(robinhoodTestnetV4).toEqual({
      poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
      stateView: "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b",
      universalRouter: "0x8876789976dEcBfCbBbe364623C63652db8C0904",
      positionManager: undefined,
      permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    });
  });
});

describe("Robinhood mainnet oracle configuration", () => {
  it("uses the onchain-verified ETH/USD AggregatorV3 proxy", () => {
    expect(robinhoodMainnetAddresses.ethUsdOracle).toBe(
      "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9",
    );
  });
});
