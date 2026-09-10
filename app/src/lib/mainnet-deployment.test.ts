import { afterEach, describe, expect, it, vi } from "vitest";
import config from "../config/robinhood-mainnet.json";

const contracts = Object.fromEntries([
  "factory", "entryRouter", "uniswapUniversalRouterAdapter", "otfToken", "launchManager",
  "launchRouter", "teamVesting", "buybackCollector", "merkleRewardsDistributor", "vaultImplementation",
].map((name, index) => [name, { address: `0x${(index + 1).toString(16).padStart(40, "0")}` }]));

async function deployment(overrides: Record<string, unknown> = {}) {
  vi.resetModules();
  vi.doMock("../config/robinhood-mainnet.json", () => ({ default: {
    ...config, protocolStatus: "deployed", protocolContracts: contracts,
    routing: { status: "ready", approvedAdapters: [contracts.uniswapUniversalRouterAdapter.address] },
    ...overrides,
  } }));
  return (await import("./deployment")).protocolDeploymentForChain(4663)!;
}
afterEach(() => { vi.doUnmock("../config/robinhood-mainnet.json"); vi.resetModules(); });

describe("mainnet activation manifest", () => {
  it("selects deployed mainnet contracts and the approved adapter", async () => {
    const selected = await deployment();
    expect(selected.creationReady).toBe(true);
    expect(selected.routingReady).toBe(true);
    expect(selected.addresses.factory).toBe(contracts.factory.address);
    expect(selected.addresses.launchRouter).toBe(contracts.launchRouter.address);
    expect(selected.v4.quoter).toBe(config.externalContracts.uniswapV4Quoter);
  });
  it.each(["otfToken", "launchManager"])("requires %s before enabling canonical OTF basket routing", async (name) => {
    const partial = { ...contracts };
    delete partial[name];
    expect((await deployment({ protocolContracts: partial })).routingReady).toBe(false);
  });
  it("requires the V4 quoter before enabling routing", async () => {
    const selected = await deployment({ externalContracts: { ...config.externalContracts, uniswapV4Quoter: undefined } });
    expect(selected.routingReady).toBe(false);
  });
  it("withholds contract addresses before deployment and actions before adapter approval", async () => {
    const pending = await deployment({ protocolStatus: "not-deployed" });
    expect(pending.addresses.factory).toBeUndefined();
    expect(pending.routingReady).toBe(false);
    const partial = await deployment({ routing: { status: "ready", approvedAdapters: [] } });
    expect(partial.creationReady).toBe(false);
    expect(partial.routingReady).toBe(false);
  });
  it("requires the mainnet rewards block and timestamp rather than a testnet schedule", async () => {
    expect((await deployment()).rewardsDeployedAtMs).toBeUndefined();
    const timestamp = "2026-10-01T12:00:00.000Z";
    const selected = await deployment({ protocolContracts: { ...contracts,
      merkleRewardsDistributor: { ...contracts.merkleRewardsDistributor, blockNumber: "60000000", blockTimestamp: timestamp },
    } });
    expect(selected.rewardsDeployedAtMs).toBe(Date.parse(timestamp));
  });
});
