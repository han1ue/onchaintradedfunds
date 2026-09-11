import { createRequire } from "node:module";

const { keccak256, parseAbi } = createRequire(new URL("../../app/package.json", import.meta.url))("viem");
const requiredDependencies = [
  "weth", "uniswapV3Factory", "uniswapV4PoolManager",
  "uniswapV4StateView", "uniswapV4PositionManager", "uniswapV4Quoter", "uniswapUniversalRouter", "permit2",
];

export function mainnetRoutingRpcUrl(env, defaultUrl) {
  const configured = env.RH_MAINNET_RPC_URL?.trim();
  if (!configured && env.CI === "true") {
    throw new Error("Mainnet fork validation requires RH_MAINNET_RPC_URL in CI. Configure the RH_MAINNET_RPC_URL repository secret with a Robinhood mainnet RPC accessible from the runner; the public endpoint can return a Cloudflare HTTP 403 challenge.");
  }
  return configured || defaultUrl;
}

export function mainnetRehearsalDependencies(fixture) {
  if (fixture.chainId !== 4663 || fixture.stocks?.length !== 5) {
    throw new Error("Rehearsal requires Robinhood mainnet and five pinned stock markets");
  }
  return {
    ethUsdOracle: fixture.oracle,
    ethUsdAggregator: fixture.oracle.aggregator,
    uniswapV3Quoter: fixture.quoter,
    usdg: fixture.usdg,
    wethUsdgPool: fixture.wethMarket.pool,
    ...Object.fromEntries(fixture.stocks.flatMap((stock, index) => [
      [`stock${index}`, stock], [`stock${index}UsdgPool`, stock.pool],
    ])),
  };
}

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
  for (const name of new Set([...requiredDependencies, ...Object.keys(pin.dependencies)])) {
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
  const poolManager = await retryStateRead(() => client.readContract({
    address: pin.dependencies.uniswapV4Quoter.address,
    abi: parseAbi(["function poolManager() view returns (address)"]),
    functionName: "poolManager", blockNumber,
  }));
  if (poolManager.toLowerCase() !== pin.dependencies.uniswapV4PoolManager.address.toLowerCase()) {
    throw new Error("Mainnet V4 quoter PoolManager binding mismatch");
  }
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
