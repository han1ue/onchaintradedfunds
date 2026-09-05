import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { assertTestnetRoutingConfiguration, getTestnetRoutingBlock, verifyTestnetRoutingRuntime } from "./testnet-routing.mjs";

const { keccak256 } = createRequire(new URL("../../app/package.json", import.meta.url))("viem");
const config = JSON.parse(readFileSync(new URL("../../app/src/config/robinhood-testnet.json", import.meta.url)));
const pin = JSON.parse(readFileSync(new URL("../fixtures/robinhood-testnet-routing.json", import.meta.url)));

test("accepts the pinned testnet configuration", () => {
  assert.doesNotThrow(() => assertTestnetRoutingConfiguration(config, pin));
});

test("rejects an unvalidated replacement router", () => {
  const changed = structuredClone(config);
  changed.externalContracts.uniswapUniversalRouter = changed.externalContracts.uniswapV4PoolManager;
  assert.throws(() => assertTestnetRoutingConfiguration(changed, pin), /uniswapUniversalRouter differs/);
});

test("rejects a changed encoding or chain", () => {
  const changed = structuredClone(pin);
  changed.universalRouterSource.exactInputParams.splice(2, 0, "uint256[] maxHopSlippage;");
  assert.throws(() => assertTestnetRoutingConfiguration(config, changed), /four-field/);
  assert.throws(() => assertTestnetRoutingConfiguration({ ...config, chainId: 4663 }, pin), /chain 46630/);
});

test("rejects missing or changed deployed bytecode", async () => {
  await assert.rejects(verifyTestnetRoutingRuntime({ getChainId: async () => 46630, getCode: async () => "0x00" }, config, pin), /runtime differs/);
});

test("selects a recent block behind the tip without caching the head", async () => {
  const block = await getTestnetRoutingBlock({
    getBlockNumber: async (options) => { assert.equal(options.cacheTime, 0); return 1000n; },
    getBlock: async ({ blockNumber }) => { assert.equal(blockNumber, 936n); return { number: blockNumber }; },
  });
  assert.equal(block.number, 936n);
});

test("does not subtract the block margin from an explicit fork block", async () => {
  const block = await getTestnetRoutingBlock({
    getBlockNumber: async () => assert.fail("Explicit blocks must not query the tip"),
    getBlock: async ({ blockNumber }) => ({ number: blockNumber }),
  }, 1000n);
  assert.equal(block.number, 1000n);
});

test("does not select a negative block on a new chain", async () => {
  const block = await getTestnetRoutingBlock({
    getBlockNumber: async () => 10n,
    getBlock: async ({ blockNumber }) => ({ number: blockNumber }),
  });
  assert.equal(block.number, 0n);
});

test("retries an unavailable block header at the same height", async () => {
  let calls = 0;
  const block = await getTestnetRoutingBlock({
    getBlock: async ({ blockNumber }) => {
      assert.equal(blockNumber, 1000n);
      if (++calls === 1) throw Object.assign(new Error("RPC request failed"), { details: "unsupported block number 1000" });
      return { number: blockNumber };
    },
  }, 1000n);
  assert.equal(block.number, 1000n);
  assert.equal(calls, 2);
});

const runtimeCode = "0x6000";
const runtimeHash = keccak256(runtimeCode);
const runtimeConfig = { ...config, expectedCodehashes: { ...config.expectedCodehashes, uniswapV3Weth9: runtimeHash } };
const runtimePin = { ...pin, dependencies: { uniswapV3Weth9: { ...pin.dependencies.uniswapV3Weth9, codehash: runtimeHash } } };

for (const details of ["unsupported block number 1000", "metadata is not found"]) {
  test(`retries transient state errors without changing the runtime-check block: ${details}`, async () => {
    let calls = 0;
    await verifyTestnetRoutingRuntime({
      getChainId: async () => 46630,
      getCode: async ({ blockNumber }) => {
        assert.equal(blockNumber, 1000n);
        if (++calls === 1) throw Object.assign(new Error("RPC request failed"), { details });
        return runtimeCode;
      },
    }, runtimeConfig, runtimePin, 1000n);
    assert.equal(calls, 2);
  });
}

test("still fails when state remains unavailable after five attempts", async () => {
  let calls = 0;
  const error = Object.assign(new Error("RPC request failed"), { details: "unsupported block number 1000" });
  await assert.rejects(verifyTestnetRoutingRuntime({
    getChainId: async () => 46630,
    getCode: async ({ blockNumber }) => { assert.equal(blockNumber, 1000n); calls++; throw error; },
  }, runtimeConfig, runtimePin, 1000n), (caught) => caught === error);
  assert.equal(calls, 5);
});

test("does not retry unrelated RPC errors", async () => {
  let calls = 0;
  const error = Object.assign(new Error("RPC request failed"), { details: "invalid argument 0: invalid address" });
  await assert.rejects(verifyTestnetRoutingRuntime({
    getChainId: async () => 46630,
    getCode: async () => { calls++; throw error; },
  }, runtimeConfig, runtimePin, 1000n), (caught) => caught === error);
  assert.equal(calls, 1);
});

test("still rejects different bytecode after a transient state error", async () => {
  let calls = 0;
  await assert.rejects(verifyTestnetRoutingRuntime({
    getChainId: async () => 46630,
    getCode: async () => {
      if (++calls === 1) throw Object.assign(new Error("RPC request failed"), { details: "unsupported block number 1000" });
      return "0x00";
    },
  }, runtimeConfig, runtimePin, 1000n), /runtime differs/);
  assert.equal(calls, 2);
});
