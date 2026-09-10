import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeFunctionResult, maxUint256, zeroAddress, type Address, type PublicClient } from "viem";
import { robinhoodTestnetAddresses, robinhoodTestnetV4, robinhoodMainnetV4, robinhoodMainnetAddresses } from "./deployment";
import { canonicalOtfBasketRoutes, canonicalOtfRouting, otfQuoterAbi, type CanonicalOtfDeployment } from "./canonical-otf-routing";
import { routeFrom } from "./v3-route";
import { universalRouteData } from "./universal-route";
import type { BasketRouteProvider } from "./basket-planner";

const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const deployments = [
  { name: "testnet", addresses: robinhoodTestnetAddresses, v4: robinhoodTestnetV4 },
  { name: "mainnet", addresses: { ...robinhoodMainnetAddresses, otfToken: addr(1), launchManager: addr(2), entryRouter: addr(3), uniswapUniversalRouterAdapter: addr(4) }, v4: robinhoodMainnetV4 },
].map(({ name, addresses, v4 }) => ({ name, deployment: {
  entryRouter: addresses.entryRouter!, uniswapUniversalRouterAdapter: addresses.uniswapUniversalRouterAdapter!,
  otfToken: addresses.otfToken!, weth: addresses.weth!, launchManager: addresses.launchManager!,
  uniswapV4PoolManager: v4.poolManager!, uniswapV4StateView: v4.stateView!,
  universalRouter: v4.universalRouter!, permit2: v4.permit2!, uniswapV4Quoter: v4.quoter!,
} satisfies CanonicalOtfDeployment }));

function reader(addresses: CanonicalOtfDeployment, overrides: Record<string, unknown> = {}) {
  const currencies = [addresses.otfToken!, addresses.weth!].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
  const values: Record<string, unknown> = {
    entryExitRouter: addresses.entryRouter, weth: addresses.weth,
    uniswapV4PoolManager: addresses.uniswapV4PoolManager, uniswapV4StateView: addresses.uniswapV4StateView,
    uniswapUniversalRouter: addresses.universalRouter, permit2: addresses.permit2, poolManager: addresses.uniswapV4PoolManager,
    isAdapterApproved: true, poolKey: [...currencies, 0, 1, addresses.launchManager], ...overrides,
  };
  return {
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => values[functionName]),
    call: vi.fn(async ({ data, to }: { data: `0x${string}`; to: Address }) => {
      expect(to).toBe(addresses.uniswapV4Quoter);
      const decoded = decodeFunctionData({ abi: otfQuoterAbi, data });
      return { data: encodeFunctionResult({ abi: otfQuoterAbi, functionName: decoded.functionName, result: [123n, 456n] }) };
    }),
  };
}

