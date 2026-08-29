import { describe, expect, it, vi } from "vitest";
import type { SwapAsset, SwapQuote, SwapQuoteService } from "./swap-model";
import { robinhoodTestnetAddresses } from "./deployment";
import {
  bestQueriedQuote,
  assetHasExecutableMetadata,
  classifySwapDirection,
  creationValidation,
  decimalAmount,
  decimalInputValue,
  executionPlanForQuote,
  executionStages,
  isPositiveDecimalAmount,
  liquidityActionLabel,
  liquidityVenueFor,
  pastedAsset,
  parseTypedQuoteResponse,
  quoteNeedsRefresh,
  quoteServiceForChain,
  requestConcurrentQuotes,
  routerArgsForExecution,
  supportedSwapDirection,
  swapDirectionLabel,
  unavailableQuoteService,
} from "./swap-model";

const USDG: SwapAsset = {
  address: "0x0000000000000000000000000000000000000001",
  symbol: "USDG",
  name: "USDG",
  kind: "erc20",
  decimals: 18,
  metadataResolved: true,
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
const NOW = 1_750_000_000_000;

function quote(route: "direct" | "basket", outputAmount: string, queriedAt = NOW): SwapQuote {
  return {
    id: route,
    route,
    state: "available",
    queriedAt,
    inputAmount: "10",
    outputAmount,
    expectedOutput: outputAmount,
    minimumReceived: outputAmount,
    routeLabel: route,
  };
}

const CALLER = "0x00000000000000000000000000000000000000c0" as const;
const ROUTER = "0x00000000000000000000000000000000000000e1" as const;
const DIRECT_PATH = `0x${USDG.address.slice(2)}000bb8${FUND_A.address.slice(2)}` as const;

function typedDirectResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: "typed-direct",
    route: "direct",
    chainId: 46630,
    router: ROUTER,
    caller: CALLER,
    quotedAtMs: NOW - 1_000,
    expiresAtMs: NOW + 5_000,
    deadline: "1750000100",
    inputAmountRaw: "10000000000000000000",
    outputAmount: "9.5",
    expectedOutput: "9.5",
    minimumReceived: "9",
    expectedOutputRaw: "9500000000000000000",
    minimumReceivedRaw: "9000000000000000000",
    method: "swapDirect",
    request: {
      tokenIn: USDG.address,
      tokenOut: FUND_A.address,
      amountIn: "10000000000000000000",
      minAmountOut: "9000000000000000000",
      deadline: "1750000100",
    },
    legs: [{ amountIn: "10000000000000000000", minAmountOut: "9000000000000000000", path: DIRECT_PATH }],
    ...overrides,
  };
}

function typedDirectContext() {
  return {
    route: "direct" as const,
    request: { chainId: 46630, input: USDG, output: FUND_A, inputAmount: "10", slippageBps: 50, requestedAt: NOW - 2_000, caller: CALLER },
    entryRouter: ROUTER,
    chainId: 46630,
    now: NOW,
  };
}

