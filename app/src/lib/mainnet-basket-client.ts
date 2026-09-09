import { managedOtfVaultAbi, otfFactoryAbi, otfEntryExitRouterAbi } from "@onchaintradedfunds/generated";
import { createPublicClient, decodeFunctionResult, encodeFunctionData, erc20Abi, http, parseAbi, zeroAddress, type Address, type Hex } from "viem";
import { sameAddress, type BasketClient } from "./basket-planner";
import { robinhoodChain } from "./chains";
import { routerArgsForExecution, type BasketRouterExecution } from "./swap-model";
import { v4PoolId, type V4PathKey } from "./v4-route";
import { QuoteFailure } from "./quote-errors";
import { V3_POOL_INIT_CODE_HASH } from "./universal-route";

export type MainnetBasketDeployment = {
  factory: Address; entryRouter: Address; uniswapUniversalRouterAdapter: Address;
  weth: Address; uniswapV3Factory: Address;
  uniswapV4PoolManager: Address; uniswapV4StateView: Address; universalRouter: Address; permit2: Address;
};
export type BasketSimulation = { amountOut: bigint; refunds: readonly { token: Address; amount: bigint }[]; gasUsed: bigint };
export type MainnetBasketClient = BasketClient & {
  verifyBindings(): Promise<void>;
  isVault(vault: Address): Promise<boolean>;
  decimals(token: Address): Promise<number>;
  authenticatePool(tokenIn: Address, tokenOut: Address, fee: number, pool: Address): Promise<void>;
  authenticateV4Pool(tokenIn: Address, hop: V4PathKey): Promise<void>;
  simulate(execution: BasketRouterExecution): Promise<BasketSimulation>;
};

const bindings = parseAbi([
  "function factory() view returns (address)",
  "function entryExitRouter() view returns (address)",
  "function uniswapV3Factory() view returns (address)",
  "function v3PoolInitCodeHash() view returns (bytes32)",
  "function uniswapV4PoolManager() view returns (address)",
  "function uniswapV4StateView() view returns (address)",
  "function uniswapUniversalRouter() view returns (address)",
  "function permit2() view returns (address)",
  "function poolManager() view returns (address)",
  "function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)",
  "function weth() view returns (address)",
  "function isAdapterApproved(address) view returns (bool)",
  "function getPool(address,address,uint24) view returns (address)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
]);

export function basketSimulationCalls(execution: BasketRouterExecution) {
  const calls: { to: Address; data: Hex; value?: bigint }[] = [];
  if (execution.approval) {
    for (const amount of [0n, execution.approval.amount]) calls.push({
      to: execution.approval.token,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [execution.approval.spender, amount] }),
    });
  }
  calls.push({
    to: execution.router, value: execution.nativeValue,
    data: encodeFunctionData({ abi: otfEntryExitRouterAbi, functionName: execution.call.method, args: routerArgsForExecution(execution.call) as never }),
  });
  return calls;
}

