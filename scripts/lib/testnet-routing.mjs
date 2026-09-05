import { createRequire } from "node:module";

const appRequire = createRequire(new URL("../../app/package.json", import.meta.url));
const { keccak256 } = appRequire("viem");

export async function getTestnetRoutingBlock(client, requestedBlock) {
  let blockNumber = requestedBlock;
  if (blockNumber === undefined) {
    // Give RPC backends time to serve state for the selected block.
    const head = await client.getBlockNumber({ cacheTime: 0 });
    blockNumber = head > 64n ? head - 64n : 0n;
  }
  return retryStateRead(() => client.getBlock({ blockNumber }));
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
  const expectedFields = ["Currency currencyIn;", "PathKey[] path;", "uint128 amountIn;", "uint128 amountOutMinimum;"];
  if (JSON.stringify(pin.universalRouterSource.exactInputParams) !== JSON.stringify(expectedFields)) {
    throw new Error("Testnet Universal Router must use the reviewed four-field exact-input tuple");
  }
}

export async function verifyTestnetRoutingRuntime(client, config, pin, blockNumber) {
  assertTestnetRoutingConfiguration(config, pin);
  if (await client.getChainId() !== pin.chainId) throw new Error("Routing RPC chain ID mismatch");
  await Promise.all(Object.entries(pin.dependencies).map(async ([name, expected]) => {
    const code = await retryStateRead(() => client.getCode({
      address: expected.address, ...(blockNumber === undefined ? {} : { blockNumber }),
    }));
    if (!code || code === "0x" || keccak256(code) !== expected.codehash) {
      throw new Error(`${name} runtime differs from the validated testnet bytecode`);
    }
  }));
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
