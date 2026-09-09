import { keccak256, parseAbi, type Address, type PublicClient } from "viem";
import deployment from "../config/robinhood-testnet.json";
import { testnetVenue } from "./venue-config";
import { V3_POOL_INIT_CODE_HASH } from "./universal-route";

type Reader = Pick<PublicClient, "getChainId" | "getCode" | "readContract">;
const bindingAbi = parseAbi([
  "function factory() view returns (address)",
  "function WETH9() view returns (address)",
  "function entryExitRouter() view returns (address)",
  "function uniswapV3Factory() view returns (address)",
  "function uniswapUniversalRouter() view returns (address)",
  "function uniswapV4PoolManager() view returns (address)",
  "function uniswapV4StateView() view returns (address)",
  "function permit2() view returns (address)",
  "function v3PoolInitCodeHash() view returns (bytes32)",
  "function weth() view returns (address)",
  "function isAdapterApproved(address) view returns (bool)",
]);

export async function verifyTestnetV3Venue(client: Reader): Promise<void> {
  if (await client.getChainId() !== 46630) throw new Error("The V3 RPC has the wrong chain.");
  const targets = {
    uniswapV3Factory: testnetVenue.factory,
    uniswapV3QuoterV2: testnetVenue.quoter,
    uniswapV3PositionManager: testnetVenue.positionManager,
    uniswapV3Weth9: testnetVenue.weth9,
  };
  await Promise.all(Object.entries(targets).map(async ([key, address]) => {
    const name = key as keyof typeof targets;
    if (deployment.externalContracts[name].toLowerCase() !== address.toLowerCase()) throw new Error("The V3 deployment and asset catalog disagree.");
    const code = await client.getCode({ address });
    if (!code || code === "0x" || keccak256(code) !== deployment.expectedCodehashes[name]) throw new Error("The V3 runtime differs from the authenticated deployment.");
  }));
  for (const address of [testnetVenue.quoter, testnetVenue.positionManager]) {
    await assertBinding(client, address, "factory", testnetVenue.factory);
    await assertBinding(client, address, "WETH9", testnetVenue.weth9);
  }
}

export async function verifyTestnetV3Adapter(client: Reader, factory: Address, router: Address, adapter: Address): Promise<void> {
  await verifyTestnetV3Venue(client);
  await assertBinding(client, adapter, "entryExitRouter", router);
  await assertBinding(client, adapter, "uniswapV3Factory", testnetVenue.factory);
  await assertBinding(client, adapter, "uniswapUniversalRouter", deployment.externalContracts.uniswapUniversalRouter as Address);
  await assertBinding(client, adapter, "weth", deployment.externalContracts.weth as Address);
  for (const name of ["uniswapV4PoolManager", "uniswapV4StateView", "permit2"] as const) {
    await assertBinding(client, adapter, name, deployment.externalContracts[name] as Address);
  }
  if (await client.readContract({ address: adapter, abi: bindingAbi, functionName: "v3PoolInitCodeHash" }) !== V3_POOL_INIT_CODE_HASH) throw new Error("Stale V3 pool init-code hash.");
  await assertBinding(client, factory, "entryExitRouter", router);
  await assertBinding(client, router, "factory", factory);
  await assertBinding(client, router, "weth", deployment.externalContracts.weth as Address);
  if (!await client.readContract({ address: router, abi: bindingAbi, functionName: "isAdapterApproved", args: [adapter] })) throw new Error("The V3 adapter is not approved.");
}

async function assertBinding(client: Reader, address: Address, functionName: "factory" | "WETH9" | "entryExitRouter" | "uniswapV3Factory" | "uniswapUniversalRouter" | "uniswapV4PoolManager" | "uniswapV4StateView" | "permit2" | "weth", expected: Address): Promise<void> {
  const actual = await client.readContract({ address, abi: bindingAbi, functionName });
  if (actual.toLowerCase() !== expected.toLowerCase()) throw new Error(`Stale V3 ${functionName} binding.`);
}
