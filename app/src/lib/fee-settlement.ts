import type { Address } from "viem";
import type { AdapterSwapLeg, SwapQuote } from "./swap-model";

export type PendingFeeShares = {
  creator: bigint;
  buyback: bigint;
  total: bigint;
};

export type FeeSettlementRoute = {
  vault: Address;
  weth: Address;
  shares: bigint;
  expectedWethOut: bigint;
  minWethOut: bigint;
  minBasketAmounts: readonly bigint[];
  legs: readonly AdapterSwapLeg[];
};

export function pendingFeeShares(
  recordedCreator: bigint,
  recordedBuyback: bigint,
  annualCreator: bigint,
  annualBuyback: bigint,
): PendingFeeShares {
  const creator = recordedCreator + annualCreator;
  const buyback = recordedBuyback + annualBuyback;
  return { creator, buyback, total: creator + buyback };
}

export function proportionalWethSplit(
  wethOut: bigint,
  creatorFeeShares: bigint,
  buybackFeeShares: bigint,
) {
  const totalFeeShares = creatorFeeShares + buybackFeeShares;
  if (wethOut < 0n || creatorFeeShares < 0n || buybackFeeShares < 0n || totalFeeShares === 0n) {
    throw new Error("A positive recorded fee-share total is required.");
  }
  const creatorWeth = wethOut * creatorFeeShares / totalFeeShares;
  return { creatorWeth, buybackWeth: wethOut - creatorWeth };
}

export function feeSettlementRouteFromQuote(
  quote: SwapQuote,
  vault: Address,
  weth: Address,
): FeeSettlementRoute | undefined {
  if (
    quote.state !== "available"
    || !quote.expectedOutputRaw
    || !quote.minimumReceivedRaw
    || quote.expectedOutputRaw < quote.minimumReceivedRaw
    || quote.execution?.kind !== "basket-router"
    || quote.execution.call.method !== "redeemToToken"
  ) return undefined;
  const [request, minBasketAmounts, legs] = quote.execution.call.args;
  if (
    request.vault.toLowerCase() !== vault.toLowerCase()
    || request.outputToken.toLowerCase() !== weth.toLowerCase()
    || request.shares === 0n
    || request.minAmountOut !== quote.minimumReceivedRaw
  ) return undefined;
  return {
    vault,
    weth,
    shares: request.shares,
    expectedWethOut: quote.expectedOutputRaw,
    minWethOut: quote.minimumReceivedRaw,
    minBasketAmounts,
    legs,
  };
}

export function feeSettlementArgs(
  route: FeeSettlementRoute,
  minOtfOut: bigint,
  deadline: bigint,
) {
  if (route.minWethOut === 0n || minOtfOut === 0n || deadline === 0n) {
    throw new Error("Settlement minimums and deadline must be positive.");
  }
  return [
    route.vault,
    route.minBasketAmounts,
    route.legs,
    route.minWethOut,
    minOtfOut,
    deadline,
  ] as const;
}
