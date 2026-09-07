import { managedOtfVaultAbi, otfFactoryAbi } from "@onchaintradedfunds/generated";
import {
  createPublicClient,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  maxUint256,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import {
  otfPoolDiscovery,
  testnetAssetByAddress,
  testnetAssetById,
  testnetAssetRole,
  testnetPoolRouteAllowed,
  testnetSwapPairAllowed,
  testnetPoolForPair,
  testnetQuoteAssets,
  testnetVenue,
  type TestnetPool,
} from "./asset-catalog";
import { robinhoodTestnetAddresses, robinhoodTestnetDeploymentReady, robinhoodTestnetNativeEntryReady } from "./deployment";
import { verifyTestnetV3Adapter } from "./testnet-v3-bindings";
import { QUOTE_MAX_AGE_MS } from "./swap-model";
import { availableResponse, basketQuote, sameAddress, applySlippageDown, applySlippageUp, type BasketPlannerRequest, type BasketRouteProvider } from "./basket-planner";
import { routeFrom, reverseRoute, type Route } from "./v3-route";

const v3FactoryAbi = [{
  type: "function",
  name: "getPool",
  stateMutability: "view",
  inputs: [{ type: "address" }, { type: "address" }, { type: "uint24" }],
  outputs: [{ type: "address" }],
}] as const;

const v3PoolAbi = [{
  type: "function",
  name: "liquidity",
  stateMutability: "view",
  inputs: [],
  outputs: [{ type: "uint128" }],
}] as const;

const v3QuoterAbi = [
  {
    type: "function",
    name: "quoteExactInput",
    stateMutability: "nonpayable",
    inputs: [{ type: "bytes", name: "path" }, { type: "uint256", name: "amountIn" }],
    outputs: [
      { type: "uint256", name: "amountOut" },
      { type: "uint160[]", name: "sqrtPriceX96AfterList" },
      { type: "uint32[]", name: "initializedTicksCrossedList" },
      { type: "uint256", name: "gasEstimate" },
    ],
  },
  {
    type: "function",
    name: "quoteExactOutput",
    stateMutability: "nonpayable",
    inputs: [{ type: "bytes", name: "path" }, { type: "uint256", name: "amountOut" }],
    outputs: [
      { type: "uint256", name: "amountIn" },
      { type: "uint160[]", name: "sqrtPriceX96AfterList" },
      { type: "uint32[]", name: "initializedTicksCrossedList" },
      { type: "uint256", name: "gasEstimate" },
    ],
  },
] as const;

export const uniswapV3SwapRouterAbi = [{
  type: "function",
  name: "exactInput",
  stateMutability: "payable",
  inputs: [{
    type: "tuple",
    name: "params",
    components: [
      { type: "bytes", name: "path" },
      { type: "address", name: "recipient" },
      { type: "uint256", name: "amountIn" },
      { type: "uint256", name: "amountOutMinimum" },
    ],
  }],
  outputs: [{ type: "uint256", name: "amountOut" }],
}] as const;

export type TestnetRoutingClient = {
  verifyBindings(factory: Address, router: Address, adapter: Address): Promise<void>;
  isVault(vault: Address): Promise<boolean>;
  poolFor(tokenA: Address, tokenB: Address, fee: number): Promise<Address | undefined>;
  poolLiquidity(pool: Address): Promise<bigint>;
  quoteExactInput(path: Hex, amountIn: bigint): Promise<bigint>;
  quoteExactOutput(path: Hex, amountOut: bigint): Promise<bigint>;
  vaultAssets(vault: Address): Promise<readonly Address[]>;
  previewMint(vault: Address, shares: bigint): Promise<readonly bigint[]>;
  previewRedeem(vault: Address, shares: bigint, owner: Address, skipMask: bigint): Promise<readonly bigint[]>;
};

function defaultRoutingClient(): TestnetRoutingClient {
  const publicClient = createPublicClient({
    chain: {
      id: 46630,
      name: "Robinhood Chain Testnet",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [process.env.RH_TESTNET_RPC_URL?.trim() || "https://rpc.testnet.chain.robinhood.com"] } },
    },
    transport: http(process.env.RH_TESTNET_RPC_URL?.trim() || "https://rpc.testnet.chain.robinhood.com"),
  });
  const quote = async (functionName: "quoteExactInput" | "quoteExactOutput", path: Hex, amount: bigint) => {
    const data = encodeFunctionData({
      abi: v3QuoterAbi,
      functionName,
      args: [path, amount],
    });
    const result = await publicClient.call({ to: testnetVenue.quoter, data });
    if (!result.data) throw new Error("Uniswap V3 Quoter returned no data.");
    const decoded = decodeFunctionResult({ abi: v3QuoterAbi, functionName, data: result.data });
    return decoded[0];
  };
  return {
    verifyBindings: (factory, router, adapter) => verifyTestnetV3Adapter(publicClient, factory, router, adapter),
    isVault: (vault) => publicClient.readContract({ address: robinhoodTestnetAddresses.factory!, abi: otfFactoryAbi, functionName: "isVault", args: [vault] }),
    poolFor: async (tokenA, tokenB, fee) => {
      const pool = await publicClient.readContract({ address: testnetVenue.factory, abi: v3FactoryAbi, functionName: "getPool", args: [tokenA, tokenB, fee] });
      if (sameAddress(pool, zeroAddress)) return undefined;
      const configured = testnetPoolForPair(tokenA, tokenB);
      if (configured) {
        const code = await publicClient.getCode({ address: pool });
        if (!sameAddress(pool, configured.address) || !code || keccak256(code) !== configured.runtimeCodehash) throw new Error("The configured V3 pool runtime changed.");
      }
      const abi = parseAbi(["function factory() view returns (address)", "function token0() view returns (address)", "function token1() view returns (address)", "function fee() view returns (uint24)"]);
      const [factory, token0, token1, actualFee] = await Promise.all([
        publicClient.readContract({ address: pool, abi, functionName: "factory" }),
        publicClient.readContract({ address: pool, abi, functionName: "token0" }),
        publicClient.readContract({ address: pool, abi, functionName: "token1" }),
        publicClient.readContract({ address: pool, abi, functionName: "fee" }),
      ]);
      const ordered = [tokenA, tokenB].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
      if (!sameAddress(factory, testnetVenue.factory) || !sameAddress(token0, ordered[0]!) || !sameAddress(token1, ordered[1]!) || actualFee !== fee) throw new Error("The V3 pool bindings do not match the selected market.");
      return getAddress(pool);
    },
    poolLiquidity: (pool) => publicClient.readContract({ address: pool, abi: v3PoolAbi, functionName: "liquidity" }),
    quoteExactInput: (path, amountIn) => quote("quoteExactInput", path, amountIn),
    quoteExactOutput: (path, amountOut) => quote("quoteExactOutput", path, amountOut),
    vaultAssets: (vault) => publicClient.readContract({ address: vault, abi: managedOtfVaultAbi, functionName: "assets" }),
    previewMint: (vault, shares) => publicClient.readContract({ address: vault, abi: managedOtfVaultAbi, functionName: "previewMint", args: [shares] }),
    previewRedeem: (vault, shares, owner, skipMask) => publicClient.readContract({ address: vault, abi: managedOtfVaultAbi, functionName: "previewRedeem", args: [shares, owner, skipMask] }),
  };
}

