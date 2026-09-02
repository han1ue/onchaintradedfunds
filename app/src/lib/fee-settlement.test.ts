import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import {
  feeSettlementCall,
  pendingFeeShares,
  proportionalWethSplit,
  redemptionFeeSettlementRouteFromQuote,
  selectFeeSettlementRoute,
  shareSaleFeeSettlementRouteFromQuote,
} from "./fee-settlement";
import type { SwapQuote } from "./swap-model";

const vault = "0x0000000000000000000000000000000000000001" as Address;
const weth = "0x0000000000000000000000000000000000000002" as Address;
const router = "0x0000000000000000000000000000000000000003" as Address;
const adapter = "0x0000000000000000000000000000000000000004" as Address;
const collector = "0x0000000000000000000000000000000000000005" as Address;
const venue = "0x0000000000000000000000000000000000000006" as Address;
const usdg = "0x0000000000000000000000000000000000000007" as Address;
const path = "0x1234" as Hex;

function redemptionQuote(): SwapQuote {
  const leg = { adapter, tokenIn: usdg, tokenOut: weth, amountIn: 1n, minAmountOut: 1n, data: path, hops: [] };
  return {
    id: "redemption-quote",
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
      caller: collector,
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

function shareSaleQuote(): SwapQuote {
  return {
    id: "sale-quote",
    route: "direct",
    state: "available",
    queriedAt: 1,
    inputAmount: "100",
    expectedOutputRaw: 95n,
    minimumReceivedRaw: 91n,
    routeLabel: "Direct pool",
    hops: [
      { venue: "Synthra V3", tokenIn: vault, tokenOut: usdg, feeTier: 3_000 },
      { venue: "Synthra V3", tokenIn: usdg, tokenOut: weth, feeTier: 3_000 },
    ],
    execution: {
      kind: "direct-v3",
      chainId: 46630,
      caller: collector,
      inputToken: vault,
      outputToken: weth,
      swapRouter02: venue,
      amountIn: 100n,
      minAmountOut: 91n,
      expiresAt: 200,
      approval: { token: vault, spender: venue, amount: 100n },
      path,
      transaction: { chainId: 46630, from: collector, to: venue, data: path, value: 0n },
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

  it("extracts typed redemption and multi-hop share-sale routes", () => {
    const redemption = redemptionFeeSettlementRouteFromQuote(redemptionQuote(), vault, weth, collector);
    const sale = shareSaleFeeSettlementRouteFromQuote(shareSaleQuote(), vault, weth, collector, adapter, venue);
    expect(redemption).toMatchObject({ mode: "redemption", shares: 100n, expectedWethOut: 90n, minWethOut: 85n });
    expect(sale).toMatchObject({ mode: "share-sale", shares: 100n, expectedWethOut: 95n, minWethOut: 91n });
    expect(sale?.legs[0]).toMatchObject({ adapter, tokenIn: vault, tokenOut: weth, data: path });
    expect(sale?.legs[0].hops).toHaveLength(2);
  });

  it("selects the highest-WETH route by default and permits an explicit override", () => {
    const redemption = redemptionFeeSettlementRouteFromQuote(redemptionQuote(), vault, weth, collector)!;
    const shareSale = shareSaleFeeSettlementRouteFromQuote(shareSaleQuote(), vault, weth, collector, adapter, venue)!;
    expect(selectFeeSettlementRoute({ redemption, shareSale }, "best")?.mode).toBe("share-sale");
    expect(selectFeeSettlementRoute({ redemption, shareSale }, "redemption")?.mode).toBe("redemption");
    expect(selectFeeSettlementRoute({ redemption }, "share-sale")).toBeUndefined();
  });

  it("builds the correct clean-break collector call for either route", () => {
    const redemption = redemptionFeeSettlementRouteFromQuote(redemptionQuote(), vault, weth, collector)!;
    const shareSale = shareSaleFeeSettlementRouteFromQuote(shareSaleQuote(), vault, weth, collector, adapter, venue)!;
    expect(feeSettlementCall(redemption, 20n, 300n)).toEqual({
      functionName: "settleFeesViaRedemption",
      args: [vault, [1n], [expect.objectContaining({ adapter })], 85n, 20n, 300n],
    });
    expect(feeSettlementCall(shareSale, 20n, 300n)).toEqual({
      functionName: "settleFeesViaShareSale",
      args: [vault, [expect.objectContaining({ adapter, tokenIn: vault, tokenOut: weth })], 91n, 20n, 300n],
    });
  });

  it("rejects missing, wrong-executor, and wrong-token routes", () => {
    expect(redemptionFeeSettlementRouteFromQuote({ ...redemptionQuote(), state: "failed" }, vault, weth, collector)).toBeUndefined();
    expect(redemptionFeeSettlementRouteFromQuote(redemptionQuote(), vault, weth, router)).toBeUndefined();
    expect(shareSaleFeeSettlementRouteFromQuote(shareSaleQuote(), vault, router, collector, adapter, venue)).toBeUndefined();
    expect(shareSaleFeeSettlementRouteFromQuote(shareSaleQuote(), vault, weth, collector, adapter, router)).toBeUndefined();
    expect(() => proportionalWethSplit(1n, 0n, 0n)).toThrow();
  });
});
