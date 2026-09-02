import { managedOtfVaultAbi, otfFactoryAbi } from "@onchaintradedfunds/generated";
import {
  concatHex,
  createPublicClient,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  http,
  maxUint256,
  numberToHex,
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
  type CatalogAsset,
  type TestnetPool,
} from "./asset-catalog";
import { robinhoodTestnetAddresses, robinhoodTestnetDeploymentReady, robinhoodTestnetNativeEntryReady } from "./deployment";

const QUOTE_LIFETIME_MS = 20_000;
const ROUTER_DEADLINE_SECONDS = 120;
const ONE_OTF = 1_000_000_000_000_000_000n;

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

export const synthraSwapRouterAbi = [{
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

export type TestnetPlannerRequest = {
  route: "direct" | "basket";
  chainId: number;
  caller: Address;
  input: { address: Address; decimals: number; kind: "native" | "erc20" | "otf"; isFactoryVault: boolean };
  output: { address: Address; decimals: number; kind: "native" | "erc20" | "otf"; isFactoryVault: boolean };
  inputAmountRaw: bigint;
  slippageBps: number;
  requestedAtMs: number;
};

export type TestnetRoutingClient = {
  isVault(vault: Address): Promise<boolean>;
  poolFor(tokenA: Address, tokenB: Address, fee: number): Promise<Address | undefined>;
  poolLiquidity(pool: Address): Promise<bigint>;
  quoteExactInput(path: Hex, amountIn: bigint): Promise<bigint>;
  quoteExactOutput(path: Hex, amountOut: bigint): Promise<bigint>;
  vaultAssets(vault: Address): Promise<readonly Address[]>;
  previewMint(vault: Address, shares: bigint): Promise<readonly bigint[]>;
  previewRedeem(vault: Address, shares: bigint): Promise<readonly bigint[]>;
};

type Route = {
  tokens: readonly Address[];
  fees: readonly number[];
  path: Hex;
  hops: readonly { venue: "Synthra V3"; tokenIn: Address; tokenOut: Address; feeTier: number }[];
};

type PlannedLeg = {
  adapter: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  minAmountOut: bigint;
  data: Hex;
  hops: Route["hops"];
};

type MintPlan = {
  shares: bigint;
  spent: bigint;
  legs: readonly PlannedLeg[];
  residual: bigint;
};

function sameAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function formatRaw(value: bigint, decimals: number): string {
  if (decimals === 0) return value.toString();
  const digits = value.toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, -decimals);
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function applySlippageDown(value: bigint, slippageBps: number): bigint {
  const result = value * BigInt(10_000 - slippageBps) / 10_000n;
  return result === 0n && value > 0n ? 1n : result;
}

function applySlippageUp(value: bigint, slippageBps: number): bigint {
  return (value * BigInt(10_000 + slippageBps) + 9_999n) / 10_000n;
}

export function encodeV3Path(tokens: readonly Address[], fees: readonly number[]): Hex {
  if (tokens.length !== fees.length + 1 || fees.length === 0 || fees.length > 3) throw new Error("Synthra path has an invalid shape.");
  const parts: Hex[] = [tokens[0] as Hex];
  for (let index = 0; index < fees.length; index += 1) {
    const fee = fees[index]!;
    if (!Number.isInteger(fee) || fee <= 0 || fee > 1_000_000 || sameAddress(tokens[index]!, tokens[index + 1]!)) throw new Error("Synthra path has an invalid hop.");
    parts.push(numberToHex(fee, { size: 3 }), tokens[index + 1] as Hex);
  }
  return concatHex(parts);
}

function reverseRoute(route: Route): Route {
  const tokens = [...route.tokens].reverse();
  const fees = [...route.fees].reverse();
  return routeFrom(tokens, fees);
}

function routeFrom(tokens: readonly Address[], fees: readonly number[]): Route {
  return {
    tokens,
    fees,
    path: encodeV3Path(tokens, fees),
    hops: fees.map((feeTier, index) => ({
      venue: "Synthra V3" as const,
      tokenIn: tokens[index]!,
      tokenOut: tokens[index + 1]!,
      feeTier,
    })),
  };
}

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
    if (!result.data) throw new Error("Synthra Quoter returned no data.");
    const decoded = decodeFunctionResult({ abi: v3QuoterAbi, functionName, data: result.data });
    return decoded[0];
  };
  return {
    isVault: (vault) => publicClient.readContract({ address: robinhoodTestnetAddresses.factory!, abi: otfFactoryAbi, functionName: "isVault", args: [vault] }),
    poolFor: async (tokenA, tokenB, fee) => {
      const pool = await publicClient.readContract({ address: testnetVenue.factory, abi: v3FactoryAbi, functionName: "getPool", args: [tokenA, tokenB, fee] });
      return sameAddress(pool, zeroAddress) ? undefined : getAddress(pool);
    },
    poolLiquidity: (pool) => publicClient.readContract({ address: pool, abi: v3PoolAbi, functionName: "liquidity" }),
    quoteExactInput: (path, amountIn) => quote("quoteExactInput", path, amountIn),
    quoteExactOutput: (path, amountOut) => quote("quoteExactOutput", path, amountOut),
    vaultAssets: (vault) => publicClient.readContract({ address: vault, abi: managedOtfVaultAbi, functionName: "assets" }),
    previewMint: (vault, shares) => publicClient.readContract({ address: vault, abi: managedOtfVaultAbi, functionName: "previewMint", args: [shares] }),
    previewRedeem: (vault, shares) => publicClient.readContract({ address: vault, abi: managedOtfVaultAbi, functionName: "previewRedeem", args: [shares] }),
  };
}

