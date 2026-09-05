import { keccak256, parseAbi, type Address, type PublicClient } from "viem";
import deployment from "../config/robinhood-testnet.json";
import { testnetAssetById, testnetVenue } from "./asset-catalog";

type Reader = Pick<PublicClient, "getChainId" | "getCode" | "readContract">;
const bindingAbi = parseAbi([
  "function factory() view returns (address)",
  "function WETH9() view returns (address)",
  "function positionManager() view returns (address)",
  "function entryExitRouter() view returns (address)",
  "function uniswapV3Factory() view returns (address)",
  "function uniswapV3Router() view returns (address)",
  "function weth() view returns (address)",
  "function isAdapterApproved(address) view returns (bool)",
]);

export async function verifyTestnetV3Venue(client: Reader): Promise<void> {
  if (await client.getChainId() !== 46630) throw new Error("The V3 RPC has the wrong chain.");
  const targets = {
    uniswapV3Factory: testnetVenue.factory,
    uniswapV3SwapRouter02: testnetVenue.swapRouter02,
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
  for (const address of [testnetVenue.swapRouter02, testnetVenue.quoter, testnetVenue.positionManager]) {
    await assertBinding(client, address, "factory", testnetVenue.factory);
    await assertBinding(client, address, "WETH9", testnetVenue.weth9);
  }
  await assertBinding(client, testnetVenue.swapRouter02, "positionManager", testnetVenue.positionManager);
}

export async function verifyTestnetV3Adapter(client: Reader, factory: Address, router: Address, adapter: Address): Promise<void> {
  await verifyTestnetV3Venue(client);
  await assertBinding(client, adapter, "entryExitRouter", router);
  await assertBinding(client, adapter, "uniswapV3Factory", testnetVenue.factory);
  await assertBinding(client, adapter, "uniswapV3Router", testnetVenue.swapRouter02);
  await assertBinding(client, router, "factory", factory);
  await assertBinding(client, router, "weth", testnetAssetById("weth")!.address);
  if (!await client.readContract({ address: router, abi: bindingAbi, functionName: "isAdapterApproved", args: [adapter] })) throw new Error("The V3 adapter is not approved.");
}

async function assertBinding(client: Reader, address: Address, functionName: "factory" | "WETH9" | "positionManager" | "entryExitRouter" | "uniswapV3Factory" | "uniswapV3Router" | "weth", expected: Address): Promise<void> {
  const actual = await client.readContract({ address, abi: bindingAbi, functionName });
  if (actual.toLowerCase() !== expected.toLowerCase()) throw new Error(`Stale V3 ${functionName} binding.`);
}
