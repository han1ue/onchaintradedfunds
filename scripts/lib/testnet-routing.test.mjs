import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { compileUniversalRouter, v3PoolInitCodeHash } from "./universal-router.mjs";
import { assertTestnetDeploymentEncoding, assertTestnetRoutingConfiguration, verifyTestnetRoutingRuntime } from "./testnet-routing.mjs";

const { keccak256 } = createRequire(new URL("../../app/package.json", import.meta.url))("viem");
const config = JSON.parse(readFileSync(new URL("../../app/src/config/robinhood-testnet.json", import.meta.url)));
const pin = JSON.parse(readFileSync(new URL("../fixtures/robinhood-testnet-routing.json", import.meta.url)));

test("accepts the canonical deployment encoding", () => {
  assert.doesNotThrow(() => assertTestnetDeploymentEncoding(pin));
});

test("accepts the pinned testnet configuration", () => {
  assert.doesNotThrow(() => assertTestnetRoutingConfiguration(config, pin));
});

test("rejects an unvalidated replacement router", () => {
  const changed = structuredClone(config);
  changed.externalContracts.uniswapUniversalRouter = changed.externalContracts.uniswapV4PoolManager;
  assert.throws(() => assertTestnetRoutingConfiguration(changed, pin), /uniswapUniversalRouter differs/);
});

test("rejects a changed encoding or chain", () => {
  assert.throws(() => assertTestnetDeploymentEncoding({ ...pin, chainId: 1 }), /chain/);
  assert.throws(() => assertTestnetRoutingConfiguration({ ...config, chainId: 4663 }, pin), /chain 46630/);
});

test("rejects missing or changed deployed bytecode", async () => {
  await assert.rejects(verifyTestnetRoutingRuntime({ getChainId: async () => 46630, getCode: async () => "0x00" }, config, pin), /runtime differs/);
});

const runtimeCode = "0x6000";
const runtimeHash = keccak256(runtimeCode);
const runtimeConfig = { ...config, expectedCodehashes: { ...config.expectedCodehashes, uniswapV3Weth9: runtimeHash } };
const runtimePin = { ...pin, dependencies: { uniswapV3Weth9: { ...pin.dependencies.uniswapV3Weth9, codehash: runtimeHash } } };


const compiled = compileUniversalRouter();
let universalRuntime = compiled.evm.deployedBytecode.object;
const immutableValues = { WETH9: config.externalContracts.weth, PERMIT2: config.externalContracts.permit2, UNISWAP_V3_FACTORY: config.externalContracts.uniswapV3Factory, UNISWAP_V3_POOL_INIT_CODE_HASH: v3PoolInitCodeHash, poolManager: config.externalContracts.uniswapV4PoolManager };
for (const [id,locations] of Object.entries(compiled.evm.deployedBytecode.immutableReferences)) {
  const value = immutableValues[compiled.immutableNames.get(id)];
  if (value) for (const {start,length} of locations) universalRuntime = universalRuntime.slice(0,start*2)+value.slice(2).toLowerCase().padStart(length*2,"0")+universalRuntime.slice((start+length)*2);
}

for (const details of ["unsupported block number 1000", "metadata is not found"]) {
  test(`retries transient state errors without changing the runtime-check block: ${details}`, async () => {
    let calls = 0;
    await verifyTestnetRoutingRuntime({
      getChainId: async () => 46630,
      getCode: async ({ address, blockNumber }) => {
        if (address.toLowerCase() === config.externalContracts.uniswapUniversalRouter.toLowerCase()) return `0x${universalRuntime}`;
        if (blockNumber === undefined) return runtimeCode;
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
