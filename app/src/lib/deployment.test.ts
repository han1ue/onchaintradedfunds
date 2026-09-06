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
    expect(robinhoodTestnetRewardsDeploymentBlock).toBe(113870130n);
    expect(robinhoodTestnetRewardsDeployedAtMs).toBe(Date.parse("2026-09-06T03:38:31.000Z"));
    expect(robinhoodTestnetAddresses).toMatchObject({
      otfToken: "0xFcCd7bd300d7Fe0eC27E9FfB34714Ad865d3b78C",
      launchManager: "0x494b5C992c9EDf17Aa528A9c1e09eEF1d681a840",
      launchRouter: "0x13f8d52F2058DF6D822eE947EEdf8698642f10dC",
      teamVesting: "0x3c79fD40bCb54dF252Ccb59329602888bd6a154C",
      buybackCollector: "0xDEb1E18Cfc44ab2F7057e0375d757973331D86E5",
      merkleRewardsDistributor: "0xd85347799e41B848e6BD955F717b610f26fB4FB3",
      ethUsdOracle: "0xb7A98e5A7B4f27e2A33862cfCDB2005022dc3011",
      vaultImplementation: "0x65a821220213ca78A1A4ABdA767f511e0AC56351",
      factory: "0x39b189630D74c29e680930f2D2C8E0deb89cE738",
      entryRouter: "0x3DEFb0ABeb7081B36f7421601e1689c5EA8aaE10",
      uniswapV3Adapter: "0x38051b37D196C201745cE0189De92B50a69eD3f7",
      uniswapV4Adapter: "0x697bfFa6FAdBffb85D4EA430a0Be0A2d14875848",
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
