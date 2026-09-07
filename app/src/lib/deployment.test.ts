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
    expect(robinhoodTestnetRewardsDeploymentBlock).toBe(114481818n);
    expect(robinhoodTestnetRewardsDeployedAtMs).toBe(Date.parse("2026-09-07T00:36:45.000Z"));
    expect(robinhoodTestnetAddresses).toMatchObject({
      otfToken: "0xb7d7E8f195157e2245CAE026C33e42E4A0b2Ddc7",
      launchManager: "0x0D7c5403ad3a2097047ebfa2ADEDfb169C4CE840",
      launchRouter: "0xd7A8BB26298f37D1a13b98d1455304Bf56d09A41",
      teamVesting: "0xd2b23169Be167Ba4F88745c4df50D2583dCFe761",
      buybackCollector: "0x792D554c922E0059a5499902B8dc3379Bf416275",
      merkleRewardsDistributor: "0x884FA6633483F96F929c273e2daB66D9Fd2611eB",
      ethUsdOracle: "0x5BfCdE934E15FE07343DE59f1056E6f6c1E8c453",
      vaultImplementation: "0x98739eF9da548Ab9014fb9e504E83FBdd8f8c86A",
      factory: "0xf31aea7d37343dFfd0a6fD932B3c11c7DedADd17",
      entryRouter: "0x8de5BE1d880248c54B1C4454c02d5A7163Ed1674",
      uniswapV3Adapter: "0x6F9f2bc9424Ce59c055E12Bc43838fc1B9e379E7",
      uniswapV4Adapter: "0x7766eE7F1EcaCE684feb3E4c80209C371D36B40F",
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
