import { describe, expect, it } from "vitest";
import {
  robinhoodMainnetAddresses,
  robinhoodTestnetAddresses,
  robinhoodTestnetRewardsDeploymentBlock,
  robinhoodTestnetRewardsDeployedAtMs,
  robinhoodTestnetDeploymentReady,
  robinhoodTestnetNativeEntryReady,
  robinhoodTestnetV4,
  robinhoodTestnetV4AdapterReady,
} from "./deployment";

describe("Robinhood Testnet V4 deployment", () => {
  it("enables routing for the fresh deployment and its approved adapters", () => {
    expect(robinhoodTestnetDeploymentReady).toBe(true);
    expect(robinhoodTestnetV4AdapterReady).toBe(true);
    expect(robinhoodTestnetNativeEntryReady).toBe(true);
    expect(robinhoodTestnetRewardsDeploymentBlock).toBe(114598826n);
    expect(robinhoodTestnetRewardsDeployedAtMs).toBe(Date.parse("2026-09-07T04:21:42.000Z"));
    expect(robinhoodTestnetAddresses).toMatchObject({
      otfToken: "0x5CbBb475721aD3C4aB61bD241818E6774782DF88",
      launchManager: "0xA5435c7c0e0C105b3687D72307F313EF1F7f2840",
      launchRouter: "0xFFF782973e7AF25a88a482F1F81911eDB378c8e9",
      teamVesting: "0xB79aB3c64C8072Dd2768C6bF40F8DEdEFd002268",
      buybackCollector: "0x86E4B9e08646F576E7Bb364789B708515DD8d69d",
      merkleRewardsDistributor: "0xAe7c1020152E850A94c02e939336C245573467bd",
      ethUsdOracle: "0xBCD4443af58C13797c9a67993AD24E29B925386a",
      vaultImplementation: "0xC6C816FB6a72751B33F71439ef44d471f06DC0EB",
      factory: "0xb4776316FABbC70Aa72976e6E1AB0b4f5e05dAc1",
      entryRouter: "0x347B75576a2D105bE4a13390b5888C339e3D9623",
      uniswapV3Adapter: "0xa82dBD04dE8d266375aB92442279f33A5e327841",
      uniswapV4Adapter: "0x502C85F4652B37c7cde44730283072Cd3b8A582a",
    });
    expect(robinhoodTestnetV4).toEqual({
      poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
      stateView: "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b",
      quoter: "0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94",
      universalRouter: "0x8876789976dEcBfCbBbe364623C63652db8C0904",
      positionManager: "0x58daec3116aae6D93017bAAea7749052E8a04fA7",
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
