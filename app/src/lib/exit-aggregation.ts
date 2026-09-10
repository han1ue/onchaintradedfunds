import { zeroAddress, type Address } from "viem";
import { applySlippageDown, sameAddress, type BasketRouteQuote } from "./basket-planner";
import { quoteRegisteredPath, routeSegments, REGISTERED_ROUTE_POLICY, type RegisteredHop, type RegisteredPath, type RouteSegment, type SegmentQuote } from "./registered-routes";
import { universalRouteData } from "./universal-route";
import { routeFrom } from "./v3-route";
import { parseV4Path, v4BoundaryToken } from "./v4-route";
import type { AdapterSwapLeg } from "./swap-model";

function identity(hop: RegisteredHop) {
  const pool = hop.pool;
  const market = pool.protocolVersion === 3 ? [pool.address?.toLowerCase(), pool.fee]
    : [pool.poolManager?.toLowerCase(), pool.poolId, pool.fee, pool.tickSpacing, pool.hooks?.toLowerCase(), pool.hookData];
  return [pool.chainId, pool.protocolVersion, ...market,
    hop.tokenIn.toLowerCase(), hop.tokenOut.toLowerCase()].join(":");
}

function compatible(path: RegisteredPath) {
  return path.length > 0 && path.length <= 2 && routeSegments(path).length === 1
    && path.every(({ pool }) => pool.protocolVersion === 3 ? Boolean(pool.address)
      : Boolean(pool.poolManager && pool.poolId && pool.hooks === zeroAddress && pool.hookData === "0x" && pool.fee < 0x800000));
}

/** Merge one final pool step per group. Funding stays explicit; excess inputs are refunded. */
export async function aggregateExitQuotes(quotes: BasketRouteQuote[], options: {
  weth: Address; adapter: Address; slippageBps: number;
  quoteSegment(segment: RouteSegment, type: "EXACT_INPUT" | "EXACT_OUTPUT", amount: bigint): Promise<SegmentQuote>;
  withinTradeSize(token: Address, amount: bigint): Promise<boolean>;
}) {
  const unchanged = () => ({ amountOut: quotes.reduce((sum, quote) => sum + quote.amountOut, 0n), legs: quotes.flatMap(quote => quote.legs) });
  if (quotes.length < 2 || quotes.length > 20) return unchanged();
  const groups = new Map<string, number[]>();
  quotes.forEach((quote, index) => {
    const path = quote.authenticatedPath;
    if (!path || !compatible(path) || quote.legs.length !== 1 || !sameAddress(quote.legs[0]!.adapter, options.adapter)) return;
    const key = identity(path.at(-1)!);
    groups.set(key, [...(groups.get(key) ?? []), index]);
  });
  const replacements = new Map<number, { amountOut: bigint; legs: AdapterSwapLeg[] }>();
  const consumed = new Set<number>();
  for (const indices of groups.values()) {
    if (indices.length < 2 || !indices.some(index => quotes[index]!.authenticatedPath!.length === 2)) continue;
    const paths = indices.map(index => quotes[index]!.authenticatedPath!);
    const tail = paths[0]!.at(-1)!;
    const prefixes = paths.filter(path => path.length === 2).map(path => identity(path[0]!));
    // Independent prefixes only. Unknown/split routes retain their execution unchanged.
    if (new Set(prefixes).size !== prefixes.length || prefixes.includes(identity(tail))) continue;
    try {
      const makeLeg = (path: RegisteredPath, amountIn: bigint, minAmountOut: bigint): AdapterSwapLeg => {
        const segment = routeSegments(path)[0]!;
        return { adapter: options.adapter, tokenIn: v4BoundaryToken(path[0]!.tokenIn, options.weth),
          tokenOut: v4BoundaryToken(path.at(-1)!.tokenOut, options.weth), amountIn, minAmountOut,
          data: universalRouteData(segment.version, segment.data),
          hops: segment.version === 3 ? routeFrom(segment.tokens, segment.hops.map(hop => hop.pool.fee)).hops : parseV4Path(segment.data) };
      };
      const legs: AdapterSwapLeg[] = [];
      let combinedInput = 0n;
      for (const index of indices) {
        const quote = quotes[index]!, path = quote.authenticatedPath!;
        if (path.length === 1) { combinedInput += quote.amountIn; continue; }
        const prefix = await quoteRegisteredPath([path[0]!], "EXACT_INPUT", quote.amountIn, options.quoteSegment);
        // Leave part of the original tolerance for the combined pool's price impact.
        const minimum = applySlippageDown(prefix.amountOut, Math.floor(options.slippageBps / 2));
        combinedInput += minimum;
        legs.push(makeLeg([path[0]!], quote.amountIn, minimum));
      }
      const probeAmount = combinedInput / REGISTERED_ROUTE_POLICY.probeDivisor;
      if (!probeAmount || !await options.withinTradeSize(v4BoundaryToken(tail.tokenIn, options.weth), combinedInput)) continue;
      const combined = await quoteRegisteredPath([tail], "EXACT_INPUT", combinedInput, options.quoteSegment);
      const probe = await quoteRegisteredPath([tail], "EXACT_INPUT", probeAmount, options.quoteSegment);
      const expected = probe.amountOut * combinedInput / probeAmount;
      if (!expected || (expected - combined.amountOut) * 10_000n > expected * BigInt(REGISTERED_ROUTE_POLICY.maxImpactBps)) continue;
      const originalMinimum = indices.reduce((sum, index) => sum + quotes[index]!.legs.at(-1)!.minAmountOut, 0n);
      if (combined.amountOut < originalMinimum) continue;
      const minimum = applySlippageDown(combined.amountOut, options.slippageBps);
      legs.push(makeLeg([tail], combinedInput, minimum > originalMinimum ? minimum : originalMinimum));
      replacements.set(indices[0]!, { amountOut: combined.amountOut, legs });
      indices.slice(1).forEach(index => consumed.add(index));
    } catch { /* Retain the original validated routes when aggregation cannot be quoted. */ }
  }
  return quotes.reduce((result, quote, index) => {
    if (consumed.has(index)) return result;
    const value = replacements.get(index) ?? quote;
    result.amountOut += value.amountOut;
    result.legs.push(...value.legs);
    return result;
  }, { amountOut: 0n, legs: [] as AdapterSwapLeg[] });
}
