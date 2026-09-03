import { encodeFunctionData, getAddress } from "viem";
import { describe, expect, it, vi } from "vitest";
import {
  ERC20_APPROVE_ABI,
  assetHasExecutableMetadata,
  bestQueriedQuote,
  classifySwapDirection,
  decimalAmount,
  decimalInputValue,
  enforceFirstPurchaseMinimum,
  executionPlanForQuote,
  executionStages,
  isNativeWrapPair,
  isPositiveDecimalAmount,
  liquidityActionLabel,
  pastedAsset,
  nativeMaxAmount,
  parseTypedQuoteResponse,
  quoteNeedsRefresh,
  requestConcurrentQuotes,
  routerArgsForExecution,
  supportedSwapDirection,
  swapDirectionLabel,
  type SwapAsset,
  type SwapQuote,
  type SwapQuoteRequest,
  type SwapQuoteService,
} from "./swap-model";

const USDG: SwapAsset = {
  address: "0x0000000000000000000000000000000000000001",
  symbol: "USDG",
  name: "USDG",
  kind: "erc20",
  decimals: 18,
  metadataResolved: true,
};
const TOKEN: SwapAsset = {
  address: "0x0000000000000000000000000000000000000004",
  symbol: "TOKEN",
  name: "Token",
  kind: "erc20",
  decimals: 18,
  metadataResolved: true,
};
const PROTOCOL_OTF: SwapAsset = {
  ...TOKEN,
  address: "0x0000000000000000000000000000000000000006",
  symbol: "OTF",
  name: "OTF Protocol Token",
  isProtocolToken: true,
};
const FUND_A: SwapAsset = {
  address: "0x0000000000000000000000000000000000000002",
  symbol: "FUND",
  name: "Fund OTF",
  kind: "otf",
  decimals: 18,
  metadataResolved: true,
  isFactoryVault: true,
};
const FUND_B: SwapAsset = { ...FUND_A, address: "0x0000000000000000000000000000000000000003", symbol: "NEXT" };
const BACKING = "0x0000000000000000000000000000000000000005" as const;
const ETH: SwapAsset = { ...USDG, address: BACKING, symbol: "ETH", name: "Ether", kind: "native" };
const WETH: SwapAsset = { ...USDG, address: BACKING, symbol: "WETH", name: "Wrapped Ether", kind: "erc20" };
const CALLER = "0x00000000000000000000000000000000000000c0" as const;
const ROUTER = "0x00000000000000000000000000000000000000e1" as const;
const ADAPTER = "0x00000000000000000000000000000000000000a1" as const;
const PERMIT2 = "0x00000000000000000000000000000000000000b1" as const;
const UNIVERSAL_ROUTER = "0x00000000000000000000000000000000000000b2" as const;
const NOW = 1_750_000_000_000;
const PATH = `0x${USDG.address.slice(2)}000bb8${BACKING.slice(2)}` as const;

function request(input = USDG, output = FUND_A, chainId = 46630): SwapQuoteRequest {
  return { chainId, input, output, inputAmount: "10", slippageBps: 50, requestedAt: NOW - 1_000, caller: CALLER };
}

function quote(route: "direct" | "basket", expectedOutputRaw: bigint, queriedAt = NOW): SwapQuote {
  return {
    id: route,
    route,
    state: "available",
    queriedAt,
    expiresAt: NOW + 10_000,
    inputAmount: "10",
    outputAmount: expectedOutputRaw.toString(),
    expectedOutput: expectedOutputRaw.toString(),
    expectedOutputRaw,
    minimumReceived: expectedOutputRaw.toString(),
    minimumReceivedRaw: expectedOutputRaw,
    routeLabel: route === "direct" ? "Direct pool" : "Mint basket",
  };
}

function service(direct: () => Promise<SwapQuote>, basket: () => Promise<SwapQuote>): SwapQuoteService {
  return {
    quoteDirect: direct,
    quoteBasket: basket,
    finalizeDirect: async (plan) => plan,
  };
}

