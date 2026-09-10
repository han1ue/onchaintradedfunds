import { otfLaunchManagerAbi } from "@onchaintradedfunds/generated";
import { decodeFunctionResult, encodeFunctionData, maxUint256, parseAbi, type Address, type PublicClient } from "viem";
import { applySlippageDown, applySlippageUp, sameAddress, type BasketRouteProvider } from "./basket-planner";
import { QuoteFailure, quoteStep } from "./quote-errors";
import { encodeV4Path, parseV4Path } from "./v4-route";
import { universalRouteData } from "./universal-route";

export type CanonicalOtfDeployment = {
  entryRouter: Address; uniswapUniversalRouterAdapter: Address;
  otfToken: Address; weth: Address; launchManager: Address;
  uniswapV4PoolManager: Address; uniswapV4StateView: Address;
  universalRouter: Address; permit2: Address; uniswapV4Quoter: Address;
};
export type CanonicalOtfQuoteClient = {
  verifyOtfBindings(router: Address, adapter: Address): Promise<void>;
  quoteOtf(type: "EXACT_INPUT" | "EXACT_OUTPUT", buy: boolean, amount: bigint): Promise<bigint>;
};

export const otfQuoterAbi = parseAbi([
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
  "function quoteExactOutputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountIn,uint256 gasEstimate)",
]);
const bindings = parseAbi([
  "function entryExitRouter() view returns (address)",
  "function weth() view returns (address)",
  "function uniswapV4PoolManager() view returns (address)",
  "function uniswapV4StateView() view returns (address)",
  "function uniswapUniversalRouter() view returns (address)",
  "function permit2() view returns (address)",
  "function poolManager() view returns (address)",
  "function isAdapterApproved(address) view returns (bool)",
]);

export function canonicalOtfRouting(client: Pick<PublicClient, "readContract" | "call">, deployment: Partial<CanonicalOtfDeployment>): CanonicalOtfQuoteClient {
  let verified: Promise<void> | undefined;
  const { otfToken, weth, launchManager, uniswapUniversalRouterAdapter, entryRouter,
    uniswapV4PoolManager: poolManager, uniswapV4StateView: stateView, universalRouter, permit2, uniswapV4Quoter: quoter } = deployment;
  const verify = async (router: Address, adapter: Address) => {
    if (!entryRouter || !uniswapUniversalRouterAdapter || !launchManager || !weth || !otfToken || !quoter || !poolManager || !stateView || !universalRouter || !permit2
      || !sameAddress(router, entryRouter) || !sameAddress(adapter, uniswapUniversalRouterAdapter)) throw new Error("The OTF basket adapter is unavailable.");
    const checks = [
      [adapter, "entryExitRouter", router], [adapter, "weth", weth],
      [adapter, "uniswapV4PoolManager", poolManager],
      [adapter, "uniswapV4StateView", stateView],
      [adapter, "uniswapUniversalRouter", universalRouter],
      [adapter, "permit2", permit2],
      [quoter, "poolManager", poolManager],
      [stateView, "poolManager", poolManager],
      [universalRouter, "poolManager", poolManager],
    ] as const;
    await Promise.all(checks.map(async ([address, functionName, expected]) => {
      const actual = await client.readContract({ address, abi: bindings, functionName });
      if (!sameAddress(actual, expected)) throw new Error(`Invalid OTF adapter ${functionName} binding.`);
    }));
    if (!await client.readContract({ address: router, abi: bindings, functionName: "isAdapterApproved", args: [adapter] })) throw new Error("The OTF basket adapter is not approved.");
    const key = await client.readContract({ address: launchManager, abi: otfLaunchManagerAbi, functionName: "poolKey" });
    const ordered = [otfToken, weth].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
    if (!sameAddress(key[0], ordered[0]!) || !sameAddress(key[1], ordered[1]!) || key[2] !== 0 || key[3] !== 1 || !sameAddress(key[4], launchManager)) throw new Error("Invalid canonical OTF pool.");
  };
  return {
    verifyOtfBindings(router: Address, adapter: Address) {
      if (!entryRouter || !uniswapUniversalRouterAdapter || !sameAddress(router, entryRouter)
        || !sameAddress(adapter, uniswapUniversalRouterAdapter)) return Promise.reject(new Error("The OTF basket adapter is unavailable."));
      return verified ??= verify(router, adapter);
    },
    async quoteOtf(type: "EXACT_INPUT" | "EXACT_OUTPUT", buy: boolean, amount: bigint) {
      if (!verified) throw new Error("OTF pool bindings have not been checked.");
      await verified;
      if (amount <= 0n || amount > (1n << 128n) - 1n) throw new Error("OTF quote amount exceeds adapter limits.");
      const [currency0, currency1] = [otfToken!, weth!].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
      const functionName = type === "EXACT_INPUT" ? "quoteExactInputSingle" : "quoteExactOutputSingle";
      const data = encodeFunctionData({ abi: otfQuoterAbi, functionName, args: [{
        poolKey: { currency0: currency0!, currency1: currency1!, fee: 0, tickSpacing: 1, hooks: launchManager! },
        zeroForOne: sameAddress(buy ? weth! : otfToken!, currency0!), exactAmount: amount, hookData: "0x",
      }] });
      const result = await client.call({ to: quoter!, data });
      if (!result.data) throw new Error("The OTF quoter returned no data.");
      const [quoted] = decodeFunctionResult({ abi: otfQuoterAbi, functionName, data: result.data });
      if (quoted <= 0n) throw new Error("The OTF pool has no quote for this amount.");
      return quoted;
    },
  };
}

