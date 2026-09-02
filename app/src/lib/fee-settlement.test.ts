import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { feeSettlementArgs, feeSettlementRouteFromQuote, pendingFeeShares, proportionalWethSplit } from "./fee-settlement";
import type { SwapQuote } from "./swap-model";

const vault = "0x0000000000000000000000000000000000000001" as Address;
const weth = "0x0000000000000000000000000000000000000002" as Address;
const router = "0x0000000000000000000000000000000000000003" as Address;
const adapter = "0x0000000000000000000000000000000000000004" as Address;

function quote(): SwapQuote {
  const leg = { adapter, tokenIn: weth, tokenOut: weth, amountIn: 1n, minAmountOut: 1n, data: "0x12" as const, hops: [] };
  return {
    id: "fee-quote",
    route: "basket",
    state: "available",
    queriedAt: 1,
    inputAmount: "100",
    expectedOutputRaw: 90n,
    minimumReceivedRaw: 85n,
    routeLabel: "Burn basket",
    execution: {
      kind: "basket-router",
      chainId: 46630,
      caller: vault,
      router,
      adapter,
      nativeValue: 0n,
      funding: [],
      call: {
        method: "redeemToToken",
        args: [{ vault, outputToken: weth, shares: 100n, minAmountOut: 85n, deadline: 200n }, [1n], [leg]],
      },
    },
  };
}

describe("fee settlement model", () => {
  it("combines recorded and newly checkpointable fee shares without recomputing either split", () => {
    expect(pendingFeeShares(60n, 40n, 9n, 1n)).toEqual({ creator: 69n, buyback: 41n, total: 110n });
  });

  it("splits actual WETH with creator rounding down and the residual assigned to buyback", () => {
    expect(proportionalWethSplit(7n, 2n, 1n)).toEqual({ creatorWeth: 4n, buybackWeth: 3n });
    expect(proportionalWethSplit(1n, 9n, 1n)).toEqual({ creatorWeth: 0n, buybackWeth: 1n });
  });

  it("extracts only the full typed vault-to-WETH route and builds collector arguments", () => {
    const route = feeSettlementRouteFromQuote(quote(), vault, weth);
    expect(route).toMatchObject({ shares: 100n, expectedWethOut: 90n, minWethOut: 85n });
    expect(feeSettlementArgs(route!, 20n, 300n)).toEqual([
      vault,
      [1n],
      [expect.objectContaining({ adapter })],
      85n,
      20n,
      300n,
    ]);
  });

  it("rejects missing, wrong-token, and stale-shaped routes", () => {
    expect(feeSettlementRouteFromQuote({ ...quote(), state: "failed" }, vault, weth)).toBeUndefined();
    expect(feeSettlementRouteFromQuote(quote(), vault, router)).toBeUndefined();
    expect(() => proportionalWethSplit(1n, 0n, 0n)).toThrow();
  });
});
