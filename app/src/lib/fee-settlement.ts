import type { Address } from "viem";
import type { AdapterSwapLeg, SwapQuote } from "./swap-model";

export type PendingFeeShares = {
  creator: bigint;
  buyback: bigint;
  total: bigint;
};

type FeeSettlementRouteBase = {
  vault: Address;
  weth: Address;
  shares: bigint;
  expectedWethOut: bigint;
  minWethOut: bigint;
  legs: readonly AdapterSwapLeg[];
};

export type RedemptionFeeSettlementRoute = FeeSettlementRouteBase & {
  mode: "redemption";
  minBasketAmounts: readonly bigint[];
  skipMask: bigint;
};

export type ShareSaleFeeSettlementRoute = FeeSettlementRouteBase & {
  mode: "share-sale";
};

export type FeeSettlementRoute = RedemptionFeeSettlementRoute | ShareSaleFeeSettlementRoute;
export type FeeSettlementRoutePreference = "best" | FeeSettlementRoute["mode"];
export type FeeSettlementRoutes = {
  redemption?: RedemptionFeeSettlementRoute;
  shareSale?: ShareSaleFeeSettlementRoute;
};
export type FeeClaimReadState = "pending" | "failed" | "wrong-beneficiary" | "verified";

export function feeClaimReadState({
  isPending,
  isError,
  feeAccountsStatus,
  previewExpenseFeesStatus,
  connectedAccount,
  beneficiary,
}: {
  isPending: boolean;
  isError: boolean;
  feeAccountsStatus?: "success" | "failure";
  previewExpenseFeesStatus?: "success" | "failure";
  connectedAccount?: string;
  beneficiary: string;
}): FeeClaimReadState {
  if (isPending) return "pending";
  if (
    isError
    || feeAccountsStatus !== "success"
    || previewExpenseFeesStatus !== "success"
  ) return "failed";
  return connectedAccount?.toLowerCase() === beneficiary.toLowerCase()
    ? "verified"
    : "wrong-beneficiary";
}

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

export function redemptionFeeSettlementRouteFromQuote(
  quote: SwapQuote,
  vault: Address,
  weth: Address,
  collector: Address,
): RedemptionFeeSettlementRoute | undefined {
  if (
    quote.state !== "available"
    || !quote.expectedOutputRaw
    || !quote.minimumReceivedRaw
    || quote.expectedOutputRaw < quote.minimumReceivedRaw
    || quote.execution?.kind !== "basket-router"
    || quote.execution.call.method !== "redeemToToken"
    || quote.execution.caller.toLowerCase() !== collector.toLowerCase()
  ) return undefined;
  const [request, minBasketAmounts, legs] = quote.execution.call.args;
  if (
    request.vault.toLowerCase() !== vault.toLowerCase()
    || request.outputToken.toLowerCase() !== weth.toLowerCase()
    || request.shares === 0n
    || request.minAmountOut !== quote.minimumReceivedRaw
  ) return undefined;
  return {
    mode: "redemption",
    vault,
    weth,
    shares: request.shares,
    expectedWethOut: quote.expectedOutputRaw,
    minWethOut: quote.minimumReceivedRaw,
    minBasketAmounts,
    skipMask: request.skipMask,
    legs,
  };
}

export function shareSaleFeeSettlementRouteFromQuote(
  quote: SwapQuote,
  vault: Address,
  weth: Address,
  collector: Address,
  adapter: Address,
  swapRouter: Address,
): ShareSaleFeeSettlementRoute | undefined {
  if (
    quote.state !== "available"
    || !quote.expectedOutputRaw
    || !quote.minimumReceivedRaw
    || quote.expectedOutputRaw < quote.minimumReceivedRaw
    || quote.execution?.kind !== "direct-v3"
    || quote.execution.caller.toLowerCase() !== collector.toLowerCase()
    || quote.execution.inputToken.toLowerCase() !== vault.toLowerCase()
    || quote.execution.outputToken.toLowerCase() !== weth.toLowerCase()
    || quote.execution.swapRouter02.toLowerCase() !== swapRouter.toLowerCase()
    || quote.execution.amountIn === 0n
    || quote.execution.minAmountOut !== quote.minimumReceivedRaw
  ) return undefined;
  return {
    mode: "share-sale",
    vault,
    weth,
    shares: quote.execution.amountIn,
    expectedWethOut: quote.expectedOutputRaw,
    minWethOut: quote.minimumReceivedRaw,
    legs: [{
      adapter,
      tokenIn: vault,
      tokenOut: weth,
      amountIn: quote.execution.amountIn,
      minAmountOut: quote.minimumReceivedRaw,
      data: quote.execution.path,
      hops: quote.hops ?? [],
    }],
  };
}

export function selectFeeSettlementRoute(
  routes: FeeSettlementRoutes,
  preference: FeeSettlementRoutePreference,
): FeeSettlementRoute | undefined {
  if (preference === "redemption") return routes.redemption;
  if (preference === "share-sale") return routes.shareSale;
  if (!routes.redemption) return routes.shareSale;
  if (!routes.shareSale) return routes.redemption;
  return routes.shareSale.expectedWethOut > routes.redemption.expectedWethOut
    ? routes.shareSale
    : routes.redemption;
}

export function feeSettlementCall(
  route: FeeSettlementRoute,
  minOtfOut: bigint,
  deadline: bigint,
) {
  if (route.minWethOut === 0n || minOtfOut === 0n || deadline === 0n) {
    throw new Error("Settlement minimums and deadline must be positive.");
  }
  return route.mode === "redemption"
    ? {
        functionName: "settleFeesViaRedemption" as const,
        args: [
          route.vault,
          route.minBasketAmounts,
          route.skipMask,
          route.legs,
          route.minWethOut,
          minOtfOut,
          deadline,
        ] as const,
      }
    : {
        functionName: "settleFeesViaShareSale" as const,
        args: [route.vault, route.legs, route.minWethOut, minOtfOut, deadline] as const,
      };
}
