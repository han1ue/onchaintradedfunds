import { getAddress, maxUint256, zeroAddress, type Address } from "viem";
import { describe, expect, it, vi } from "vitest";
import { uniswapBasketRoutes } from "./uniswap-basket-routes";
import { encodeV3Path } from "./v3-route";
import { parseV4Path } from "./v4-route";

const addr = (n: number) => getAddress(`0x${n.toString(16).padStart(40, "0")}` as Address);
const A = addr(1), B = addr(2), C = addr(3), ROUTER = addr(4), ADAPTER = addr(5);
function fixture() {
  return { routing: "CLASSIC", quote: {
    chainId: 4663, tradeType: "EXACT_INPUT", swapper: ROUTER,
    input: { token: A, amount: "10000" }, output: { token: B, amount: "20000", recipient: ROUTER },
    route: [[
      { type: "v3-pool", address: addr(10), tokenIn: { address: A, chainId: 4663 }, tokenOut: { address: C, chainId: 4663 }, fee: "3000", amountIn: "10000" },
      { type: "v3-pool", address: addr(11), tokenIn: { address: C, chainId: 4663 }, tokenOut: { address: B, chainId: 4663 }, fee: "500", amountOut: "20000" },
    ]],
  } };
}
function options(response = fixture()) {
  return { chainId: 4663, router: ROUTER, adapter: ADAPTER, weth: addr(99), slippageBps: 50, forbiddenTokens: [],
    requestQuote: vi.fn(async () => response), authenticatePool: vi.fn(async () => {}) };
}
describe("Uniswap basket route translation", () => {
  it.each([false, true])("connects V3/WETH and V4/ETH segments (v4First=%s)", async (v4First) => {
    const response = fixture();
    const first = response.quote.route[0]![0]!, last = response.quote.route[0]![1]!;
    first.tokenOut.address = v4First ? zeroAddress : C;
    last.tokenIn.address = v4First ? C : zeroAddress;
    Object.assign(v4First ? first : last, { type: "v4-pool", tickSpacing: 60, hooks: zeroAddress });
    const dependencies = { ...options(response), weth: C, v4Adapter: addr(6), authenticateV4Pool: vi.fn(async () => {}) };
    const quote = await uniswapBasketRoutes(dependencies).quote("EXACT_INPUT", A, B, 10000n);
    expect(quote.legs).toHaveLength(2);
    expect(quote.legs[0]!.tokenOut).toBe(C);
    expect(quote.legs[1]).toMatchObject({ tokenIn: C, amountIn: maxUint256 });
    const v4Leg = quote.legs[v4First ? 0 : 1]!;
    expect(v4First ? parseV4Path(v4Leg.data)[0]!.tokenOut : parseV4Path(v4Leg.data)[0]!.tokenIn).toBe(zeroAddress);
    await expect(uniswapBasketRoutes({ ...dependencies, reservedTokens: [C] }).quote("EXACT_INPUT", A, B, 10000n)).rejects.toThrow();
  });

  it.each(["EXACT_INPUT", "EXACT_OUTPUT"] as const)("compares native and WETH quotes for %s", async (type) => {
    const requestQuote = vi.fn(async (body: Record<string, unknown>) => {
      const native = body.tokenIn === zeroAddress;
      return { routing: "CLASSIC", quote: {
        chainId: 4663, tradeType: type, swapper: ROUTER,
        input: { token: body.tokenIn, amount: type === "EXACT_INPUT" ? "10000" : native ? "4000" : "5000" },
        output: { token: B, amount: type === "EXACT_OUTPUT" ? "10000" : native ? "25000" : "20000", recipient: ROUTER },
        route: [[{ type: "v4-pool", tokenIn: { address: body.tokenIn, chainId: 4663 }, tokenOut: { address: B, chainId: 4663 },
          amountIn: type === "EXACT_INPUT" ? "10000" : native ? "4000" : "5000", amountOut: type === "EXACT_OUTPUT" ? "10000" : native ? "25000" : "20000",
          fee: "3000", tickSpacing: 60, hooks: zeroAddress }]],
      } };
    });
    const quote = await uniswapBasketRoutes({ ...options(), weth: A, v4Adapter: addr(6), authenticateV4Pool: async () => {}, requestQuote }).quote(type, A, B, 10000n);
    expect(requestQuote).toHaveBeenCalledTimes(2);
    expect(quote.legs[0]!.tokenIn).toBe(A);
    expect(quote.legs[0]!.hops[0]!.tokenIn).toBe(zeroAddress);
    expect(type === "EXACT_INPUT" ? quote.amountOut : quote.amountIn).toBe(type === "EXACT_INPUT" ? 25000n : 4020n);
  });

  it("rejects native currencies in V3 pools", async () => {
    const response = fixture();
    response.quote.route[0]![0]!.tokenOut.address = zeroAddress;
    response.quote.route[0]![1]!.tokenIn.address = zeroAddress;
    await expect(uniswapBasketRoutes(options(response)).quote("EXACT_INPUT", A, B, 10000n)).rejects.toThrow();
  });

  it("preserves a multi-hop path and authenticates every pool", async () => {
    const deps = options();
    const quote = await uniswapBasketRoutes(deps).quote("EXACT_INPUT", A, B, 10000n);
    expect(quote.legs).toMatchObject([{ data: encodeV3Path([A, C, B], [3000, 500]), amountIn: maxUint256, minAmountOut: 19900n }]);
    expect(deps.authenticatePool.mock.calls).toEqual([[A, C, 3000, addr(10)], [C, B, 500, addr(11)]]);
  });

  it.each([
    "routing", "chain", "trade type", "swapper", "recipient", "input", "amount", "disconnected", "cycle", "fee", "protocol", "split sum", "hop chain", "hop limit",
  ])("rejects a malformed %s", async (failure) => {
    const response = fixture(), quote = response.quote, hops = quote.route[0]!;
    switch (failure) {
      case "routing": response.routing = "DUTCH_V3"; break;
      case "chain": quote.chainId = 1; break;
      case "trade type": quote.tradeType = "EXACT_OUTPUT"; break;
      case "swapper": quote.swapper = A; break;
      case "recipient": quote.output.recipient = A; break;
      case "input": quote.input.token = B; break;
      case "amount": quote.input.amount = "10001"; break;
      case "disconnected": hops[1]!.tokenIn.address = A; break;
      case "cycle": hops[1]!.tokenOut.address = A; break;
      case "fee": hops[0]!.fee = "0"; break;
      case "protocol": hops[0]!.type = "v4-pool"; break;
      case "split sum": hops[1]!.amountOut = "19999"; break;
      case "hop chain": hops[0]!.tokenIn.chainId = 1; break;
      case "hop limit": hops.push(hops[0]!, hops[1]!); break;
    }
    await expect(uniswapBasketRoutes(options(response)).quote("EXACT_INPUT", A, B, 10000n)).rejects.toThrow();
  });

  it("rejects routes that pass through the fund share itself", async () => {
    await expect(uniswapBasketRoutes({ ...options(), forbiddenTokens: [C] }).quote("EXACT_INPUT", A, B, 10000n)).rejects.toThrow();
  });
});
