import { universalV3Execution } from "./universal-v3-execution";
import { managedOtfVaultAbi, otfFactoryAbi } from "@onchaintradedfunds/generated";
import {
  createPublicClient,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  parseAbi,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { assetCatalog, testnetSwapPairAllowed, type AssetRegistry, type RegisteredPool } from "./asset-catalog";
import { testnetVenue } from "./venue-config";
import { readRegistry } from "../server/registry";
import { registeredRouteClient } from "../server/registered-route-client";
import { registeredCandidates, bestRegisteredQuote, registeredBasketRoutes, type RouteSegment } from "./registered-routes";
import { robinhoodTestnetV4, robinhoodTestnetAddresses, robinhoodTestnetDeploymentReady, robinhoodTestnetNativeEntryReady } from "./deployment";
import { verifyTestnetV3Adapter } from "./testnet-v3-bindings";
import { QUOTE_MAX_AGE_MS } from "./swap-model";
import { availableResponse, basketQuote, sameAddress, applySlippageDown, type BasketPlannerRequest } from "./basket-planner";
import { routeFrom } from "./v3-route";
import { simulateTestnetQuote } from "../server/testnet-simulation";
import { canonicalOtfBasketRoutes, canonicalOtfRouting } from "./canonical-otf-routing";
import { QuoteFailure, quoteStep } from "./quote-errors";
import { unavailableQuoteResponse } from "./quote-diagnostics";

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



export type TestnetRoutingClient = {
  verifyOtfBindings?(router: Address, adapter: Address): Promise<void>;
  quoteOtf?(type: "EXACT_INPUT" | "EXACT_OUTPUT", buy: boolean, amount: bigint): Promise<bigint>;
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

function defaultRoutingClient(registry: AssetRegistry): TestnetRoutingClient {
  const catalog = assetCatalog(registry,46630);
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
    ...canonicalOtfRouting(publicClient, {
      ...robinhoodTestnetAddresses,
      uniswapV4PoolManager: robinhoodTestnetV4.poolManager,
      uniswapV4StateView: robinhoodTestnetV4.stateView,
      universalRouter: robinhoodTestnetV4.universalRouter,
      permit2: robinhoodTestnetV4.permit2,
      uniswapV4Quoter: robinhoodTestnetV4.quoter,
    }),
    verifyBindings: (factory, router, adapter) => verifyTestnetV3Adapter(publicClient, factory, router, adapter),
    isVault: (vault) => publicClient.readContract({ address: robinhoodTestnetAddresses.factory!, abi: otfFactoryAbi, functionName: "isVault", args: [vault] }),
    poolFor: async (tokenA, tokenB, fee) => {
      const pool = await publicClient.readContract({ address: testnetVenue.factory, abi: v3FactoryAbi, functionName: "getPool", args: [tokenA, tokenB, fee] });
      if (sameAddress(pool, zeroAddress)) return undefined;
      const configured = catalog.testnetPools.find(pool => pool.fee === fee && [pool.assetA.address.toLowerCase(), pool.assetB.address.toLowerCase()].sort().join(":") === [tokenA.toLowerCase(), tokenB.toLowerCase()].sort().join(":"));
      if (!configured) throw new QuoteFailure("ROUTE_NOT_CONFIGURED");
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

async function directQuote(request: BasketPlannerRequest, registry: AssetRegistry, routing: RegisteredClient, now: number) {
  if (request.input.kind === "native" || request.output.kind === "native") throw new QuoteFailure("ROUTE_NOT_CONFIGURED");
  const paths = registeredCandidates(registry.pools.filter(pool=>pool.protocolVersion===3),46630,request.input.address,request.output.address,robinhoodTestnetAddresses.weth!);
  const best = await bestRegisteredQuote({paths,type:"EXACT_INPUT",amount:request.inputAmountRaw,quoteSegment:routing.quoteSegment,authenticate:routing.authenticate});
  if (!best) throw new QuoteFailure("NO_ROUTE");
  if (best.impactBps>200 || !await routing.withinTradeSize(request.input.address,best.amountIn)) throw new QuoteFailure("ROUTE_POLICY_EXCEEDED");
  const route = routeFrom([best.path[0]!.tokenIn,...best.path.map(hop=>hop.tokenOut)],best.path.map(hop=>hop.pool.fee));
  const expectedOutput = best.amountOut;
  const minimumOutput = applySlippageDown(expectedOutput, request.slippageBps);
  const transaction = {
    chainId: request.chainId,
    from: request.caller,
    to: robinhoodTestnetV4.universalRouter!,
    data: universalV3Execution(route.path,request.caller,request.inputAmountRaw,minimumOutput,BigInt(Math.floor((now+QUOTE_MAX_AGE_MS)/1000))),
    value: "0",
  };
  return availableResponse(request, now, expectedOutput, minimumOutput, "Direct pool", {
    kind: "direct-v3",
    chainId: request.chainId,
    caller: request.caller,
    inputToken: request.input.address,
    outputToken: request.output.address,
    universalRouter: robinhoodTestnetV4.universalRouter!,
    amountIn: request.inputAmountRaw.toString(),
    minAmountOut: minimumOutput.toString(),
    expiresAtMs: now + QUOTE_MAX_AGE_MS,
    approval: { token: request.input.address, spender: robinhoodTestnetV4.permit2!, amount: request.inputAmountRaw.toString() },
    path: route.path,
    transaction,
  }, route.hops);
}

async function testnetBasketQuote(request: BasketPlannerRequest, client: TestnetRoutingClient, now: number, router: Address, adapter: Address, registry: AssetRegistry, routing: RegisteredClient) {
  const { testnetQuoteAssets, testnetAssetRole, testnetAssetById } = assetCatalog(registry,46630);
  const { otfToken, weth, launchManager } = robinhoodTestnetAddresses;
  const isOtfToken = (token: Address) => Boolean(otfToken && sameAddress(token, otfToken));
  for (const asset of [request.input, request.output]) {
    if (asset.kind !== "otf" && !testnetQuoteAssets.some((quote) => sameAddress(quote.address, asset.address))) throw new Error("Basket endpoints must be configured quote assets.");
  }
  const basketClient = {
    ...client,
    vaultAssets: async (vault: Address) => {
      const assets = await client.vaultAssets(vault);
      if (assets.some((asset) => testnetAssetRole(asset) !== "fund" && !isOtfToken(asset))) throw new QuoteFailure("UNSUPPORTED_CONSTITUENT");
      return assets;
    },
  };
  const baseRoutes = registeredBasketRoutes({
    pools:registry.pools,chainId:46630,weth:weth!,adapter,slippageBps:request.slippageBps,
    ...routing,
  });
  const routes = canonicalOtfBasketRoutes(baseRoutes, {
    otfToken, weth: weth!, launchManager, entryRouter: router,
    uniswapUniversalRouterAdapter: adapter, slippageBps: request.slippageBps, client,
  });
  const usdg = testnetAssetById("usdg")!;
  const result = await basketQuote(request, basketClient, now, router, adapter, routes, usdg, usdg.address);
  return result;
}

type RegisteredClient = { authenticate(pool:RegisteredPool):Promise<void>; quoteSegment(segment:RouteSegment,type:"EXACT_INPUT"|"EXACT_OUTPUT",amount:bigint):Promise<{amount:bigint;gas?:bigint}>; withinTradeSize(token:Address,amount:bigint):Promise<boolean> };

export async function quoteTestnetSwap(
  request: BasketPlannerRequest,
  dependencies: {
    registry?: AssetRegistry;
    registeredClient?: RegisteredClient;
    simulate?: typeof simulateTestnetQuote;
    now?: () => number;
    client?: TestnetRoutingClient;
    deployment?: { factory: Address; entryRouter: Address; uniswapUniversalRouterAdapter: Address; nativeBasketReady?: boolean };
  } = {},
) {
  const deployment = dependencies.deployment ?? (robinhoodTestnetDeploymentReady
    && robinhoodTestnetAddresses.factory
    && robinhoodTestnetAddresses.entryRouter
    && robinhoodTestnetAddresses.uniswapUniversalRouterAdapter
    ? {
        factory: robinhoodTestnetAddresses.factory,
        entryRouter: robinhoodTestnetAddresses.entryRouter,
        uniswapUniversalRouterAdapter: robinhoodTestnetAddresses.uniswapUniversalRouterAdapter,
        nativeBasketReady: robinhoodTestnetNativeEntryReady,
      }
    : undefined);
  if (!deployment) {
    return unavailableQuoteResponse(request, "configuration", new QuoteFailure("ROUTE_NOT_CONFIGURED"));
  }
  if (request.chainId !== 46630 || !testnetSwapPairAllowed(request.input, request.output)) {
    return unavailableQuoteResponse(request, "pair-validation", new QuoteFailure("ROUTE_NOT_CONFIGURED"));
  }
  const includesNative = request.input.kind === "native" || request.output.kind === "native";
  if (includesNative && request.route === "basket" && deployment.nativeBasketReady !== true) {
    return unavailableQuoteResponse(request, "native-entry", new QuoteFailure("ROUTE_NOT_CONFIGURED"));
  }
  let stage = "registry";
  try {
  const registry = dependencies.registry ?? await readRegistry(request.chainId);
  const { testnetAssetByAddress } = assetCatalog(registry,46630);
  const metadataMatches = [request.input, request.output].every((asset) => (
    asset.kind === "otf"
      ? asset.decimals === 18
      : testnetAssetByAddress(asset.address)?.decimals === asset.decimals
  ));
  if (!metadataMatches) {
    return unavailableQuoteResponse(request, "metadata", new QuoteFailure("INVALID_ASSET_METADATA"));
  }
  const now = (dependencies.now ?? Date.now)();
  const client = dependencies.client ?? defaultRoutingClient(registry);
  const routing = dependencies.registeredClient ?? registeredRouteClient(46630);
    stage = "bindings";
    await quoteStep("DEPLOYMENT_MISMATCH", () => client.verifyBindings(deployment.factory, deployment.entryRouter, deployment.uniswapUniversalRouterAdapter));
    stage = "vault-validation";
    await quoteStep("INVALID_ASSET_METADATA", () => assertVaults(request, client));
    stage = "routing";
    const result = request.route === "direct"
      ? await directQuote(request, registry, routing, now)
      : await testnetBasketQuote(request, client, now, deployment.entryRouter, deployment.uniswapUniversalRouterAdapter, registry, routing);
    stage="simulation";
    await quoteStep("SIMULATION_FAILED",()=>(dependencies.simulate??simulateTestnetQuote)(result.body,request));
    if((dependencies.now??Date.now)()>=result.body.expiresAtMs)throw new QuoteFailure("QUOTE_EXPIRED");
    return result;
  } catch (error) {
    return unavailableQuoteResponse(request, stage, error);
  }
}