export function canonicalOtfBasketRoutes(routes: BasketRouteProvider, options: {
  otfToken?: Address; weth: Address; launchManager?: Address;
  entryRouter: Address; uniswapUniversalRouterAdapter: Address;
  slippageBps: number; client: Partial<CanonicalOtfQuoteClient>;
}): BasketRouteProvider {
  const { otfToken, weth, launchManager, entryRouter, uniswapUniversalRouterAdapter: adapter, slippageBps, client } = options;
  const isOtf = (token: Address) => Boolean(otfToken && sameAddress(token, otfToken));
  return {
    optimizeMint: routes.optimizeMint,
    optimizeExit: routes.optimizeExit,
    async quote(type, tokenIn, tokenOut, amount) {
      if (!isOtf(tokenIn) && !isOtf(tokenOut)) return routes.quote(type, tokenIn, tokenOut, amount);
      if (!launchManager || !client.verifyOtfBindings || !client.quoteOtf) throw new QuoteFailure("ROUTE_NOT_CONFIGURED");
      await quoteStep("DEPLOYMENT_MISMATCH", () => client.verifyOtfBindings!(entryRouter, adapter));
      const buy = isOtf(tokenOut);
      const currencyIn = buy ? weth : tokenIn;
      const currencyOut = buy ? tokenOut : weth;
      const data = encodeV4Path(currencyIn, [{ intermediateCurrency: currencyOut, fee: 0, tickSpacing: 1, hooks: launchManager, hookData: "0x" }]);
      const leg = (amountIn: bigint, minAmountOut: bigint) => ({ adapter, tokenIn: currencyIn, tokenOut: currencyOut, amountIn, minAmountOut, data: universalRouteData(4, data), hops: parseV4Path(data) });
      if (type === "EXACT_OUTPUT" && buy) {
        const wethIn = applySlippageUp(await quoteStep("NO_ROUTE", () => client.quoteOtf!(type, true, amount)), slippageBps);
        // Execution is exact input: check the padded amount against the hook's price bounds too.
        if (await quoteStep("NO_ROUTE", () => client.quoteOtf!("EXACT_INPUT", true, wethIn)) < amount) throw new QuoteFailure("MINIMUM_OUTPUT_NOT_MET");
        const funding = sameAddress(tokenIn, weth) ? { amountIn: wethIn, legs: [] } : await routes.quote(type, tokenIn, weth, wethIn);
        return { amountIn: funding.amountIn, amountOut: amount, legs: [...funding.legs, leg(wethIn, amount)] };
      }
      if (type === "EXACT_INPUT" && !buy) {
        const wethOut = await quoteStep("NO_ROUTE", () => client.quoteOtf!(type, false, amount));
        const minimumWeth = applySlippageDown(wethOut, slippageBps);
        if (sameAddress(tokenOut, weth)) return { amountIn: amount, amountOut: wethOut, legs: [leg(amount, minimumWeth)] };
        const settlement = await routes.quote(type, weth, tokenOut, minimumWeth);
        // Bound only WETH funding legs. Other segments keep their own currency amounts.
        let remaining = minimumWeth;
        const settlementLegs = settlement.legs.map(entry => {
          if (!sameAddress(entry.tokenIn, weth)) return entry;
          const amountIn = entry.amountIn === maxUint256 ? remaining : entry.amountIn;
          if (amountIn > remaining) throw new QuoteFailure("ROUTE_POLICY_EXCEEDED");
          remaining -= amountIn;
          return { ...entry, amountIn };
        });
        return { amountIn: amount, amountOut: settlement.amountOut, legs: [leg(amount, minimumWeth), ...settlementLegs] };
      }
      throw new Error("Unsupported OTF basket leg direction.");
    },
  };
}
