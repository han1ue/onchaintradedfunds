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
  it("enables protocol access for the deployed contracts", () => {
    expect(robinhoodTestnetDeploymentReady).toBe(true);
    expect(robinhoodTestnetV4AdapterReady).toBe(true);
    expect(robinhoodTestnetNativeEntryReady).toBe(true);
    expect(robinhoodTestnetRewardsDeploymentBlock).toBe(112626576n);
    expect(robinhoodTestnetRewardsDeployedAtMs).toBe(Date.parse("2026-09-04T02:13:00.000Z"));
    expect(robinhoodTestnetAddresses).toMatchObject({
      otfToken: "0xdaB5d0511bf6e6E7D53047C321FF7cCDD030B5EA",
      launchManager: "0x1BEDC53a5F3B4F0d0D1ED219b5BC80AC1D4eE040",
      launchRouter: "0x1baeD75C0549c7473ad403D09806D10a51882C9E",
      teamVesting: "0x2bbF6E2584E4c30255FF9E0D857d34e087e4dB68",
      buybackCollector: "0x0959BcE1ABA02005120Fb8D9c4cF100341aE6c07",
      merkleRewardsDistributor: "0xA92283015943b586f733A7C5038C6a5575271ed0",
      ethUsdOracle: "0xFAB1bAa3b0f80a64E60BE85006216784836F1531",
      vaultImplementation: "0x0FA559C1b98988E58af1A671bcA145a26881da51",
      factory: "0x4Ef9a30b0949269eA80d768fb493DFfecd028Bd1",
      entryRouter: "0xFc4706E8C63bD3fc9126461A1aF6Fbf8233d77E4",
      uniswapV3Adapter: "0xC06f5f07A47B93D9Ae3E69d55bf16BfC1c8086CD",
      uniswapV4Adapter: "0xD8201a3D9DA949a198ecb8eB3fA7bfF3944Ec66a",
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
