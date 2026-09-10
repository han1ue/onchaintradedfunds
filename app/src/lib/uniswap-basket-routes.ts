import { getAddress, isAddress, maxUint256, zeroAddress, type Address, type Hex } from "viem";
import { applySlippageDown, applySlippageUp, sameAddress, type BasketRouteProvider, type BasketRouteQuote } from "./basket-planner";
import { MAX_SWAP_LEGS, type AdapterSwapLeg } from "./swap-model";
import { routeFrom } from "./v3-route";
import { encodeV4Path, parseV4Path, v4BoundaryToken, type V4PathKey } from "./v4-route";
import { QuoteFailure, quoteStep } from "./quote-errors";
import { universalRouteData } from "./universal-route";
import { quoteRegisteredPath, routeSegments, type RegisteredPath, type RouteSegment, type SegmentQuote } from "./registered-routes";
import { v4PoolId } from "./v4-route";
import type { CatalogAsset } from "./asset-catalog";

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Uniswap route object.");
  return value as RecordValue;
}
function address(value: unknown, allowZero = false): Address {
  if (typeof value !== "string" || !isAddress(value) || (!allowZero && sameAddress(value, zeroAddress))) throw new Error("Invalid route token.");
  return getAddress(value);
}
function uint(value: unknown): bigint {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) throw new Error("Invalid route amount.");
  const amount = BigInt(value);
  if (amount > maxUint256) throw new Error("Route amount overflow.");
  return amount;
}

