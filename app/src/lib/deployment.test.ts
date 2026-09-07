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
    expect(robinhoodTestnetRewardsDeploymentBlock).toBe(114586061n);
    expect(robinhoodTestnetRewardsDeployedAtMs).toBe(Date.parse("2026-09-07T03:57:13.000Z"));
    expect(robinhoodTestnetAddresses).toMatchObject({
      otfToken: "0x5C4596210A4264888c998242D2c8A4DE52da8BB3",
      launchManager: "0x72b83e9507a3fc3FE720B6b01267b3409379E840",
      launchRouter: "0xb20411678cEAD7ca99F46b2F9086c821ECf6Cc14",
      teamVesting: "0x59188Df426C4d84bA2091E74A86bcACd9aa2Eb43",
      buybackCollector: "0x66686A6C0a8F13b869E7Ac5f43fE9d4A19465903",
      merkleRewardsDistributor: "0x4DBE1500A068a27C07E21d55a467f4635322B60E",
      ethUsdOracle: "0xdE9a6BBe8E55D66cB89EeEB4E42915165DB21F4b",
      vaultImplementation: "0x3e676A27AaEd549081eF10184344Ca420E53d682",
      factory: "0xd7a720fcA84A824b8065b5F792052D95C5E3fb6B",
      entryRouter: "0x306f036164A2ff04604d964daB9d35554be3dABF",
      uniswapV3Adapter: "0x9cABBAC0074b04C39F97e9406e574c067C47dA51",
      uniswapV4Adapter: "0x87f9de2D7f3E0b6CA931Db53949cc8ef647e628C",
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
