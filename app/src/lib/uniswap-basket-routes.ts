import { getAddress, isAddress, maxUint256, zeroAddress, type Address, type Hex } from "viem";
import { applySlippageDown, applySlippageUp, sameAddress, type BasketRouteProvider } from "./basket-planner";
import { MAX_SWAP_LEGS, type AdapterSwapLeg } from "./swap-model";
import { routeFrom } from "./v3-route";
import { encodeV4Path, parseV4Path, type V4PathKey } from "./v4-route";

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
  v4Adapter?: Address;
  reservedTokens?: readonly Address[];
  slippageBps: number;
  forbiddenTokens: readonly Address[];
  requestQuote(body: RecordValue): Promise<unknown>;
  authenticateV4Pool?(tokenIn: Address, hop: V4PathKey): Promise<void>;
  authenticatePool(tokenIn: Address, tokenOut: Address, fee: number, pool: Address): Promise<void>;
}): BasketRouteProvider {
  return {
    async quote(type, tokenIn, tokenOut, amount) {
      const response = record(await options.requestQuote({
        type, tokenIn, tokenOut, amount: amount.toString(),
        tokenInChainId: options.chainId, tokenOutChainId: options.chainId,
        swapper: options.router, recipient: options.router,
        slippageTolerance: options.slippageBps / 100,
        protocols: options.v4Adapter ? ["V3", "V4"] : ["V3"], routingPreference: "BEST_PRICE",
      }));
      if (response.routing !== "CLASSIC") throw new Error("Basket routing requires CLASSIC pool routes.");
      const quote = record(response.quote);
      const input = record(quote.input);
      const output = record(quote.output);
      if (quote.chainId !== options.chainId || quote.tradeType !== type
        || !sameAddress(address(input.token), tokenIn) || !sameAddress(address(output.token), tokenOut)
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
      let totalInput = 0n;
      let totalOutput = 0n;
      let maximumInput = 0n;
      const splitLegs = await Promise.all(splits.map(async (value: unknown, index: number) => {
        if (!Array.isArray(value) || !value.length || value.length > 3) throw new Error("Invalid route hop count.");
        const pools = value.map(record);
        const tokens: Address[] = [tokenIn];
        const segments: { kind: "v3-pool" | "v4-pool"; tokens: Address[]; fees: number[]; path: V4PathKey[] }[] = [];
        for (const pool of pools) {
          if (pool.type !== "v3-pool" && pool.type !== "v4-pool") throw new Error("Unsupported basket pool type.");
          const from = record(pool.tokenIn);
          const to = record(pool.tokenOut);
          if (from.chainId !== options.chainId || to.chainId !== options.chainId) throw new Error("Wrong route chain.");
          const current = tokens[tokens.length - 1]!;
          if (!sameAddress(address(from.address), current)) throw new Error("Disconnected swap path.");
          for (const token of [from, to]) {
            if (Number(token.buyFeeBps ?? 0) !== 0 || Number(token.sellFeeBps ?? 0) !== 0) throw new Error("Transfer-tax tokens are unsupported.");
          }
          const next = address(to.address);
          const fee = Number(pool.fee);
          if (tokens.some((token) => sameAddress(token, next))) throw new Error("Cyclic swap path.");
          let segment = segments[segments.length - 1];
          if (!segment || segment.kind !== pool.type) {
            if (segment && options.reservedTokens?.some((token) => sameAddress(token, current))) throw new Error("Mixed route would consume a reserved basket balance.");
            segment = { kind: pool.type, tokens: [current], fees: [], path: [] };
            segments.push(segment);
          }
          if (pool.type === "v3-pool") {
            if (!Number.isInteger(fee) || fee <= 0 || fee >= 1_000_000) throw new Error("Invalid V3 fee.");
            await options.authenticatePool(current, next, fee, address(pool.address));
          } else {
            if (!options.v4Adapter || !options.authenticateV4Pool) throw new Error("V4 routing is not configured.");
            const hookData = pool.hookData ?? "0x";
            if (typeof hookData !== "string" || !/^0x(?:[a-fA-F0-9]{2})*$/.test(hookData) || hookData.length > 2050) throw new Error("Invalid V4 hook data.");
            const hop: V4PathKey = { intermediateCurrency: next, fee, tickSpacing: Number(pool.tickSpacing), hooks: address(pool.hooks, true), hookData: hookData as Hex };
            parseV4Path(encodeV4Path([hop]), current);
            await options.authenticateV4Pool(current, hop);
            segment.path.push(hop);
          }
          tokens.push(next);
          segment.tokens.push(next);
          segment.fees.push(fee);
        }
        if (!sameAddress(tokens[tokens.length - 1]!, tokenOut)
          || tokens.some((token) => options.forbiddenTokens.some((forbidden) => sameAddress(token, forbidden)))) throw new Error("Wrong basket path endpoint.");
        const splitInput = uint(pools[0]!.amountIn);
        const splitOutput = uint(pools[pools.length - 1]!.amountOut);
        if (!splitInput || !splitOutput) throw new Error("Empty split route.");
        const budget = type === "EXACT_OUTPUT" ? applySlippageUp(splitInput, options.slippageBps) : splitInput;
        totalInput += splitInput;
        totalOutput += splitOutput;
        maximumInput += budget;
        return segments.map((segment, segmentIndex): AdapterSwapLeg => {
          const first = segmentIndex === 0;
          const last = segmentIndex === segments.length - 1;
          const minimum = last ? type === "EXACT_OUTPUT" ? splitOutput : applySlippageDown(splitOutput, options.slippageBps) : 1n;
          const input = segment.tokens[0]!;
          const output = segment.tokens[segment.tokens.length - 1]!;
          const v4 = segment.kind === "v4-pool";
          if (v4 && ((first && budget > (1n << 128n) - 1n) || minimum > (1n << 128n) - 1n)) throw new Error("V4 amount exceeds adapter limits.");
          const data = v4 ? encodeV4Path(segment.path) : routeFrom(segment.tokens, segment.fees).path;
          return {
            adapter: v4 ? options.v4Adapter! : options.adapter, tokenIn: input, tokenOut: output,
            amountIn: !first || (type === "EXACT_INPUT" && index === splits.length - 1) ? maxUint256 : budget,
            minAmountOut: minimum, data,
            hops: v4 ? parseV4Path(data, input) : routeFrom(segment.tokens, segment.fees).hops,
          };
        });
      }));
      const legs = splitLegs.flat();
      if (legs.length > MAX_SWAP_LEGS) throw new Error("Route exceeds the leg limit.");
      if (totalInput !== amountIn || totalOutput !== amountOut) throw new Error("Split route amounts do not match the quote.");
      return {
        amountIn: type === "EXACT_OUTPUT" ? maximumInput : amountIn,
        amountOut, legs,
      };
    },
  };
}
