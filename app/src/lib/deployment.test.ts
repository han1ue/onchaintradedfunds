import { describe, expect, it } from "vitest";
import {
  robinhoodMainnetAddresses,
  robinhoodTestnetAddresses,
  robinhoodTestnetDeploymentReady,
  robinhoodTestnetNativeEntryReady,
  robinhoodTestnetV4,
  robinhoodTestnetV4AdapterReady,
} from "./deployment";

describe("Robinhood Testnet V4 deployment", () => {
  it("keeps protocol access disabled while no contracts are deployed", () => {
    expect(robinhoodTestnetDeploymentReady).toBe(false);
    expect(robinhoodTestnetV4AdapterReady).toBe(false);
    expect(robinhoodTestnetNativeEntryReady).toBe(false);
    expect(robinhoodTestnetAddresses.otfToken).toBeUndefined();
    expect(robinhoodTestnetAddresses.launchManager).toBeUndefined();
    expect(robinhoodTestnetAddresses.buybackCollector).toBeUndefined();
    expect(robinhoodTestnetV4).toEqual({
      poolManager: "0x949257d5181128a7c793619b922e47B849cb81e6",
      stateView: "0x585906972e2C513cbbc97d9C159f27Df9daf3A21",
      quoter: "0x35587Cd9Aee64Fe364438bBfD68033CA6aEC6906",
      universalRouter: "0x5274B13F0B60425f403A84Dc85b58951E880664c",
      positionManager: "0xF839356eA23e6799972C3685f5c7B60158e4e96d",
      permit2: "0xA03bd7D6d7193051dB730AaD27BF25E46570c43F",
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