function directResponse(overrides: Record<string, unknown> = {}) {
  const amount = 10n * 10n ** 18n;
  const minimum = 9n * 10n ** 18n;
  return {
    state: "available",
    id: "direct",
    route: "direct",
    chainId: 4663,
    caller: CALLER,
    quotedAtMs: NOW - 1_000,
    expiresAtMs: NOW + 10_000,
    inputAmountRaw: amount.toString(),
    outputAmount: "9.5",
    expectedOutput: "9.5",
    expectedOutputRaw: "9500000000000000000",
    minimumReceived: "9",
    minimumReceivedRaw: minimum.toString(),
    routeLabel: "Direct pool",
    hops: [],
    execution: {
      kind: "direct-api",
      chainId: 4663,
      caller: CALLER,
      inputToken: USDG.address,
      outputToken: TOKEN.address,
      universalRouter: UNIVERSAL_ROUTER,
      amountIn: amount.toString(),
      minAmountOut: minimum.toString(),
      expiresAtMs: NOW + 10_000,
      quoteToken: "sealed",
      nativeInput: false,
      nativeOutput: false,
      nativeValue: "0",
      approval: {
        chainId: 4663,
        from: CALLER,
        to: USDG.address,
        data: encodeFunctionData({ abi: ERC20_APPROVE_ABI, functionName: "approve", args: [PERMIT2, amount] }),
        value: "0",
      },
    },
    ...overrides,
  };
}

function directContext() {
  return {
    route: "direct" as const,
    request: request(USDG, TOKEN, 4663),
    permit2: PERMIT2,
    universalRouter: UNIVERSAL_ROUTER,
    chainId: 4663,
    now: NOW,
  };
}

function basketResponse(overrides: Record<string, unknown> = {}) {
  const amount = 10n * 10n ** 18n;
  const half = 5n * 10n ** 18n;
  return {
    state: "available",
    id: "basket",
    route: "basket",
    chainId: 46630,
    caller: CALLER,
    quotedAtMs: NOW - 1_000,
    expiresAtMs: NOW + 10_000,
    inputAmountRaw: amount.toString(),
    outputAmount: "9.5",
    expectedOutput: "9.5",
    expectedOutputRaw: "9500000000000000000",
    minimumReceived: "9",
    minimumReceivedRaw: "9000000000000000000",
    routeLabel: "Mint basket",
    residualRefunds: [{ token: BACKING, amount: "3", displayAmount: "0.000000000000000003" }],
    execution: {
      kind: "basket-router",
      chainId: 46630,
      caller: CALLER,
      router: ROUTER,
      adapter: ADAPTER,
      approval: { token: USDG.address, spender: ROUTER, amount: amount.toString() },
      nativeValue: "0",
      funding: [{ token: USDG.address, amount: amount.toString() }],
      method: "mintFromToken",
      request: {
        inputToken: USDG.address,
        vault: FUND_A.address,
        amountIn: amount.toString(),
        minShares: "9000000000000000000",
        deadline: "1750000100",
      },
      legs: [
        { adapter: ADAPTER, tokenIn: USDG.address, tokenOut: BACKING, amountIn: half.toString(), minAmountOut: "4", data: PATH },
        { adapter: ADAPTER, tokenIn: USDG.address, tokenOut: BACKING, amountIn: half.toString(), minAmountOut: "4", data: PATH },
      ],
    },
    ...overrides,
  };
}

function basketContext() {
  return { route: "basket" as const, request: request(), entryRouter: ROUTER, adapter: ADAPTER, chainId: 46630, now: NOW };
}

