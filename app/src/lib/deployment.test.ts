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
    expect(robinhoodTestnetRewardsDeploymentBlock).toBe(113815096n);
    expect(robinhoodTestnetRewardsDeployedAtMs).toBe(Date.parse("2026-09-06T01:39:33.000Z"));
    expect(robinhoodTestnetAddresses).toMatchObject({
      otfToken: "0xae3803B6A46f83C834aC17512F91D21657097199",
      launchManager: "0x2b7CDE853CC18bcb862500E8ff80F329e4932840",
      launchRouter: "0xb081Eb9A894e5a260A8249788300FB1A7fC23A67",
      teamVesting: "0xCbb8B26A2e9A5A4F06Be219938C8Ac1593995b7C",
      buybackCollector: "0xf13236dC41492219eFBb094a1E6cb6874dfc6AB8",
      merkleRewardsDistributor: "0x6bE4F6132aA4253C173fCB4FE2313d13A37ce09D",
      ethUsdOracle: "0x951FC808673648D231B9f64F72DB082196EA24a2",
      vaultImplementation: "0x0f9DF04b356935c55B15EC10a05Fd8AC88be4336",
      factory: "0xd5725B9b668ae1ab8Cf42e4F1B3c989CBc14a2E5",
      entryRouter: "0x66fA0cEd11Db9bA9771F420e330F1Eeb0597F8A1",
      uniswapV3Adapter: "0x36751BB8A97cd1Daaf012F3d959f4C4f44b15bC4",
      uniswapV4Adapter: "0x04A5A84A9ffB21Dd7B83fBB71ccD247ea7CaeEcc",
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
