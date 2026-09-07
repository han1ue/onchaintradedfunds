import { getAddress, maxUint256, type Address } from "viem";
import { describe, expect, it, vi } from "vitest";
import { uniswapBasketRoutes } from "./uniswap-basket-routes";
import { encodeV3Path } from "./v3-route";

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
  return { chainId: 4663, router: ROUTER, adapter: ADAPTER, slippageBps: 50, forbiddenTokens: [],
    requestQuote: vi.fn(async () => response), authenticatePool: vi.fn(async () => {}) };
}
describe("Uniswap basket route translation", () => {
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
    await expect(uniswapBasketRoutes({ ...options(), forbiddenTokens: [C] }).quote("EXACT_INPUT", A, B, 10000n)).rejects.toThrow(/endpoint/);
  });
});
