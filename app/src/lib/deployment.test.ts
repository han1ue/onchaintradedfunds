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
    expect(robinhoodTestnetRewardsDeploymentBlock).toBe(114443841n);
    expect(robinhoodTestnetRewardsDeployedAtMs).toBe(Date.parse("2026-09-06T23:21:38.000Z"));
    expect(robinhoodTestnetAddresses).toMatchObject({
      otfToken: "0xE59E6BF7147aE8416f858976dDe232a0C157FDcF",
      launchManager: "0xdA7a65Cb40614757E5775e908a3F4362166Ca840",
      launchRouter: "0xc420BEB2F282b642537aebfF3b9a55449b9A7a1d",
      teamVesting: "0xAe72704981f05Dd9f0Ade36B3153AedF363876D4",
      buybackCollector: "0x0159f5D44Dcba7353569363b3CeE7e660a7B637F",
      merkleRewardsDistributor: "0x031d7F8F1A347D82bd6CB3B224511242753b9ec1",
      ethUsdOracle: "0x5482C1889F84740789555Ce8C80d926b22920f72",
      vaultImplementation: "0xff01Ccc3363c983FCC67C16B0A4c8d484A298979",
      factory: "0x890aB1daCA039a710Ad8486559730C8190393066",
      entryRouter: "0x8e27e50D05268f0f678c576BC5C71ED90Da257C5",
      uniswapV3Adapter: "0x7eBE70026f795FE9b3e83fF6f6D01a902EF1D980",
      uniswapV4Adapter: "0xbfDf3F1fD7E8723B21110f612aC5E094d39Cd8Dc",
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