async function assertVaults(request: TestnetPlannerRequest, client: TestnetRoutingClient): Promise<void> {
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
  if (!pool || configuredPool && !sameAddress(pool, configuredPool.address)) throw new Error("The configured pool does not match the Synthra factory.");
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

function serializedLeg(leg: PlannedLeg) {
  return {
    adapter: leg.adapter,
    tokenIn: leg.tokenIn,
    tokenOut: leg.tokenOut,
    amountIn: leg.amountIn.toString(),
    minAmountOut: leg.minAmountOut.toString(),
    data: leg.data,
  };
}

function serializedFunding(funding: readonly { token: Address; amount: bigint }[]) {
  return funding.map((entry) => ({ token: entry.token, amount: entry.amount.toString() }));
}

async function planMint(
  vault: Address,
  input: CatalogAsset,
  amountIn: bigint,
  slippageBps: number,
  adapter: Address,
  client: TestnetRoutingClient,
): Promise<MintPlan> {
  const assets = await client.vaultAssets(vault);
  if (assets.length === 0 || assets.length > 20 || assets.some((asset) => testnetAssetRole(asset) !== "fund")) throw new Error("The OTF contains an unsupported testnet constituent.");
  const unitAmounts = await client.previewMint(vault, ONE_OTF);
  if (unitAmounts.length !== assets.length) throw new Error("The OTF mint preview is malformed.");
  const unitCosts = await Promise.all(assets.map(async (asset, index) => {
    const route = await routeFor({ address: input.address, kind: "erc20" }, { address: asset, kind: "erc20" }, client);
    return applySlippageUp(await client.quoteExactOutput(reverseRoute(route).path, unitAmounts[index]!), slippageBps);
  }));
  const totalUnitCost = unitCosts.reduce((sum, value) => sum + value, 0n);
  if (totalUnitCost === 0n) throw new Error("The OTF has no quotable basket cost.");
  let shares = amountIn * ONE_OTF / totalUnitCost;
  if (shares === 0n) throw new Error("The input is too small for this OTF basket.");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const required = await client.previewMint(vault, shares);
    const routes = await Promise.all(assets.map((asset) => routeFor({ address: input.address, kind: "erc20" }, { address: asset, kind: "erc20" }, client)));
    const costs = await Promise.all(required.map(async (amountOut, index) => applySlippageUp(
      await client.quoteExactOutput(reverseRoute(routes[index]!).path, amountOut),
      slippageBps,
    )));
    const spent = costs.reduce((sum, value) => sum + value, 0n);
    if (spent <= amountIn) {
      return {
        shares,
        spent,
        residual: amountIn - spent,
        legs: assets.map((asset, index) => ({
          adapter,
          tokenIn: input.address,
          tokenOut: asset,
          amountIn: costs[index]!,
          minAmountOut: required[index]!,
          data: routes[index]!.path,
          hops: routes[index]!.hops,
        })),
      };
    }
    const nextShares = shares * amountIn / spent;
    shares = nextShares >= shares ? shares - 1n : nextShares;
    if (shares === 0n) break;
  }
  throw new Error("The input is too small after applying route slippage.");
}

