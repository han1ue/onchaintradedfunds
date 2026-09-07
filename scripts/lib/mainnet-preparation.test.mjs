import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mainnetPreparation } from "./mainnet-preparation.mjs";
const config = JSON.parse(readFileSync(new URL("../../app/src/config/robinhood-mainnet.json", import.meta.url)));
const pin = JSON.parse(readFileSync(new URL("../fixtures/robinhood-mainnet-routing.json", import.meta.url)));
test("both initial mainnet roles resolve to the provided deployer", () => {
  const deployer = "0x0000000000000000000000000000000000001234";
  assert.deepEqual(mainnetPreparation(config, pin, deployer).roles, { deployer, protocolAdministrator: deployer, teamBeneficiary: deployer });
  assert.equal(mainnetPreparation(config, pin).roles.deployer, null);
});
test("rejects broadcasting, invalid roles, wrong networks, or altered external targets", () => {
  for (const mutate of [
    (value) => { value.deploymentPolicy.broadcastEnabled = true; },
    (value) => { value.deploymentPolicy.teamBeneficiary = "other"; },
    (value) => { value.chainId = 46630; },
    (value) => { value.externalContracts.uniswapV4PoolManager = pin.dependencies.permit2.address; },
    (value) => { value.uniswapTradingApi.universalRouter = pin.dependencies.permit2.address; },
  ]) {
    const changed = structuredClone(config); mutate(changed);
    assert.throws(() => mainnetPreparation(changed, pin));
  }
  for (const address of ["", "invalid", "0x0000000000000000000000000000000000000000"]) assert.throws(() => mainnetPreparation(config, pin, address));
});
