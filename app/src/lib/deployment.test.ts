import { describe, expect, it } from "vitest";
import {
  robinhoodTestnetAddresses,
  robinhoodTestnetV4,
  robinhoodTestnetV4AdapterReady,
} from "./deployment";

describe("Robinhood Testnet V4 deployment", () => {
  it("loads the deployed approved adapter and its immutable venue dependencies", () => {
    expect(robinhoodTestnetV4AdapterReady).toBe(true);
    expect(robinhoodTestnetAddresses.uniswapV4Adapter).toBe(
      "0x0e7551e31fBBfbfE11eA4abEb68cDCe4FD6B4ADe",
    );
    expect(robinhoodTestnetV4).toEqual({
      poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
      stateView: "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b",
      universalRouter: "0x8876789976dEcBfCbBbe364623C63652db8C0904",
      permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    });
  });
});
