import { createRequire } from "node:module";

const { keccak256 } = createRequire(new URL("../../app/package.json", import.meta.url))("viem");
const requiredDependencies = [
  "weth", "uniswapV3Factory", "uniswapV3SwapRouter02", "uniswapV4PoolManager",
  "uniswapV4StateView", "uniswapV4PositionManager", "uniswapUniversalRouter", "permit2",
];

export async function getMainnetRoutingBlockNumber(client, requestedBlock) {
  if (requestedBlock !== undefined) return requestedBlock;
  // The public endpoint does not retain historical state indefinitely.
  const head = await client.getBlockNumber({ cacheTime: 0 });
  return head > 64n ? head - 64n : 0n;
}

export async function verifyMainnetRoutingRuntime(client, pin, blockNumber) {
  if (pin.chainId !== 4663 || await client.getChainId() !== 4663) {
    throw new Error("Fork tests require Robinhood mainnet, chain 4663");
  }
  for (const name of requiredDependencies) {
    const dependency = pin.dependencies[name];
    if (!/^0x[\da-f]{40}$/i.test(dependency?.address ?? "")
      || !/^0x[\da-f]{64}$/i.test(dependency?.codehash ?? "")) {
      throw new Error(`Missing mainnet address or code hash: ${name}`);
    }
  }
  const block = await retryStateRead(() => client.getBlock({ blockNumber }));
  if (block.number !== blockNumber || !block.hash) throw new Error("Mainnet fork block unavailable");
  if (blockNumber === BigInt(pin.blockNumber) && block.hash !== pin.blockHash) {
    throw new Error("Reference mainnet block hash mismatch");
  }
  await Promise.all(Object.entries(pin.dependencies).map(async ([name, dependency]) => {
    const code = await retryStateRead(() => client.getCode({ address: dependency.address, blockNumber }));
    if (!code || code === "0x" || keccak256(code) !== dependency.codehash) {
      throw new Error(`${name} runtime differs from the pinned mainnet bytecode`);
    }
  }));
  return block;
}

async function retryStateRead(read) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await read();
    } catch (error) {
      if (attempt >= 4 || !/metadata is not found|unsupported block number/i.test(error.details ?? "")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
