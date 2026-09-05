import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertTestnetRoutingConfiguration, verifyTestnetRoutingRuntime } from "./testnet-routing.mjs";

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