async function assertVaults(request: BasketPlannerRequest, client: TestnetRoutingClient): Promise<void> {
  for (const asset of [request.input, request.output]) {
    if (asset.kind === "otf" && (!asset.isFactoryVault || !await client.isVault(asset.address))) throw new Error("The route contains an unrecognized OTF.");
  }
}

async function validatedConnection(
  asset: { address: Address; kind: "native" | "erc20" | "otf" },
  client: TestnetRoutingClient,
): Promise<{ asset: Address; pool: Address; fee: number }> {
  const usdg = testnetAssetById("usdg")!;
  let configuredPool: TestnetPool | undefined;
  let fee: number;
  if (asset.kind === "otf") {
    fee = otfPoolDiscovery.fee;
  } else {
    configuredPool = testnetPoolForPair(asset.address, usdg.address);
    if (!configuredPool) throw new Error("The asset has no configured USDG pool.");
    fee = configuredPool.fee;
  }
  const pool = await client.poolFor(asset.address, usdg.address, fee);
  if (!pool || configuredPool && !sameAddress(pool, configuredPool.address)) throw new Error("The configured pool does not match the Uniswap V3 factory.");
  if (await client.poolLiquidity(pool) === 0n) throw new Error("The configured pool has no active liquidity.");
  return { asset: asset.address, pool, fee };
}