async function liquidationPlan(
  vault: Address,
  shares: bigint,
  output: CatalogAsset,
  slippageBps: number,
  adapter: Address,
  client: TestnetRoutingClient,
) {
  const assets = await client.vaultAssets(vault);
  if (assets.length === 0 || assets.length > 20 || assets.some((asset) => testnetAssetRole(asset) !== "fund")) throw new Error("The OTF contains an unsupported testnet constituent.");
  const amounts = await client.previewRedeem(vault, shares);
  if (amounts.length !== assets.length) throw new Error("The OTF redemption preview is malformed.");
  const routes = await Promise.all(assets.map((asset) => routeFor({ address: asset, kind: "erc20" }, { address: output.address, kind: "erc20" }, client)));
  const expected = await Promise.all(amounts.map((amount, index) => client.quoteExactInput(routes[index]!.path, amount)));
  const minimums = expected.map((amount) => applySlippageDown(amount, slippageBps));
  return {
    assets,
    amounts,
    sourceMinimums: amounts.map((amount) => applySlippageDown(amount, slippageBps)),
    expectedOutput: expected.reduce((sum, value) => sum + value, 0n),
    minimumOutput: minimums.reduce((sum, value) => sum + value, 0n),
    legs: assets.map((asset, index): PlannedLeg => ({
      adapter,
      tokenIn: asset,
      tokenOut: output.address,
      amountIn: maxUint256,
      minAmountOut: minimums[index]!,
      data: routes[index]!.path,
      hops: routes[index]!.hops,
    })),
  };
}

function availableResponse(
  request: TestnetPlannerRequest,
  now: number,
  expectedOutput: bigint,
  minimumOutput: bigint,
  routeLabel: string,
  execution: Record<string, unknown>,
  hops: Route["hops"],
  residualRefunds?: readonly { token: Address; amount: string; displayAmount: string }[],
) {
  return {
    status: 200,
    body: {
      state: "available",
      id: `synthra-${request.route}-${request.requestedAtMs}`,
      route: request.route,
      chainId: request.chainId,
      caller: request.caller,
      quotedAtMs: now,
      expiresAtMs: now + QUOTE_LIFETIME_MS,
      inputAmountRaw: request.inputAmountRaw.toString(),
      outputAmount: formatRaw(expectedOutput, request.output.decimals),
      expectedOutput: formatRaw(expectedOutput, request.output.decimals),
      expectedOutputRaw: expectedOutput.toString(),
      minimumReceived: formatRaw(minimumOutput, request.output.decimals),
      minimumReceivedRaw: minimumOutput.toString(),
      routeLabel,
      hops,
      residualRefunds,
      execution,
    },
  };
}

