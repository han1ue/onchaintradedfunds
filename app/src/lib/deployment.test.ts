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
    expect(robinhoodTestnetRewardsDeploymentBlock).toBe(113608985n);
    expect(robinhoodTestnetRewardsDeployedAtMs).toBe(Date.parse("2026-09-05T18:13:48.000Z"));
    expect(robinhoodTestnetAddresses).toMatchObject({
      otfToken: "0xDdc627874CA2B28F13031B31C45E9d5ea7A705ab",
      launchManager: "0xdeAdc1F7542f404A8548AF28659771c1ebbFa840",
      launchRouter: "0x19f05c04Ddfa4a6138E6537031f51Bd8Cb9E1fb6",
      teamVesting: "0x048b33F6469D8A0A439E6D5d9BBD36db61E30BfB",
      buybackCollector: "0xFE4e62782AEDe67Dc0C4e0c9BcDbDa4769e08BbC",
      merkleRewardsDistributor: "0xBc1be2e0Cce2F48485e801d7188FC6D633EaFc8B",
      ethUsdOracle: "0xDE1e4B0f8f0B8BD67D51354766fD8D9b48706B67",
      vaultImplementation: "0x59B5923264e22c04CFc57F787ADDD53b48A3D84c",
      factory: "0x7619eB1Ec1302e6f9E1a618D875B05dCF5EcFE34",
      entryRouter: "0xFBeEDD9dA3c34339C513fd9fA6a24AD4B92a9DC2",
      uniswapV3Adapter: "0x8AcBE3dE5d585F2f7BBc1342c103dB1F5077CFa5",
      uniswapV4Adapter: "0x72bB9e0AD6ee8845C13749BD7F8D1b27033B6Ba4",
    });
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
