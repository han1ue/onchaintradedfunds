import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { getMainnetRoutingBlockNumber, mainnetRehearsalDependencies, verifyMainnetRoutingRuntime } from "./mainnet-routing.mjs";

const { keccak256 } = createRequire(new URL("../../app/package.json", import.meta.url))("viem");
const pin = JSON.parse(readFileSync(new URL("../fixtures/robinhood-mainnet-routing.json", import.meta.url)));
const rehearsal = JSON.parse(readFileSync(new URL("../fixtures/robinhood-mainnet-rehearsal.json", import.meta.url)));

test("pins the oracle implementation and every real stock market", () => {
  const dependencies = mainnetRehearsalDependencies(rehearsal);
  assert.equal(Object.keys(dependencies).length, 15);
  assert.equal(dependencies.ethUsdAggregator.address, rehearsal.oracle.aggregator.address);
  for (const [index, stock] of rehearsal.stocks.entries()) {
    assert.equal(dependencies[`stock${index}`].address, stock.address);
    assert.equal(dependencies[`stock${index}UsdgPool`].address, stock.pool.address);
  }
  assert.throws(() => mainnetRehearsalDependencies({ ...rehearsal, chainId: 46630 }), /mainnet/);
  assert.throws(() => mainnetRehearsalDependencies({ ...rehearsal, stocks: [] }), /five/);
});
const runtime = "0x6000";
const fixture = {
  ...pin,
  dependencies: Object.fromEntries(Object.entries(pin.dependencies).map(([name, dependency]) =>
    [name, { ...dependency, codehash: keccak256(runtime) }])),
};
const blockNumber = BigInt(pin.blockNumber);
const client = {
  getChainId: async () => 4663,
  getBlock: async (args) => {
    assert.equal(args.blockNumber, blockNumber);
    return { number: blockNumber, hash: pin.blockHash };
  },
  getCode: async (args) => { assert.equal(args.blockNumber, blockNumber); return runtime; },
};

test("selects one recent block without caching the head", async () => {
  assert.equal(await getMainnetRoutingBlockNumber({ getBlockNumber: async (options) => {
    assert.equal(options.cacheTime, 0);
    return 1000n;
  } }), 936n);
});

test("preserves an explicit replay block without querying the tip", async () => {
  assert.equal(await getMainnetRoutingBlockNumber({ getBlockNumber: async () => assert.fail() }, blockNumber), blockNumber);
});

test("checks mainnet runtimes and block identity at the selected height", async () => {
  const checked = [];
  await verifyMainnetRoutingRuntime({ ...client, getCode: async (args) => {
    checked.push(args.address);
    return client.getCode(args);
  } }, fixture, blockNumber);
  assert.deepEqual(checked.sort(), Object.values(fixture.dependencies).map((d) => d.address).sort());
});

test("rejects a testnet RPC or fixture", async () => {
  await assert.rejects(verifyMainnetRoutingRuntime({ ...client, getChainId: async () => 46630 }, fixture, blockNumber), /chain 4663/);
  await assert.rejects(verifyMainnetRoutingRuntime(client, { ...fixture, chainId: 46630 }, blockNumber), /chain 4663/);
});

test("rejects a missing dependency or unpinned runtime", async () => {
  const changed = structuredClone(fixture);
  delete changed.dependencies.permit2;
  await assert.rejects(verifyMainnetRoutingRuntime(client, changed, blockNumber), /Missing.*permit2/);
  changed.dependencies.permit2 = { address: pin.dependencies.permit2.address };
  await assert.rejects(verifyMainnetRoutingRuntime(client, changed, blockNumber), /Missing.*permit2/);
});

test("rejects a changed reference block before reading bytecode", async () => {
  await assert.rejects(verifyMainnetRoutingRuntime({ ...client,
    getBlock: async () => ({ number: blockNumber, hash: `0x${"00".repeat(32)}` }),
    getCode: async () => assert.fail("Must reject the block before checking runtimes"),
  }, fixture, blockNumber), /block hash mismatch/);
});

test("rejects missing or changed runtime bytecode", async () => {
  for (const code of [undefined, "0x", "0x00"]) {
    await assert.rejects(verifyMainnetRoutingRuntime({ ...client, getCode: async () => code }, fixture, blockNumber), /runtime differs/);
  }
});

test("allows an explicit later block but still checks the pinned runtimes", async () => {
  const laterBlock = blockNumber + 1n;
  await verifyMainnetRoutingRuntime({ ...client,
    getBlock: async ({ blockNumber }) => ({ number: blockNumber, hash: `0x${"11".repeat(32)}` }),
    getCode: async (args) => { assert.equal(args.blockNumber, laterBlock); return runtime; },
  }, fixture, laterBlock);
});

test("retries transient RPC state errors at the same pinned block", async () => {
  let calls = 0;
  await verifyMainnetRoutingRuntime({ ...client, getCode: async (args) => {
    assert.equal(args.blockNumber, blockNumber);
    if (++calls === 1) throw Object.assign(new Error("RPC state unavailable"), { details: "metadata is not found" });
    return runtime;
  } }, fixture, blockNumber);
  assert.equal(calls, Object.keys(fixture.dependencies).length + 1);
});

test("does not retry unrelated RPC errors", async () => {
  let calls = 0;
  const error = Object.assign(new Error("Invalid RPC request"), { details: "invalid argument" });
  await assert.rejects(verifyMainnetRoutingRuntime({ ...client, getBlock: async () => {
    calls++;
    throw error;
  } }, fixture, blockNumber), (caught) => caught === error);
  assert.equal(calls, 1);
});