export function mainnetBasketClient(deployment: MainnetBasketDeployment): MainnetBasketClient {
  const rpc = process.env.RH_MAINNET_RPC_URL?.trim() || robinhoodChain.rpcUrls.default.http[0];
  const client = createPublicClient({ chain: robinhoodChain, transport: http(rpc, { timeout: 12_000, retryCount: 0 }) });
  const binding = async (address: Address, functionName: "factory" | "entryExitRouter" | "uniswapV3Factory" | "weth" | "uniswapV4PoolManager" | "uniswapV4StateView" | "uniswapUniversalRouter" | "permit2" | "poolManager", expected: Address) => {
    const actual = await client.readContract({ address, abi: bindings, functionName });
    if (!sameAddress(actual, expected)) throw new Error("Mainnet basket deployment binding mismatch.");
  };
  return {
    async verifyBindings() {
      if (await client.getChainId() !== 4663) throw new Error("Wrong mainnet RPC chain.");
      await Promise.all(Object.values(deployment).map(async (address) => {
        const code = await client.getCode({ address });
        if (!code || code === "0x") throw new Error("Missing mainnet contract.");
      }));
      await Promise.all([
        binding(deployment.entryRouter, "factory", deployment.factory),
        binding(deployment.entryRouter, "weth", deployment.weth),
        binding(deployment.factory, "entryExitRouter", deployment.entryRouter),
        binding(deployment.uniswapUniversalRouterAdapter, "uniswapV3Factory", deployment.uniswapV3Factory),
        binding(deployment.uniswapUniversalRouterAdapter, "entryExitRouter", deployment.entryRouter),
        binding(deployment.uniswapUniversalRouterAdapter, "weth", deployment.weth),
        binding(deployment.uniswapUniversalRouterAdapter, "uniswapV4PoolManager", deployment.uniswapV4PoolManager),
        binding(deployment.uniswapUniversalRouterAdapter, "uniswapV4StateView", deployment.uniswapV4StateView),
        binding(deployment.uniswapUniversalRouterAdapter, "uniswapUniversalRouter", deployment.universalRouter),
        binding(deployment.uniswapUniversalRouterAdapter, "permit2", deployment.permit2),
        binding(deployment.uniswapV4StateView, "poolManager", deployment.uniswapV4PoolManager),
        binding(deployment.universalRouter, "poolManager", deployment.uniswapV4PoolManager),
      ]);
      for (const adapter of [deployment.uniswapUniversalRouterAdapter]) {
        if (await client.readContract({ address: adapter, abi: bindings, functionName: "v3PoolInitCodeHash" }) !== V3_POOL_INIT_CODE_HASH) throw new Error("Mainnet V3 pool init-code hash mismatch.");
        if (!await client.readContract({ address: deployment.entryRouter, abi: bindings, functionName: "isAdapterApproved", args: [adapter] })) throw new Error("Mainnet swap adapter is not approved.");
      }
    },
    isVault: (vault) => client.readContract({ address: deployment.factory, abi: otfFactoryAbi, functionName: "isVault", args: [vault] }),
    decimals: (token) => client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
    vaultAssets: (vault) => client.readContract({ address: vault, abi: managedOtfVaultAbi, functionName: "assets" }),
    previewMint: (vault, shares) => client.readContract({ address: vault, abi: managedOtfVaultAbi, functionName: "previewMint", args: [shares] }),
    previewRedeem: (vault, shares, owner, skipMask) => client.readContract({ address: vault, abi: managedOtfVaultAbi, functionName: "previewRedeem", args: [shares, owner, skipMask] }),
    async authenticatePool(tokenIn, tokenOut, fee, pool) {
      const actual = await client.readContract({ address: deployment.uniswapV3Factory, abi: bindings, functionName: "getPool", args: [tokenIn, tokenOut, fee] });
      if (!sameAddress(actual, pool)) throw new Error("Unauthenticated API pool.");
      const [factory, token0, token1, actualFee] = await Promise.all([
        client.readContract({ address: pool, abi: bindings, functionName: "factory" }),
        client.readContract({ address: pool, abi: bindings, functionName: "token0" }),
        client.readContract({ address: pool, abi: bindings, functionName: "token1" }),
        client.readContract({ address: pool, abi: bindings, functionName: "fee" }),
      ]);
      const ordered = [tokenIn, tokenOut].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
      if (!sameAddress(factory, deployment.uniswapV3Factory) || !sameAddress(token0, ordered[0]!)
        || !sameAddress(token1, ordered[1]!) || actualFee !== fee) throw new Error("Invalid V3 pool bindings.");
    },
    async authenticateV4Pool(tokenIn, hop) {
      const [sqrtPriceX96] = await client.readContract({ address: deployment.uniswapV4StateView, abi: bindings, functionName: "getSlot0", args: [v4PoolId(tokenIn, hop)] });
      if (!sqrtPriceX96) throw new Error("Uninitialized V4 pool.");
      if (hop.hooks !== zeroAddress) {
        const code = await client.getCode({ address: hop.hooks });
        if (!code || code === "0x") throw new Error("Missing V4 hook contract.");
      }
    },
    async simulate(execution) {
      // Approval calls affect only this simulation; the caller's actual balances are retained.
      const calls = basketSimulationCalls(execution);
      const result = await client.simulateCalls({ account: execution.caller, calls, validation: false });
      const failedCall = result.results.find((call) => call.status !== "success");
      if (result.results.length !== calls.length || failedCall) throw new QuoteFailure("SIMULATION_FAILED", { cause: failedCall?.error });
      const last = result.results[result.results.length - 1]!;
      const decoded = decodeFunctionResult({ abi: otfEntryExitRouterAbi, functionName: execution.call.method, data: last.data }) as readonly [bigint, readonly Address[], readonly bigint[], bigint?];
      const [amountOut, tokens, amounts] = decoded;
      if (tokens.length !== amounts.length) throw new Error("Malformed basket simulation result.");
      const refunds = tokens.map((token, index) => ({ token, amount: amounts[index]! }));
      if (execution.call.method === "mintFromNative" && decoded[3]) refunds.push({ token: zeroAddress, amount: decoded[3] });
      return { amountOut, refunds, gasUsed: last.gasUsed };
    },
  };
}