async function routeFor(
  input: { address: Address; kind: "native" | "erc20" | "otf" },
  output: { address: Address; kind: "native" | "erc20" | "otf" },
  client: TestnetRoutingClient,
): Promise<Route> {
  if (!testnetPoolRouteAllowed(input, output)) throw new Error("This pair is outside the configured testnet asset policy.");
  const usdg = testnetAssetById("usdg")!;
  const tokens: Address[] = [input.address];
  const fees: number[] = [];
  if (!sameAddress(input.address, usdg.address)) {
    const connection = await validatedConnection(input, client);
    fees.push(connection.fee);
    tokens.push(usdg.address);
  }
  if (!sameAddress(output.address, usdg.address)) {
    const connection = await validatedConnection(output, client);
    fees.push(connection.fee);
    tokens.push(output.address);
  }
  return routeFrom(tokens, fees);
}

async function directQuote(request: BasketPlannerRequest, client: TestnetRoutingClient, now: number) {
  if (request.input.kind === "native" || request.output.kind === "native") throw new Error("The deployed Uniswap V3 router has no verified atomic native path.");
  const route = await routeFor(request.input, request.output, client);
  const expectedOutput = await client.quoteExactInput(route.path, request.inputAmountRaw);
  const minimumOutput = applySlippageDown(expectedOutput, request.slippageBps);
  const transaction = {
    chainId: request.chainId,
    from: request.caller,
    to: testnetVenue.swapRouter02,
    data: encodeFunctionData({
      abi: uniswapV3SwapRouterAbi,
      functionName: "exactInput",
      args: [{ path: route.path, recipient: request.caller, amountIn: request.inputAmountRaw, amountOutMinimum: minimumOutput }],
    }),
    value: "0",
  };
  return availableResponse(request, now, expectedOutput, minimumOutput, "Direct pool", {
    kind: "direct-v3",
    chainId: request.chainId,
    caller: request.caller,
    inputToken: request.input.address,
    outputToken: request.output.address,
    swapRouter02: testnetVenue.swapRouter02,
    amountIn: request.inputAmountRaw.toString(),
    minAmountOut: minimumOutput.toString(),
    expiresAtMs: now + QUOTE_MAX_AGE_MS,
    approval: { token: request.input.address, spender: testnetVenue.swapRouter02, amount: request.inputAmountRaw.toString() },
    path: route.path,
    transaction,
  }, route.hops);
}

