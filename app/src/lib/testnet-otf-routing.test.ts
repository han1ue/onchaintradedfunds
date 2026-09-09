import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeFunctionResult, zeroAddress, type PublicClient } from "viem";
import { robinhoodTestnetAddresses as addresses, robinhoodTestnetV4 as v4 } from "./deployment";
import { otfQuoterAbi, testnetOtfRouting } from "./testnet-otf-routing";

function reader(overrides: Record<string, unknown> = {}) {
  const currencies = [addresses.otfToken!, addresses.weth!].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1);
  const values: Record<string, unknown> = {
    entryExitRouter: addresses.entryRouter, weth: addresses.weth,
    uniswapV4PoolManager: v4.poolManager, uniswapV4StateView: v4.stateView,
    uniswapUniversalRouter: v4.universalRouter, permit2: v4.permit2, poolManager: v4.poolManager,
    isAdapterApproved: true, poolKey: [...currencies, 0, 1, addresses.launchManager], ...overrides,
  };
  return {
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => values[functionName]),
    call: vi.fn(async ({ data }) => {
      const decoded = decodeFunctionData({ abi: otfQuoterAbi, data });
      return { data: encodeFunctionResult({ abi: otfQuoterAbi, functionName: decoded.functionName, result: [123n, 456n] }) };
    }),
  };
}

describe("canonical testnet OTF basket quotes", () => {
  it.each(["EXACT_INPUT", "EXACT_OUTPUT"] as const)("quotes %s against the authenticated canonical pool", async (type) => {
    const rpc = reader();
    const client = testnetOtfRouting(rpc as unknown as PublicClient);
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
    { poolManager: zeroAddress }, { poolKey: [zeroAddress, addresses.otfToken, 0, 1, addresses.launchManager] },
  ])("rejects stale or unapproved dependencies before quoting: %j", async (overrides) => {
    const rpc = reader(overrides);
    const client = testnetOtfRouting(rpc as unknown as PublicClient);
    await expect(client.verifyOtfBindings(addresses.entryRouter!, addresses.uniswapUniversalRouterAdapter!)).rejects.toThrow();
    await expect(client.quoteOtf("EXACT_INPUT", true, 100n)).rejects.toThrow();
    expect(rpc.call).not.toHaveBeenCalled();
  });

  it("rejects amounts outside the adapter bounds before making an RPC call", async () => {
    const rpc = reader();
    const client = testnetOtfRouting(rpc as unknown as PublicClient);
    await expect(client.quoteOtf("EXACT_INPUT", true, 100n)).rejects.toThrow("bindings");
    await client.verifyOtfBindings(addresses.entryRouter!, addresses.uniswapUniversalRouterAdapter!);
    for (const amount of [0n, -1n, 1n << 128n]) await expect(client.quoteOtf("EXACT_OUTPUT", true, amount)).rejects.toThrow("limits");
    expect(rpc.call).not.toHaveBeenCalled();
  });
});
