import { createRequire } from "node:module";
import { compileUniversalRouter, verifyUniversalRouter } from "./universal-router.mjs";

const appRequire = createRequire(new URL("../../app/package.json", import.meta.url));
const { keccak256 } = appRequire("viem");

export function assertTestnetDeploymentEncoding(pin) {
  if (pin.chainId !== 46630) throw new Error("Wrong testnet chain");
  compileUniversalRouter();
}

export function assertTestnetRoutingConfiguration(config, pin) {
  if (config.chainId !== 46630 || pin.chainId !== 46630) {
    throw new Error("Routing validation requires Robinhood testnet, chain 46630");
  }
  for (const [name, expected] of Object.entries(pin.dependencies)) {
    if (config.externalContracts[name]?.toLowerCase() !== expected.address.toLowerCase()) {
      throw new Error(`${name} differs from the validated testnet routing dependency`);
    }
    if (config.expectedCodehashes[name] && config.expectedCodehashes[name] !== expected.codehash) {
      throw new Error(`${name} differs from the validated testnet code hash`);
    }
  }
}

export async function verifyTestnetRoutingRuntime(client, config, pin, blockNumber) {
  assertTestnetRoutingConfiguration(config, pin);
  if (await client.getChainId() !== pin.chainId) throw new Error("Routing RPC chain ID mismatch");
  await Promise.all(Object.entries(pin.dependencies).map(async ([name, expected]) => {
    const code = await retryStateRead(() => client.getCode({
      address: expected.address, ...(blockNumber === undefined ? {} : { blockNumber }),
    }));
    if (!code || code === "0x" || (expected.codehash && keccak256(code) !== expected.codehash)) {
      throw new Error(`${name} runtime differs from the validated testnet bytecode`);
    }
  }));
  await verifyUniversalRouter(client, config);
}

async function retryStateRead(read) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await read();
    } catch (error) {
      const unavailable = /metadata is not found|unsupported block number/i.test(error.details ?? "");
      if (attempt >= 4 || !unavailable) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