// Route shape: Uniswap/interface packages/api/src/clients/trading/api.json, ClassicQuote/V3PoolInRoute/V4PoolInRoute.
export function uniswapBasketRoutes(options: {
  chainId: number;
  router: Address;
  adapter: Address;
  weth: Address;
  poolManager?: Address;
  quoteSegment?(segment: RouteSegment, type: "EXACT_INPUT" | "EXACT_OUTPUT", amount: bigint): Promise<SegmentQuote>;
  reservedTokens?: readonly Address[];
  slippageBps: number;
  forbiddenTokens: readonly Address[];
  requestQuote(body: RecordValue): Promise<unknown>;
  authenticateV4Pool?(tokenIn: Address, hop: V4PathKey): Promise<void>;
  authenticatePool(tokenIn: Address, tokenOut: Address, fee: number, pool: Address): Promise<void>;
}): BasketRouteProvider {
  const boundary = (currency: Address) => v4BoundaryToken(currency, options.weth);
  const quoteCandidate: BasketRouteProvider["quote"] = async (type, tokenIn, tokenOut, amount) => {
    const response = record(await quoteStep("PROVIDER_UNAVAILABLE", () => options.requestQuote({
      type, tokenIn, tokenOut, amount: amount.toString(),
      tokenInChainId: options.chainId, tokenOutChainId: options.chainId,
      swapper: options.router, recipient: options.router,
      slippageTolerance: options.slippageBps / 100,
      protocols: ["V3", "V4"], routingPreference: "BEST_PRICE",
    })));
    if (response.routing !== "CLASSIC") throw new Error("Basket routing requires CLASSIC pool routes.");
    const quote = record(response.quote);
    const input = record(quote.input);
    const output = record(quote.output);
    if (quote.chainId !== options.chainId || quote.tradeType !== type
      || !sameAddress(address(input.token, true), tokenIn) || !sameAddress(address(output.token, true), tokenOut)
      || !sameAddress(address(quote.swapper), options.router)
      || !sameAddress(address(output.recipient), options.router)) throw new Error("Quote does not match the basket leg.");
    for (const endpoint of [input, output]) {
      if (endpoint.chainId !== undefined && endpoint.chainId !== options.chainId) throw new Error("Wrong quote chain.");
    }
    if (Number(quote.portionBips ?? 0) !== 0 || uint(quote.portionAmount ?? "0") !== 0n) throw new Error("Basket route fees are unsupported.");
    const amountIn = uint(input.amount);
    const amountOut = uint(output.amount);
    if (!amountIn || !amountOut || (type === "EXACT_INPUT" ? amountIn : amountOut) !== amount) throw new Error("Wrong exact quote amount.");
    if (!Array.isArray(quote.route) || !quote.route.length || quote.route.length > MAX_SWAP_LEGS) throw new Error("Invalid split route.");
    const splits = quote.route;
    const authenticatedPaths: RegisteredPath[] = [];
    const discoveredPaths: NonNullable<BasketRouteQuote["discoveredPaths"]> = [];
    let totalInput = 0n;
    let totalOutput = 0n;
    let maximumInput = 0n;
    const splitLegs = await Promise.all(splits.map(async (value: unknown, index: number) => {
      if (!Array.isArray(value) || !value.length || value.length > 3) throw new Error("Invalid route hop count.");
      const pools = value.map(record);
      const authenticatedPath: RegisteredPath = [];
      const tokens: Address[] = [];
      const segments: { kind: "v3-pool" | "v4-pool"; tokens: Address[]; fees: number[]; path: V4PathKey[] }[] = [];
      for (const pool of pools) {
        if (pool.type !== "v3-pool" && pool.type !== "v4-pool") throw new Error("Unsupported basket pool type.");
        const from = record(pool.tokenIn);
        const to = record(pool.tokenOut);
        if (from.chainId !== options.chainId || to.chainId !== options.chainId) throw new Error("Wrong route chain.");
        const current = address(from.address, pool.type === "v4-pool");
        const previous = tokens[tokens.length - 1] ?? tokenIn;
        if (!sameAddress(boundary(current), boundary(previous))) throw new Error("Disconnected swap path.");
        if (!tokens.length) tokens.push(current);
        for (const token of [from, to]) {
          if (Number(token.buyFeeBps ?? 0) !== 0 || Number(token.sellFeeBps ?? 0) !== 0) throw new Error("Transfer-tax tokens are unsupported.");
        }
        const next = address(to.address, pool.type === "v4-pool");
        const fee = Number(pool.fee);
        if (tokens.some((token) => sameAddress(boundary(token), boundary(next)))) throw new Error("Cyclic swap path.");
        let segment = segments[segments.length - 1];
        if (!segment || segment.kind !== pool.type || !sameAddress(previous, current)) {
          if (segment && options.reservedTokens?.some((token) => sameAddress(token, boundary(current)))) throw new Error("Mixed route would consume a reserved basket balance.");
          segment = { kind: pool.type, tokens: [current], fees: [], path: [] };
          segments.push(segment);
        }
        if (pool.type === "v3-pool") {
          if (!Number.isInteger(fee) || fee <= 0 || fee >= 1_000_000) throw new Error("Invalid V3 fee.");
          await quoteStep("POOL_VALIDATION_FAILED", () => options.authenticatePool(current, next, fee, address(pool.address)));
        } else {
          if (!options.authenticateV4Pool) throw new Error("V4 routing is not configured.");
          const hookData = pool.hookData ?? "0x";
          if (typeof hookData !== "string" || !/^0x(?:[a-fA-F0-9]{2})*$/.test(hookData) || hookData.length > 2050) throw new Error("Invalid V4 hook data.");
          const hop: V4PathKey = { intermediateCurrency: next, fee, tickSpacing: Number(pool.tickSpacing), hooks: address(pool.hooks, true), hookData: hookData as Hex };
          parseV4Path(encodeV4Path(current, [hop]));
          await quoteStep("POOL_VALIDATION_FAILED", () => options.authenticateV4Pool!(current, hop));
          segment.path.push(hop);
        }
        tokens.push(next);
        const asset = (token: Address): CatalogAsset => ({ id: token, chainId: options.chainId, address: token,
          decimals: 18, symbol: "", name: "", assetType: "other", enabled: true, verified: false, featured: false });
        const v4Hop: V4PathKey = { intermediateCurrency: next, fee, tickSpacing: Number(pool.tickSpacing), hooks: pool.hooks as Address, hookData: (pool.hookData ?? "0x") as Hex };
        // Ephemeral authenticated path metadata, never written to or approved in the registry.
        authenticatedPath.push({ tokenIn: current, tokenOut: next, pool: {
          id: String(pool.address ?? (pool.type === "v4-pool" ? v4PoolId(current, v4Hop) : "")), chainId: options.chainId,
          venue: "uniswap", protocolVersion: pool.type === "v3-pool" ? 3 : 4,
          assetA: asset(current), assetB: asset(next), address: pool.type === "v3-pool" ? address(pool.address) : undefined,
          poolManager: pool.type === "v4-pool" ? options.poolManager : undefined,
          poolId: pool.type === "v4-pool" ? v4PoolId(current, v4Hop) : undefined,
          fee, tickSpacing: pool.type === "v4-pool" ? v4Hop.tickSpacing : undefined,
          hooks: pool.type === "v4-pool" ? v4Hop.hooks : undefined, hookData: (pool.hookData ?? "0x") as Hex,
          approved: false, enabled: true, validationMetadata: {},
        } });
        segment.tokens.push(next);
        segment.fees.push(fee);
      }
      if (!sameAddress(boundary(tokens[tokens.length - 1]!), boundary(tokenOut))
        || tokens.some((token) => options.forbiddenTokens.some((forbidden) => sameAddress(boundary(token), forbidden)))) throw new Error("Wrong basket path endpoint.");
      const splitInput = uint(pools[0]!.amountIn);
      const splitOutput = uint(pools[pools.length - 1]!.amountOut);
      if (!splitInput || !splitOutput) throw new Error("Empty split route.");
      const budget = type === "EXACT_OUTPUT" ? applySlippageUp(splitInput, options.slippageBps) : splitInput;
      totalInput += splitInput;
      totalOutput += splitOutput;
      maximumInput += budget;
      authenticatedPaths[index] = authenticatedPath;
      discoveredPaths[index] = { path: authenticatedPath, amountIn: splitInput, amountOut: splitOutput };
      return segments.map((segment, segmentIndex): AdapterSwapLeg => {
        const first = segmentIndex === 0;
        const last = segmentIndex === segments.length - 1;
        const minimum = last ? type === "EXACT_OUTPUT" ? splitOutput : applySlippageDown(splitOutput, options.slippageBps) : 1n;
        const input = segment.tokens[0]!;
        const output = segment.tokens[segment.tokens.length - 1]!;
        const v4 = segment.kind === "v4-pool";
        if (sameAddress(boundary(input), boundary(output))) throw new Error("Adapter leg has identical boundary tokens.");
        if (v4 && ((first && budget > (1n << 128n) - 1n) || minimum > (1n << 128n) - 1n)) throw new Error("V4 amount exceeds adapter limits.");
        const data = v4 ? encodeV4Path(input, segment.path) : routeFrom(segment.tokens, segment.fees).path;
        return {
          adapter: options.adapter, tokenIn: boundary(input), tokenOut: boundary(output),
          amountIn: !first || (type === "EXACT_INPUT" && index === splits.length - 1) ? maxUint256 : budget,
          minAmountOut: minimum, data: universalRouteData(v4 ? 4 : 3, data),
          hops: v4 ? parseV4Path(data) : routeFrom(segment.tokens, segment.fees).hops,
        };
      });
    }));
    const legs = splitLegs.flat();
    if (legs.length > MAX_SWAP_LEGS) throw new Error("Route exceeds the leg limit.");
    if (totalInput !== amountIn || totalOutput !== amountOut) throw new Error("Split route amounts do not match the quote.");
    return {
      amountIn: type === "EXACT_OUTPUT" ? maximumInput : amountIn,
      amountOut, legs, authenticatedPath: splits.length === 1 ? authenticatedPaths[0] : undefined, discoveredPaths,
    };
  };
  // One discovery request per endpoint pair, including failed requests and all sizing passes.
  const discoveries = new Map<string, Promise<BasketRouteQuote>>();
  const quotes = new Map<string, Promise<BasketRouteQuote>>();
  return {
    async quote(type, tokenIn, tokenOut, amount) {
      const key = `${type}:${tokenIn.toLowerCase()}:${tokenOut.toLowerCase()}:${amount}`;
      let pending = quotes.get(key);
      if (!pending) {
        const pair = `${tokenIn.toLowerCase()}:${tokenOut.toLowerCase()}`;
        const existing = discoveries.get(pair);
        if (!existing) {
          pending = quoteStep("INVALID_PROVIDER_QUOTE", () => quoteCandidate(type, tokenIn, tokenOut, amount), { tokenIn, tokenOut });
          discoveries.set(pair, pending);
        } else {
          pending = existing.then(async discovered => {
            if (!discovered.discoveredPaths?.length || !options.quoteSegment) throw new QuoteFailure("NO_ROUTE");
            const total = discovered.discoveredPaths.reduce((sum, split) => sum + (type === "EXACT_INPUT" ? split.amountIn : split.amountOut), 0n);
            let assigned = 0n;
            const quotes = await Promise.all(discovered.discoveredPaths.map(async (split, splitIndex, splits) => {
            const exact = splitIndex === splits.length - 1 ? amount - assigned : amount * (type === "EXACT_INPUT" ? split.amountIn : split.amountOut) / total;
            assigned += exact;
            if (!exact) throw new QuoteFailure("NO_ROUTE");
            const quoted = await quoteRegisteredPath(split.path, type, exact, options.quoteSegment!);
            const amountIn = type === "EXACT_OUTPUT" ? applySlippageUp(quoted.amountIn, options.slippageBps) : quoted.amountIn;
            const legs = routeSegments(quoted.path).map((segment, index): AdapterSwapLeg => ({
              adapter: options.adapter, tokenIn: boundary(segment.tokens[0]!), tokenOut: boundary(segment.tokens.at(-1)!),
              amountIn: index === 0 && (type === "EXACT_OUTPUT" || splitIndex !== splits.length - 1) ? amountIn : maxUint256,
              minAmountOut: index === quoted.segments.length - 1 ? type === "EXACT_OUTPUT" ? quoted.amountOut : applySlippageDown(quoted.amountOut, options.slippageBps) : 1n,
              data: universalRouteData(segment.version, segment.data),
              hops: segment.version === 3 ? routeFrom(segment.tokens, segment.hops.map(hop => hop.pool.fee)).hops : parseV4Path(segment.data),
            }));
            return { amountIn, amountOut: quoted.amountOut, legs, authenticatedPath: quoted.path };
            }));
            return { amountIn: quotes.reduce((sum, quote) => sum + quote.amountIn, 0n), amountOut: quotes.reduce((sum, quote) => sum + quote.amountOut, 0n),
              legs: quotes.flatMap(quote => quote.legs), authenticatedPath: quotes.length === 1 ? quotes[0]!.authenticatedPath : undefined,
              discoveredPaths: discovered.discoveredPaths };
          });
        }
        quotes.set(key, pending);
      }
      return pending;
    },
  };
}
