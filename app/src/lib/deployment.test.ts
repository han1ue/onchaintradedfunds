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
    expect(robinhoodTestnetRewardsDeploymentBlock).toBe(113198427n);
    expect(robinhoodTestnetRewardsDeployedAtMs).toBe(Date.parse("2026-09-05T02:47:25.000Z"));
    expect(robinhoodTestnetAddresses).toMatchObject({
      otfToken: "0x568133FA261D979e0E24C2e81bdE2fAC9b8A3842",
      launchManager: "0x8DcC4a7F668155262A72a3a6FcF80a0d4616a040",
      launchRouter: "0x9eDFF402f7f51B9fCb0B2C64cCA2edD0100C717F",
      teamVesting: "0x7ED373E7b1464F819aaF796b0b41314FBE2c2BdA",
      buybackCollector: "0x3401E6d4EA0982e36FCA57c544Dc0365Bf51052E",
      merkleRewardsDistributor: "0x00D3dA9228Fec76a794E614f3dc77630CE1a17e6",
      ethUsdOracle: "0xC233b05f217c26E6F2de67d540D13Ce64aB671e1",
      vaultImplementation: "0xf76a768F8b3e39CB1Bc7dcbf07BaA5CDe6c8fD13",
      factory: "0xBbC0bfaF8AD273A11420c586860b27e7DB5f9093",
      entryRouter: "0x88a8c94f0eCb600ce980cAAEefD9eC68c7c95614",
      uniswapV3Adapter: "0xF4263c38E09e2d59Eb7af5fE25abB0e2088e8D6E",
      uniswapV4Adapter: "0x000D3ccc2Da8b2dcBC326E274Ed7d735dBBb631C",
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
