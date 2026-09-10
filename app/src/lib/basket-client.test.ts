import { encodeFunctionResult, maxUint256, zeroAddress, type Address } from "viem";
import { describe, expect, it, vi } from "vitest";
import { otfEntryExitRouterAbi } from "@onchaintradedfunds/generated";
import { basketClient, type BasketDeployment } from "./basket-client";
import { type BasketRouterExecution } from "./swap-model";
import { v4PoolId } from "./v4-route";

const rpc = vi.hoisted(() => ({ simulateCalls: vi.fn(), readContract: vi.fn(), getCode: vi.fn() }));
vi.mock("viem", async (importOriginal) => ({ ...await importOriginal<typeof import("viem")>(), createPublicClient: () => rpc }));
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const deployment: BasketDeployment = { factory: addr(1), entryRouter: addr(2), uniswapUniversalRouterAdapter: addr(3), weth: addr(4), uniswapV3Factory: addr(5), uniswapV4PoolManager: addr(31), uniswapV4StateView: addr(32), universalRouter: addr(33), permit2: addr(34), otfToken: addr(35), launchManager: addr(36), uniswapV4Quoter: addr(37) };
function execution(native = false): BasketRouterExecution {
  return { kind: "basket-router", chainId: 4663, caller: addr(7), router: deployment.entryRouter, adapter: deployment.uniswapUniversalRouterAdapter,
    nativeValue: native ? 100n : 0n, approval: native ? undefined : { token: addr(8), spender: deployment.entryRouter, amount: 100n }, funding: [{ token: addr(8), amount: 100n }],
    call: native ? { method: "mintFromNative", args: [{ inputToken: deployment.weth, vault: addr(8), amountIn: 100n, minShares: 10n, deadline: 2000000000n }, []] }
      : { method: "redeemToToken", args: [{ outputToken: deployment.weth, vault: addr(8), shares: 100n, minAmountOut: 10n, skipMask: 0n, deadline: 2000000000n }, [100n], [{ adapter: deployment.uniswapUniversalRouterAdapter, tokenIn: addr(9), tokenOut: deployment.weth, amountIn: maxUint256, minAmountOut: 10n, data: "0x", hops: [] }]] },
  };
}
describe("mainnet basket simulation", () => {
  it("authenticates V4 pool keys through StateView and checks hook code", async () => {
    const hop = { intermediateCurrency: addr(9), fee: 3000, tickSpacing: 60, hooks: addr(10), hookData: "0x" as const };
    rpc.readContract.mockResolvedValue([1n, 0, 0, 3000]);
    rpc.getCode.mockResolvedValue("0x6000");
    await basketClient(deployment).authenticateV4Pool(addr(8), hop);
    expect(rpc.readContract).toHaveBeenCalledWith(expect.objectContaining({ address: deployment.uniswapV4StateView, functionName: "getSlot0", args: [v4PoolId(addr(8), hop)] }));
    expect(rpc.getCode).toHaveBeenCalledWith({ address: addr(10) });
    rpc.readContract.mockResolvedValue([0n, 0, 0, 0]);
    await expect(basketClient(deployment).authenticateV4Pool(addr(8), hop)).rejects.toThrow(/Uninitialized/);
    rpc.readContract.mockResolvedValue([1n, 0, 0, 3000]);
    rpc.getCode.mockResolvedValue("0x");
    await expect(basketClient(deployment).authenticateV4Pool(addr(8), hop)).rejects.toThrow(/hook/);
  });
  it("simulates approvals and the complete basket in order against actual balances", async () => {
    rpc.simulateCalls.mockResolvedValue({ results: [
      { status: "success", data: "0x" }, { status: "success", data: "0x" },
      { status: "success", gasUsed: 123n, data: encodeFunctionResult({ abi: otfEntryExitRouterAbi, functionName: "redeemToToken", result: [20n, [], []] }) },
    ] });
    expect(await basketClient(deployment).simulate(execution())).toEqual({ amountOut: 20n, refunds: [], gasUsed: 123n });
    const args = rpc.simulateCalls.mock.lastCall![0];
    expect(args.account).toBe(addr(7));
    expect(args.calls.map((call: { to: Address }) => call.to)).toEqual([addr(8), addr(8), deployment.entryRouter]);
    expect(args.stateOverrides).toBeUndefined();
  });
  it("decodes native mint refunds separately from ERC20 refunds", async () => {
    rpc.simulateCalls.mockResolvedValue({ results: [{ status: "success", gasUsed: 100n,
      data: encodeFunctionResult({ abi: otfEntryExitRouterAbi, functionName: "mintFromNative", result: [20n, [addr(9)], [3n], 7n] }),
    }] });
    expect(await basketClient(deployment).simulate(execution(true))).toEqual({ amountOut: 20n, refunds: [{ token: addr(9), amount: 3n }, { token: zeroAddress, amount: 7n }], gasUsed: 100n });
  });
  it("rejects approval failures, reverted baskets, incomplete results, and unsupported RPCs", async () => {
    for (const results of [[], [{ status: "failure" }, { status: "success" }, { status: "success" }], [{ status: "success" }, { status: "success" }, { status: "failure" }]]) {
      rpc.simulateCalls.mockResolvedValue({ results });
      await expect(basketClient(deployment).simulate(execution())).rejects.toThrow(/simulation/);
    }
    rpc.simulateCalls.mockRejectedValue(new Error("eth_simulateV1 unsupported"));
    await expect(basketClient(deployment).simulate(execution())).rejects.toThrow(/unsupported/);
  });
});
