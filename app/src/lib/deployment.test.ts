import config from "../config/robinhood-testnet.json";
import { describe, expect, it } from "vitest";
import {
  protocolDeploymentForChain,
  robinhoodMainnetAddresses,
  robinhoodTestnetAddresses,
  robinhoodTestnetRewardsDeploymentBlock,
  robinhoodTestnetRewardsDeployedAtMs,
  robinhoodTestnetDeploymentReady,
  robinhoodTestnetNativeEntryReady,
  robinhoodTestnetV4,
} from "./deployment";

describe("Robinhood Testnet Universal Router deployment", () => {
  it("enables routing for the fresh deployment and its approved adapter", () => {
    expect(robinhoodTestnetDeploymentReady).toBe(true);
    expect(robinhoodTestnetNativeEntryReady).toBe(true);
    expect(robinhoodTestnetRewardsDeploymentBlock).toBe(114598826n);
    expect(robinhoodTestnetRewardsDeployedAtMs).toBe(Date.parse("2026-09-07T04:21:42.000Z"));
    expect(robinhoodTestnetAddresses).toMatchObject({
      otfToken: "0x5CbBb475721aD3C4aB61bD241818E6774782DF88",
      launchManager: "0xA5435c7c0e0C105b3687D72307F313EF1F7f2840",
      launchRouter: "0xFFF782973e7AF25a88a482F1F81911eDB378c8e9",
      teamVesting: "0xB79aB3c64C8072Dd2768C6bF40F8DEdEFd002268",
      buybackCollector: config.contracts.buybackCollector.address,
      merkleRewardsDistributor: "0xAe7c1020152E850A94c02e939336C245573467bd",
      ethUsdOracle: "0xBCD4443af58C13797c9a67993AD24E29B925386a",
      vaultImplementation: config.contracts.vaultImplementation.address,
      factory: config.contracts.factory.address,
      entryRouter: config.contracts.entryRouter.address,
      uniswapUniversalRouterAdapter: config.contracts.uniswapUniversalRouterAdapter.address,
    });
    expect(robinhoodTestnetV4).toEqual({
      poolManager: "0x8366a39CC670B4001A1121B8F6A443A643e40951",
      stateView: "0xF3334192D15450CdD385c8B70e03f9A6bD9E673b",
      quoter: "0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94",
      universalRouter: config.externalContracts.uniswapUniversalRouter,
      positionManager: "0x58daec3116aae6D93017bAAea7749052E8a04fA7",
      permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
    });
  });
});

describe("Robinhood mainnet oracle configuration", () => {
  it("keeps undeployed mainnet actions and rewards disabled without borrowing testnet addresses", () => {
    const mainnet = protocolDeploymentForChain(4663)!;
    expect(mainnet.creationReady).toBe(false);
    expect(mainnet.routingReady).toBe(false);
    expect(mainnet.addresses.factory).toBeUndefined();
    expect(mainnet.addresses.otfToken).toBeUndefined();
    expect(mainnet.rewardsDeployedAtMs).toBeUndefined();
    expect(mainnet.addresses.weth).not.toBe(protocolDeploymentForChain(46630)?.addresses.weth);
    expect(protocolDeploymentForChain(46630)?.creationReady).toBe(true);
    expect(protocolDeploymentForChain(1)).toBeUndefined();
  });
  it("uses the onchain-verified ETH/USD AggregatorV3 proxy", () => {
    expect(robinhoodMainnetAddresses.ethUsdOracle).toBe(
      "0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9",
    );
  });
});