describe.each(deployments)("canonical $name OTF basket quotes", ({ deployment: addresses }) => {
  it.each(["EXACT_INPUT", "EXACT_OUTPUT"] as const)("quotes %s against the authenticated canonical pool", async (type) => {
    const rpc = reader(addresses);
    const client = canonicalOtfRouting(rpc as unknown as PublicClient, addresses);
    await client.verifyOtfBindings(addresses.entryRouter!, addresses.uniswapUniversalRouterAdapter!);
    expect(await client.quoteOtf(type, true, 100n)).toBe(123n);
    const { args, functionName } = decodeFunctionData({ abi: otfQuoterAbi, data: rpc.call.mock.calls[0]![0].data });
    expect(functionName).toBe(type === "EXACT_INPUT" ? "quoteExactInputSingle" : "quoteExactOutputSingle");
    expect(args[0]).toMatchObject({ exactAmount: 100n, hookData: "0x", zeroForOne: BigInt(addresses.weth!) < BigInt(addresses.otfToken!), poolKey: { hooks: addresses.launchManager, fee: 0, tickSpacing: 1 } });
    rpc.readContract.mockClear();
    await client.verifyOtfBindings(addresses.entryRouter!, addresses.uniswapUniversalRouterAdapter!);
    expect(rpc.readContract).not.toHaveBeenCalled();
  });

  it.each([
    { isAdapterApproved: false }, { entryExitRouter: zeroAddress },
    { poolManager: zeroAddress }, { poolKey: [zeroAddress, zeroAddress, 0, 1, zeroAddress] },
  ])("rejects stale or unapproved dependencies before quoting: %j", async (overrides) => {
    const rpc = reader(addresses, overrides);
    const client = canonicalOtfRouting(rpc as unknown as PublicClient, addresses);
    await expect(client.verifyOtfBindings(addresses.entryRouter!, addresses.uniswapUniversalRouterAdapter!)).rejects.toThrow();
    await expect(client.quoteOtf("EXACT_INPUT", true, 100n)).rejects.toThrow();
    expect(rpc.call).not.toHaveBeenCalled();
  });

  it("rejects amounts outside the adapter bounds before making an RPC call", async () => {
    const rpc = reader(addresses);
    const client = canonicalOtfRouting(rpc as unknown as PublicClient, addresses);
    await expect(client.quoteOtf("EXACT_INPUT", true, 100n)).rejects.toThrow("bindings");
    await client.verifyOtfBindings(addresses.entryRouter!, addresses.uniswapUniversalRouterAdapter!);
    for (const amount of [0n, -1n, 1n << 128n]) await expect(client.quoteOtf("EXACT_OUTPUT", true, amount)).rejects.toThrow("limits");
    expect(rpc.call).not.toHaveBeenCalled();
  });

  it("reverses the pool direction for an OTF sale", async () => {
    const rpc = reader(addresses);
    const client = canonicalOtfRouting(rpc as unknown as PublicClient, addresses);
    await client.verifyOtfBindings(addresses.entryRouter, addresses.uniswapUniversalRouterAdapter);
    await client.quoteOtf("EXACT_INPUT", false, 100n);
    const { args } = decodeFunctionData({ abi: otfQuoterAbi, data: rpc.call.mock.calls[0]![0].data });
    expect(args[0].zeroForOne).toBe(BigInt(addresses.otfToken) < BigInt(addresses.weth));
  });

  it("rejects a different adapter even after caching the binding checks", async () => {
    const rpc = reader(addresses);
    const client = canonicalOtfRouting(rpc as unknown as PublicClient, addresses);
    await client.verifyOtfBindings(addresses.entryRouter, addresses.uniswapUniversalRouterAdapter);
    await expect(client.verifyOtfBindings(addresses.entryRouter, zeroAddress)).rejects.toThrow("unavailable");
  });

  it("requires a configured quoter and propagates a pool or hook revert", async () => {
    const rpc = reader(addresses);
    const missing = canonicalOtfRouting(rpc as unknown as PublicClient, { ...addresses, uniswapV4Quoter: undefined });
    await expect(missing.verifyOtfBindings(addresses.entryRouter, addresses.uniswapUniversalRouterAdapter)).rejects.toThrow("unavailable");
    const client = canonicalOtfRouting(rpc as unknown as PublicClient, addresses);
    await client.verifyOtfBindings(addresses.entryRouter, addresses.uniswapUniversalRouterAdapter);
    rpc.call.mockRejectedValueOnce(new Error("Hook price bound"));
    await expect(client.quoteOtf("EXACT_INPUT", true, 100n)).rejects.toThrow("Hook price bound");
  });
});

describe("canonical OTF settlement budgets", () => {
  const deployment = deployments[1]!.deployment;
  const intermediate = addr(70), output = addr(71);
  const leg = (tokenIn: Address, tokenOut: Address, amountIn: bigint) => {
    const route = routeFrom([tokenIn, tokenOut], [3000]);
    return { adapter: deployment.uniswapUniversalRouterAdapter, tokenIn, tokenOut, amountIn, minAmountOut: 1n, data: universalRouteData(3, route.path), hops: route.hops };
  };
  const options = { ...deployment, slippageBps: 100, client: {
    verifyOtfBindings: vi.fn(async () => {}), quoteOtf: vi.fn(async () => 1000n),
  } };

  it("bounds split WETH funding and preserves intermediate segment amounts", async () => {
    const legs = [leg(deployment.weth, intermediate, 400n), leg(intermediate, output, maxUint256), leg(deployment.weth, output, maxUint256)];
    const base: BasketRouteProvider = { quote: vi.fn(async () => ({ amountIn: 990n, amountOut: 1980n, legs })) };
    const result = await canonicalOtfBasketRoutes(base, options).quote("EXACT_INPUT", deployment.otfToken, output, 100n);
    expect(base.quote).toHaveBeenCalledWith("EXACT_INPUT", deployment.weth, output, 990n);
    expect(result.legs.map(entry => entry.amountIn)).toEqual([100n, 400n, maxUint256, 590n]);
    expect(result.legs[2]).toBe(legs[1]);
    expect(legs[2]!.amountIn).toBe(maxUint256);
  });

  it("rejects settlement funding that exceeds this OTF sale's guaranteed proceeds", async () => {
    const base: BasketRouteProvider = { quote: vi.fn(async () => ({ amountIn: 1000n, amountOut: 2000n, legs: [leg(deployment.weth, output, 1000n)] })) };
    await expect(canonicalOtfBasketRoutes(base, options).quote("EXACT_INPUT", deployment.otfToken, output, 100n)).rejects.toMatchObject({ code: "ROUTE_POLICY_EXCEEDED" });
  });
});