async function directQuote(request: TestnetPlannerRequest, client: TestnetRoutingClient, now: number) {
  if (request.input.kind === "native" || request.output.kind === "native") throw new Error("The deployed Synthra router has no verified atomic native path.");
  const route = await routeFor(request.input, request.output, client);
  const expectedOutput = await client.quoteExactInput(route.path, request.inputAmountRaw);
  const minimumOutput = applySlippageDown(expectedOutput, request.slippageBps);
  const transaction = {
    chainId: request.chainId,
    from: request.caller,
    to: testnetVenue.swapRouter02,
    data: encodeFunctionData({
      abi: synthraSwapRouterAbi,
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
    expiresAtMs: now + QUOTE_LIFETIME_MS,
    approval: { token: request.input.address, spender: testnetVenue.swapRouter02, amount: request.inputAmountRaw.toString() },
    path: route.path,
    transaction,
  }, route.hops);
}

async function basketQuote(
  request: TestnetPlannerRequest,
  client: TestnetRoutingClient,
  now: number,
  router: Address,
  adapter: Address,
) {
  const deadline = BigInt(Math.floor(now / 1_000) + ROUTER_DEADLINE_SECONDS);
  const approval = { token: request.input.address, spender: router, amount: request.inputAmountRaw.toString() };
  if ((request.input.kind === "erc20" || request.input.kind === "native") && request.output.kind === "otf") {
    const nativeInput = request.input.kind === "native";
    const input = testnetQuoteAssets.find((asset) => sameAddress(asset.address, request.input.address));
    if (!input) throw new Error("Basket mint input must be a configured quote asset.");
    const plan = await planMint(request.output.address, input, request.inputAmountRaw, request.slippageBps, adapter, client);
    const residuals = plan.residual > 0n ? [{ token: input.address, amount: plan.residual.toString(), displayAmount: formatRaw(plan.residual, input.decimals) }] : undefined;
    return availableResponse(request, now, plan.shares, plan.shares, "Mint basket", {
      kind: "basket-router",
      chainId: request.chainId,
      caller: request.caller,
      router,
      adapter,
      approval: nativeInput ? undefined : approval,
      nativeValue: nativeInput ? request.inputAmountRaw.toString() : "0",
      funding: serializedFunding([{ token: input.address, amount: request.inputAmountRaw }]),
      method: nativeInput ? "mintFromNative" : "mintFromToken",
      request: { inputToken: input.address, vault: request.output.address, amountIn: request.inputAmountRaw.toString(), minShares: plan.shares.toString(), deadline: deadline.toString() },
      legs: plan.legs.map(serializedLeg),
    }, plan.legs.flatMap((leg) => leg.hops), residuals);
  }
  if (request.input.kind === "otf" && (request.output.kind === "erc20" || request.output.kind === "native")) {
    const nativeOutput = request.output.kind === "native";
    const output = testnetQuoteAssets.find((asset) => sameAddress(asset.address, request.output.address));
    if (!output) throw new Error("Basket redemption output must be a configured quote asset.");
    const plan = await liquidationPlan(request.input.address, request.inputAmountRaw, output, request.slippageBps, adapter, client);
    return availableResponse(request, now, plan.expectedOutput, plan.minimumOutput, "Burn basket", {
      kind: "basket-router",
      chainId: request.chainId,
      caller: request.caller,
      router,
      adapter,
      approval,
      nativeValue: "0",
      funding: serializedFunding(plan.assets.map((token, index) => ({ token, amount: plan.amounts[index]! }))),
      method: nativeOutput ? "redeemToNative" : "redeemToToken",
      request: { vault: request.input.address, outputToken: output.address, shares: request.inputAmountRaw.toString(), minAmountOut: plan.minimumOutput.toString(), deadline: deadline.toString() },
      minBasketAmounts: plan.sourceMinimums.map((amount) => amount.toString()),
      legs: plan.legs.map(serializedLeg),
    }, plan.legs.flatMap((leg) => leg.hops));
  }
  if (request.input.kind === "otf" && request.output.kind === "otf") {
    const usdg = testnetAssetById("usdg")!;
    const liquidation = await liquidationPlan(request.input.address, request.inputAmountRaw, usdg, request.slippageBps, adapter, client);
    const mint = await planMint(request.output.address, usdg, liquidation.minimumOutput, request.slippageBps, adapter, client);
    const residuals = mint.residual > 0n ? [{ token: usdg.address, amount: mint.residual.toString(), displayAmount: formatRaw(mint.residual, usdg.decimals) }] : undefined;
    const legs = [...liquidation.legs, ...mint.legs];
    return availableResponse(request, now, mint.shares, mint.shares, "Burn + mint", {
      kind: "basket-router",
      chainId: request.chainId,
      caller: request.caller,
      router,
      adapter,
      approval,
      nativeValue: "0",
      funding: serializedFunding(liquidation.assets.map((token, index) => ({ token, amount: liquidation.amounts[index]! }))),
      method: "swapBasketToBasket",
      request: { sourceVault: request.input.address, targetVault: request.output.address, sharesIn: request.inputAmountRaw.toString(), minSharesOut: mint.shares.toString(), deadline: deadline.toString() },
      minBasketAmounts: liquidation.sourceMinimums.map((amount) => amount.toString()),
      legs: legs.map(serializedLeg),
    }, legs.flatMap((leg) => leg.hops), residuals);
  }
  throw new Error("Basket settlement requires at least one OTF.");
}

export async function quoteTestnetSwap(
  request: TestnetPlannerRequest,
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
    await assertVaults(request, client);
    return request.route === "direct"
      ? await directQuote(request, client, now)
      : await basketQuote(request, client, now, deployment.entryRouter, deployment.uniswapV3Adapter);
  } catch {
    return { status: 503, body: { state: "unavailable", route: request.route, reason: request.route === "direct" ? "No executable Synthra V3 route is currently available." : "No executable basket route is currently available." } };
  }
}