describe("swap state model", () => {
  it("accepts a pasted address but makes no metadata or verification claim", () => {
    const asset = pastedAsset(" 0x0000000000000000000000000000000000000001 ");
    expect(asset).toMatchObject({ symbol: "0x0000…0001", kind: "erc20", verified: false });
    expect(assetHasExecutableMetadata(asset!)).toBe(false);
    expect(asset?.isFactoryVault).toBeUndefined();
    expect(pastedAsset("not-an-address")).toBeUndefined();
  });

  it("requires resolved decimals and factory OTF identity without using informational verification", () => {
    expect(assetHasExecutableMetadata({ ...USDG, verified: false })).toBe(true);
    expect(assetHasExecutableMetadata({ ...USDG, metadataResolved: false })).toBe(false);
    expect(assetHasExecutableMetadata({ ...FUND_A, isFactoryVault: false })).toBe(false);
  });

  it("does not repair malformed decimal input into a quoteable amount", () => {
    expect(decimalInputValue("1.25")).toBe("1.25");
    expect(decimalInputValue("1..2")).toBeUndefined();
    expect(decimalInputValue("1e3")).toBeUndefined();
    expect(isPositiveDecimalAmount("1..2")).toBe(false);
    expect(isPositiveDecimalAmount("0")).toBe(false);
    expect(decimalAmount((1n << 256n).toString(), 0)).toBeUndefined();
  });

  it("models ERC20-to-OTF, OTF-to-ERC20 and OTF-to-OTF directions", () => {
    expect(classifySwapDirection(USDG, FUND_A)).toBe("erc20-to-otf");
    expect(classifySwapDirection(FUND_A, USDG)).toBe("otf-to-erc20");
    expect(classifySwapDirection(FUND_A, FUND_B)).toBe("otf-to-otf");
    expect(supportedSwapDirection(USDG, FUND_A)).toBe(true);
    expect(supportedSwapDirection(USDG, { ...USDG, address: FUND_B.address })).toBe(false);
    expect(swapDirectionLabel(USDG, FUND_A)).toBe("ERC-20 → OTF");
    expect(swapDirectionLabel(FUND_A, USDG)).toBe("OTF → ERC-20");
    expect(swapDirectionLabel(FUND_A, FUND_B)).toBe("OTF → OTF");
  });

  it("requests direct and basket routes concurrently, then selects the best returned valid quote", async () => {
    const direct = vi.fn(async () => quote("direct", "9.9"));
    const basket = vi.fn(async () => quote("basket", "10.1"));
    const service: SwapQuoteService = { quoteDirect: direct, quoteBasket: basket };
    const results = await requestConcurrentQuotes(service, {
      chainId: 46630,
      input: USDG,
      output: FUND_A,
      inputAmount: "10",
      slippageBps: 50,
      requestedAt: NOW,
    });
    expect(direct).toHaveBeenCalledOnce();
    expect(basket).toHaveBeenCalledOnce();
    expect(bestQueriedQuote(results, NOW)?.route).toBe("basket");
  });

  it("never contacts quote sources for an unresolved pasted token", async () => {
    const direct = vi.fn(async () => quote("direct", "9.9"));
    const basket = vi.fn(async () => quote("basket", "10.1"));
    const unresolved = pastedAsset("0x0000000000000000000000000000000000000004")!;
    const results = await requestConcurrentQuotes({ quoteDirect: direct, quoteBasket: basket }, {
      chainId: 46630,
      input: unresolved,
      output: FUND_A,
      inputAmount: "10",
      slippageBps: 50,
      requestedAt: NOW,
    });
    expect(direct).not.toHaveBeenCalled();
    expect(basket).not.toHaveBeenCalled();
    expect(results.every((result) => result.state === "unavailable")).toBe(true);
  });

  it("keeps a valid route when the other quote source fails", async () => {
    const service: SwapQuoteService = {
      quoteDirect: async () => { throw new Error("venue unavailable"); },
      quoteBasket: async () => quote("basket", "10.1"),
    };
    const results = await requestConcurrentQuotes(service, {
      chainId: 46630,
      input: USDG,
      output: FUND_A,
      inputAmount: "10",
      slippageBps: 50,
      requestedAt: NOW,
    });
    expect(results[0].state).toBe("failed");
    expect(bestQueriedQuote(results, NOW)?.route).toBe("basket");
  });

  it("never auto-selects a stale quote", () => {
    const stale = quote("direct", "20", NOW - 20_001);
    expect(bestQueriedQuote([stale], NOW)).toBeUndefined();
    expect(quoteNeedsRefresh(stale, NOW)).toBe(true);
  });

  it("compares quote outputs as fixed-decimal integers rather than JS numbers", () => {
    const smaller = quote("direct", "9007199254740993.000000000000000001");
    const larger = quote("basket", "9007199254740993.000000000000000002");
    expect(decimalAmount(larger.outputAmount!)).toBeGreaterThan(decimalAmount(smaller.outputAmount!)!);
    expect(bestQueriedQuote([smaller, larger], NOW)?.route).toBe("basket");
  });

  it("returns explicit unavailable results when no live endpoint is configured", async () => {
    const [direct, basket] = await requestConcurrentQuotes(unavailableQuoteService, {
      chainId: 46630,
      input: USDG,
      output: FUND_A,
      inputAmount: "10",
      slippageBps: 50,
      requestedAt: NOW,
    });
    expect(direct.state).toBe("unavailable");
    expect(basket.state).toBe("unavailable");
    expect(bestQueriedQuote([direct, basket], NOW)).toBeUndefined();
  });

  it("makes wallet, approval, simulation, submission, success and failure states explicit", () => {
    expect(executionStages({ walletConnected: false, networkSupported: true, usableQuote: false })).toMatchObject({
      wallet: "blocked", approval: "blocked", simulation: "blocked", submission: "blocked", success: "unavailable", failure: "unavailable",
    });
    expect(executionStages({ walletConnected: true, networkSupported: true, usableQuote: false })).toMatchObject({
      wallet: "ready", approval: "unavailable", simulation: "unavailable", submission: "unavailable", success: "unavailable", failure: "unavailable",
    });
  });
});