async function testnetBasketQuote(request: BasketPlannerRequest, client: TestnetRoutingClient, now: number, router: Address, adapter: Address) {
  for (const asset of [request.input, request.output]) {
    if (asset.kind !== "otf" && !testnetQuoteAssets.some((quote) => sameAddress(quote.address, asset.address))) throw new Error("Basket endpoints must be configured quote assets.");
  }
  const basketClient = {
    ...client,
    vaultAssets: async (vault: Address) => {
      const assets = await client.vaultAssets(vault);
      if (assets.some((asset) => testnetAssetRole(asset) !== "fund")) throw new Error("Unsupported testnet constituent.");
      return assets;
    },
  };
  const routes: BasketRouteProvider = {
    quote: async (type, tokenIn, tokenOut, amount) => {
      const route = await routeFor({ address: tokenIn, kind: "erc20" }, { address: tokenOut, kind: "erc20" }, client);
      const amountIn = type === "EXACT_INPUT" ? amount : applySlippageUp(await client.quoteExactOutput(reverseRoute(route).path, amount), request.slippageBps);
      const amountOut = type === "EXACT_OUTPUT" ? amount : await client.quoteExactInput(route.path, amount);
      return { amountIn, amountOut, legs: [{
        adapter, tokenIn, tokenOut,
        amountIn: type === "EXACT_INPUT" ? maxUint256 : amountIn,
        minAmountOut: type === "EXACT_OUTPUT" ? amountOut : applySlippageDown(amountOut, request.slippageBps),
        data: route.path, hops: route.hops,
      }] };
    },
  };
  const usdg = testnetAssetById("usdg")!;
  return basketQuote(request, basketClient, now, router, adapter, routes, usdg, usdg.address);
}

export async function quoteTestnetSwap(
  request: BasketPlannerRequest,
  dependencies: {
    now?: () => number;
    client?: TestnetRoutingClient;
    deployment?: { factory: Address; entryRouter: Address; uniswapV3Adapter: Address; nativeBasketReady?: boolean };
  } = {},
) {
  const deployment = dependencies.deployment ?? (robinhoodTestnetDeploymentReady
    && robinhoodTestnetAddresses.factory
    && robinhoodTestnetAddresses.entryRouter
    && robinhoodTestnetAddresses.uniswapV3Adapter
    ? {
        factory: robinhoodTestnetAddresses.factory,
        entryRouter: robinhoodTestnetAddresses.entryRouter,
        uniswapV3Adapter: robinhoodTestnetAddresses.uniswapV3Adapter,
        nativeBasketReady: robinhoodTestnetNativeEntryReady,
      }
    : undefined);
  if (!deployment) {
    return { status: 503, body: { state: "unavailable", route: request.route, reason: "The testnet router deployment is unavailable." } };
  }
  if (request.chainId !== 46630 || !testnetSwapPairAllowed(request.input, request.output)) {
    return { status: 503, body: { state: "unavailable", route: request.route, reason: "This pair is outside the configured testnet asset policy." } };
  }
  const includesNative = request.input.kind === "native" || request.output.kind === "native";
  if (includesNative && request.route === "basket" && deployment.nativeBasketReady !== true) {
    return { status: 503, body: { state: "unavailable", route: request.route, reason: "Native basket execution awaits a compatible entry-router deployment." } };
  }
  const metadataMatches = [request.input, request.output].every((asset) => (
    asset.kind === "otf"
      ? asset.decimals === 18
      : testnetAssetByAddress(asset.address)?.decimals === asset.decimals
  ));
  if (!metadataMatches) {
    return { status: 503, body: { state: "unavailable", route: request.route, reason: "The selected asset metadata does not match the testnet catalog." } };
  }
  const now = (dependencies.now ?? Date.now)();
  const client = dependencies.client ?? defaultRoutingClient();
  try {
    await client.verifyBindings(deployment.factory, deployment.entryRouter, deployment.uniswapV3Adapter);
    await assertVaults(request, client);
    return request.route === "direct"
      ? await directQuote(request, client, now)
      : await testnetBasketQuote(request, client, now, deployment.entryRouter, deployment.uniswapV3Adapter);
  } catch {
    return { status: 503, body: { state: "unavailable", route: request.route, reason: request.route === "direct" ? "No executable Uniswap V3 route is currently available." : "No executable basket route is currently available." } };
  }
}