describe("swap state model", () => {
  it("keeps pasted tokens non-executable until metadata is resolved", () => {
    const asset = pastedAsset(" 0x0000000000000000000000000000000000000001 ");
    expect(asset).toMatchObject({ symbol: "0x0000…0001", kind: "erc20", verified: false });
    expect(assetHasExecutableMetadata(asset!)).toBe(false);
    expect(pastedAsset("not-an-address")).toBeUndefined();
  });

  it("models all four directions but exposes only swaps containing an OTF asset", () => {
    expect(classifySwapDirection(USDG, FUND_A)).toBe("erc20-to-otf");
    expect(classifySwapDirection(FUND_A, USDG)).toBe("otf-to-erc20");
    expect(classifySwapDirection(FUND_A, FUND_B)).toBe("otf-to-otf");
    expect(classifySwapDirection(USDG, TOKEN)).toBe("erc20-to-erc20");
    expect(supportedSwapDirection(USDG, TOKEN)).toBe(false);
    expect(supportedSwapDirection(USDG, PROTOCOL_OTF)).toBe(true);
    expect(supportedSwapDirection(USDG, FUND_A)).toBe(true);
    expect(swapDirectionLabel(USDG, TOKEN)).toBe("ERC-20 → ERC-20");
  });

  it("keeps native ETH distinct from WETH and reserves gas for Max", () => {
    expect(ETH.kind).toBe("native");
    expect(WETH.kind).toBe("erc20");
    expect(assetHasExecutableMetadata(ETH)).toBe(true);
    expect(supportedSwapDirection(ETH, PROTOCOL_OTF)).toBe(true);
    expect(nativeMaxAmount(10n, 2n, 3n)).toBe(4n);
    expect(nativeMaxAmount(5n, 2n, 3n)).toBe(0n);
  });

  it("recognizes only the canonical native ETH and WETH pair as a wrap", () => {
    expect(isNativeWrapPair(ETH, WETH, WETH.address)).toBe(true);
    expect(isNativeWrapPair(WETH, ETH, WETH.address)).toBe(true);
    expect(isNativeWrapPair(ETH, USDG, WETH.address)).toBe(false);
    expect(isNativeWrapPair(ETH, WETH, USDG.address)).toBe(false);
  });

  it("does not quote an ERC20-to-ERC20 pair", async () => {
    const direct = vi.fn(async () => quote("direct", 9n));
    const basket = vi.fn(async () => quote("basket", 10n));
    const results = await requestConcurrentQuotes(service(direct, basket), request(USDG, TOKEN, 4663));
    expect(direct).not.toHaveBeenCalled();
    expect(basket).not.toHaveBeenCalled();
    expect(results.map((result) => result.route)).toEqual(["direct"]);
    expect(results[0]).toMatchObject({ state: "unavailable", reason: "Swap is only available for OTF assets." });
  });

  it("requests only a direct route when the protocol OTF token qualifies the pair", async () => {
    const direct = vi.fn(async () => quote("direct", 9n));
    const basket = vi.fn(async () => quote("basket", 10n));
    const results = await requestConcurrentQuotes(service(direct, basket), request(USDG, PROTOCOL_OTF, 4663));
    expect(direct).toHaveBeenCalledOnce();
    expect(basket).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
  });

  it("requests direct and basket OTF routes concurrently and keeps an independent success", async () => {
    let directStarted = false;
    let basketObservedDirect = false;
    const results = await requestConcurrentQuotes(service(
      async () => { directStarted = true; throw new Error("unavailable"); },
      async () => { basketObservedDirect = directStarted; return quote("basket", 11n); },
    ), request());
    expect(basketObservedDirect).toBe(true);
    expect(results[0].state).toBe("failed");
    expect(bestQueriedQuote(results, NOW)?.route).toBe("basket");
  });

  it("selects the best queried route using integer output and permits manual override", () => {
    const direct = parseTypedQuoteResponse(directResponse(), directContext());
    const basket = parseTypedQuoteResponse(basketResponse(), basketContext());
    expect(bestQueriedQuote([direct, { ...basket, expectedOutputRaw: direct.expectedOutputRaw! + 1n }], NOW)?.route).toBe("basket");
    expect(executionPlanForQuote(direct, 4663, NOW)?.kind).toBe("direct-api");
  });

  it("rejects stale quotes and preserves the first-mint minimum", () => {
    const stale = quote("basket", 20n, NOW - 20_001);
    expect(bestQueriedQuote([stale], NOW)).toBeUndefined();
    expect(quoteNeedsRefresh(stale, NOW)).toBe(true);
    const below = { ...quote("basket", 1n), minimumReceivedRaw: 9_999_999_999_999_999n };
    expect(enforceFirstPurchaseMinimum([below], FUND_A, 0n)[0].state).toBe("unavailable");
    expect(enforceFirstPurchaseMinimum([quote("basket", 1n)], FUND_A, undefined)[0].state).toBe("unavailable");
  });

  it("validates decimal input and caps its displayed precision", () => {
    expect(decimalInputValue("1.25")).toBe("1.25");
    expect(decimalInputValue("1.123456789", 8)).toBe("1.12345678");
    expect(decimalInputValue("1.12345678", 8)).toBe("1.12345678");
    expect(decimalInputValue("1..2")).toBeUndefined();
    expect(isPositiveDecimalAmount("0")).toBe(false);
    expect(decimalAmount("1.25", 2)).toBe(125n);
  });

  it("parses an exact direct API plan and its Permit2 approval", () => {
    const parsed = parseTypedQuoteResponse(directResponse(), directContext());
    expect(parsed.execution).toMatchObject({ kind: "direct-api", universalRouter: UNIVERSAL_ROUTER, amountIn: 10n * 10n ** 18n });
    expect(parsed.expectedOutputRaw).toBe(9_500_000_000_000_000_000n);
  });

  it("accepts native direct input only with an exact value and no approval or permit", () => {
    const amount = 10n * 10n ** 18n;
    const response = directResponse();
    const execution = {
      ...(response.execution as Record<string, unknown>),
      inputToken: BACKING,
      outputToken: PROTOCOL_OTF.address,
      nativeInput: true,
      nativeValue: amount.toString(),
      approval: undefined,
    };
    const context = { ...directContext(), request: request(ETH, PROTOCOL_OTF, 4663) };
    const parsed = parseTypedQuoteResponse({ ...response, execution }, context);
    expect(parsed.execution).toMatchObject({ nativeInput: true, nativeValue: amount });
    expect(parsed.execution?.kind === "direct-api" ? parsed.execution.approval : undefined).toBeUndefined();
    expect(() => parseTypedQuoteResponse({ ...response, execution: { ...execution, nativeValue: "0" } }, context)).toThrow(/native transaction value/);
    expect(() => parseTypedQuoteResponse({ ...response, execution: { ...execution, approval: (response.execution as Record<string, unknown>).approval } }, context)).toThrow(/Native input/);
  });

  it.each([
    ["chain", { chainId: 1 }],
    ["caller", { caller: ROUTER }],
    ["amount", { inputAmountRaw: "1" }],
    ["expiry", { expiresAtMs: NOW - 1 }],
  ])("rejects a direct quote with the wrong %s binding", (_label, override) => {
    expect(() => parseTypedQuoteResponse(directResponse(override), directContext())).toThrow();
  });

  it("rejects wrong direct approval and transaction targets", () => {
    const wrongApproval = directResponse();
    const execution = { ...(wrongApproval.execution as Record<string, unknown>), approval: { ...((wrongApproval.execution as Record<string, unknown>).approval as Record<string, unknown>), to: TOKEN.address } };
    expect(() => parseTypedQuoteResponse({ ...wrongApproval, execution }, directContext())).toThrow(/target/);
    const wrongTransaction = {
      ...(directResponse().execution as Record<string, unknown>),
      transaction: { chainId: 4663, from: CALLER, to: ROUTER, data: "0x1234", value: "0" },
    };
    expect(() => parseTypedQuoteResponse(directResponse({ execution: wrongTransaction }), directContext())).toThrow(/target/);
  });

  it("accepts split basket legs, preserves residual refunds, and emits generic adapter calldata", () => {
    const parsed = parseTypedQuoteResponse(basketResponse(), basketContext());
    expect(parsed.routeLabel).toBe("Mint basket");
    expect(parsed.residualRefunds?.[0]).toMatchObject({ token: BACKING, amount: 3n });
    expect(parsed.execution?.kind).toBe("basket-router");
    if (parsed.execution?.kind !== "basket-router") throw new Error("missing basket execution");
    const args = routerArgsForExecution(parsed.execution.call);
    expect(args[1]).toEqual([
      { adapter: getAddress(ADAPTER), tokenIn: USDG.address, tokenOut: BACKING, amountIn: 5n * 10n ** 18n, minAmountOut: 4n, data: PATH },
      { adapter: getAddress(ADAPTER), tokenIn: USDG.address, tokenOut: BACKING, amountIn: 5n * 10n ** 18n, minAmountOut: 4n, data: PATH },
    ]);
  });

  it("rejects unknown adapters, malformed data, disconnected and overspending legs", () => {
    const base = basketResponse();
    const baseExecution = base.execution as Record<string, unknown>;
    const legs = baseExecution.legs as Record<string, unknown>[];
    const mutate = (replacement: Record<string, unknown>[]) => ({ ...base, execution: { ...baseExecution, legs: replacement } });
    expect(() => parseTypedQuoteResponse(mutate([{ ...legs[0], adapter: ROUTER }, legs[1]]), basketContext())).toThrow(/unknown adapter/);
    expect(() => parseTypedQuoteResponse(mutate([{ ...legs[0], data: "0x1234" }, legs[1]]), basketContext())).toThrow(/packed length/);
    expect(() => parseTypedQuoteResponse(mutate([{ ...legs[0], tokenIn: TOKEN.address }, legs[1]]), basketContext())).toThrow(/endpoints/);
    expect(() => parseTypedQuoteResponse(mutate([{ ...legs[0], amountIn: "10000000000000000001" }, legs[1]]), basketContext())).toThrow(/overspends/);
  });

  it("reports execution stages and product copy precisely", () => {
    expect(executionStages({ walletConnected: true, networkSupported: true, usableQuote: true, execution: "simulation" }).simulation).toBe("pending");
    expect(liquidityActionLabel("FUND")).toBe("Add liquidity to FUND/USDG");
  });
});