describe("typed entry-router quote boundary", () => {
  it("maps an authenticated direct response to one typed router method and exact approval", () => {
    const parsed = parseTypedQuoteResponse(typedDirectResponse(), typedDirectContext());
    expect(parsed.execution?.method).toBe("swapDirect");
    expect(parsed.hops).toEqual([expect.objectContaining({ venue: "Uniswap V3", tokenIn: USDG.address, tokenOut: FUND_A.address, feeTier: 3_000 })]);
    const plan = executionPlanForQuote(parsed, 46630, NOW);
    expect(plan).toMatchObject({ router: ROUTER, approval: { token: USDG.address, spender: ROUTER, amount: 10_000_000_000_000_000_000n } });
    expect(routerArgsForExecution(plan!.call)).toHaveLength(2);
  });

  it("rejects raw calldata and unknown methods", () => {
    expect(() => parseTypedQuoteResponse(typedDirectResponse({ calldata: "0xdeadbeef" }), typedDirectContext())).toThrow("forbidden field");
    expect(() => parseTypedQuoteResponse(typedDirectResponse({ method: "execute" }), typedDirectContext())).toThrow("unsupported entry-router method");
    expect(() => parseTypedQuoteResponse(typedDirectResponse({ minBasketAmounts: ["0"] }), typedDirectContext())).toThrow("basket minimums");
  });

  it("rejects responses for a wrong chain, router, caller, selected token, or deadline", () => {
    expect(() => parseTypedQuoteResponse(typedDirectResponse({ chainId: 1 }), typedDirectContext())).toThrow("wrong chain");
    expect(() => parseTypedQuoteResponse(typedDirectResponse({ router: FUND_B.address }), typedDirectContext())).toThrow("wrong entry router");
    expect(() => parseTypedQuoteResponse(typedDirectResponse({ caller: FUND_B.address }), typedDirectContext())).toThrow("wrong caller");
    expect(() => parseTypedQuoteResponse(typedDirectResponse({ request: { ...typedDirectResponse().request as Record<string, unknown>, tokenOut: USDG.address } }), typedDirectContext())).toThrow("tokens do not match");
    expect(() => parseTypedQuoteResponse(typedDirectResponse({ deadline: "1750001000" }), typedDirectContext())).toThrow("allowed horizon");
    expect(() => parseTypedQuoteResponse(typedDirectResponse({ quotedAtMs: NOW - 20_001 }), typedDirectContext())).toThrow("stale");
    expect(() => parseTypedQuoteResponse(typedDirectResponse({ inputAmountRaw: (1n << 256n).toString() }), typedDirectContext())).toThrow("uint256");
  });

  it("rejects excess legs, excess hops, malformed paths, and disconnected direct routes", () => {
    const leg = typedDirectResponse().legs as unknown[];
    expect(() => parseTypedQuoteResponse(typedDirectResponse({ legs: Array.from({ length: 41 }, () => leg[0]) }), typedDirectContext())).toThrow("leg limit");
    const fourHopPath = `0x${USDG.address.slice(2)}000bb8${FUND_B.address.slice(2)}000bb8${CALLER.slice(2)}000bb8${ROUTER.slice(2)}000bb8${FUND_A.address.slice(2)}`;
    expect(() => parseTypedQuoteResponse(typedDirectResponse({ legs: [{ ...leg[0] as Record<string, unknown>, path: fourHopPath }] }), typedDirectContext())).toThrow("hop limit");
    expect(() => parseTypedQuoteResponse(typedDirectResponse({ legs: [{ ...leg[0] as Record<string, unknown>, path: "0x00" }] }), typedDirectContext())).toThrow("packed length");
    const disconnected = `0x${FUND_B.address.slice(2)}000bb8${FUND_A.address.slice(2)}`;
    expect(() => parseTypedQuoteResponse(typedDirectResponse({ legs: [{ ...leg[0] as Record<string, unknown>, path: disconnected }] }), typedDirectContext())).toThrow("not funded");
  });

  it("keeps execution disabled while deployment quote configuration is absent", async () => {
    const [direct, basket] = await requestConcurrentQuotes(quoteServiceForChain(46630), {
      chainId: 46630,
      input: USDG,
      output: FUND_A,
      inputAmount: "10",
      slippageBps: 50,
      requestedAt: NOW,
      caller: CALLER,
    });
    expect(direct.state).toBe("unavailable");
    expect(basket.state).toBe("unavailable");
  });
});

describe("liquidity handoff", () => {
  it("keeps mainnet disabled until its USDG address is present in trusted configuration", () => {
    const venue = liquidityVenueFor(4663, FUND_A, USDG);
    expect(venue).toBeUndefined();
  });

  it("uses the official Synthra app without a documented pair prefill on testnet", () => {
    const testnetUsdg = { ...USDG, address: robinhoodTestnetAddresses.usdg! };
    expect(liquidityVenueFor(46630, FUND_A, testnetUsdg)).toEqual({
      name: "Synthra",
      href: "https://app.synthra.org/",
      prefilled: false,
    });
    expect(liquidityVenueFor(1, FUND_A, USDG)).toBeUndefined();
    expect(liquidityVenueFor(46630, { ...FUND_A, isFactoryVault: false }, testnetUsdg)).toBeUndefined();
    expect(liquidityActionLabel("FUND")).toBe("Add liquidity to FUND/USDG");
  });
});

describe("OTF creation validation", () => {
  it("rejects duplicate, over-limit constituents and invalid immutable economics", () => {
    const errors = creationValidation({
      name: "",
      symbol: "",
      mandate: "",
      constituents: Array.from({ length: 21 }, (_, index) => ({
        address: index === 1 ? "0x0000000000000000000000000000000000000001" : `0x${String(index + 1).padStart(40, "0")}`,
      })),
      annualExpenseRatioBps: 1_001,
      beneficiary: "not-an-address",
    });
    expect(errors).toEqual(expect.arrayContaining([
      "Enter the complete fund name ending in ' OTF' (for example, 'Technology Leaders OTF').",
      "Enter a ticker using letters, numbers, or hyphens.",
      "Write an initial strategy rationale.",
      "An OTF can include at most 20 constituents.",
      "Duplicate constituents are not allowed.",
      "Annual creator expense ratio must be between 0 and 1000 bps.",
      "A valid nonzero fixed beneficiary address is required.",
    ]));
  });

  it("rejects zero constituent and beneficiary addresses", () => {
    expect(creationValidation({
      name: "Zero Fund OTF",
      symbol: "ZERO",
      mandate: "Validate zero-address handling.",
      constituents: [{ address: "0x0000000000000000000000000000000000000000" }],
      annualExpenseRatioBps: 0,
      beneficiary: "0x0000000000000000000000000000000000000000",
    })).toEqual(expect.arrayContaining([
      "The zero address cannot be a constituent.",
      "A valid nonzero fixed beneficiary address is required.",
    ]));
  });

  it("requires the OTF suffix and a bounded nonempty mandate", () => {
    const validInput = {
      name: "Technology Leaders OTF",
      symbol: "TECH",
      mandate: "Track a transparent basket of technology leaders.",
      constituents: [{ address: "0x0000000000000000000000000000000000000001" }],
      annualExpenseRatioBps: 0,
      beneficiary: "0x0000000000000000000000000000000000000002",
    };

    expect(creationValidation(validInput)).toEqual([]);
    expect(creationValidation({ ...validInput, name: "Technology Leaders" })).toContain("Enter the complete fund name ending in ' OTF' (for example, 'Technology Leaders OTF').");
    expect(creationValidation({ ...validInput, mandate: "" })).toContain("Write an initial strategy rationale.");
    expect(creationValidation({ ...validInput, mandate: "🚀".repeat(513) })).toContain("Shorten the initial strategy rationale to 2,048 bytes or fewer.");
  });
});
