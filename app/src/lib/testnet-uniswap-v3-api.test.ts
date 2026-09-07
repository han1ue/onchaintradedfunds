import { encodeV3Path } from "./v3-route";
import { type BasketPlannerRequest } from "./basket-planner";
import { decodeFunctionData, maxUint256, type Address, type Hex } from "viem";
import { describe, expect, it, vi } from "vitest";
import {
  testnetAssetById,
  testnetPoolForPair,
  testnetVenue,
} from "./asset-catalog";
import { parseTypedQuoteResponse, type SwapAsset, type SwapQuoteRequest } from "./swap-model";
import {
  quoteTestnetSwap,
  uniswapV3SwapRouterAbi,
  type TestnetRoutingClient,
} from "./testnet-uniswap-v3-api";

const CALLER = "0x00000000000000000000000000000000000000C0" as const;
const OTF_A = "0x00000000000000000000000000000000000000f1" as const;
const OTF_B = "0x00000000000000000000000000000000000000f2" as const;
const OTF_POOL = "0x00000000000000000000000000000000000000a1" as const;
const NOW = 1_750_000_000_000;
const TEST_DEPLOYMENT = {
  factory: "0x00000000000000000000000000000000000000d1",
  entryRouter: "0x00000000000000000000000000000000000000d2",
  uniswapV3Adapter: "0x00000000000000000000000000000000000000d3",
  nativeBasketReady: true,
} as const;

const usdg = testnetAssetById("usdg")!;
const weth = testnetAssetById("weth")!;
const tsla = testnetAssetById("tsla")!;
const amzn = testnetAssetById("amzn")!;

function asset(value: typeof usdg, kind: "erc20" | "otf" = "erc20") {
  return { address: value.address, decimals: value.decimals, kind, isFactoryVault: kind === "otf" };
}

function otf(address: Address) {
  return { address, decimals: 18, kind: "otf" as const, isFactoryVault: true };
}

function plannerRequest(
  input: BasketPlannerRequest["input"] = asset(usdg),
  output: BasketPlannerRequest["output"] = otf(OTF_A),
  route: "direct" | "basket" = "direct",
): BasketPlannerRequest {
  return {
    route,
    chainId: 46630,
    caller: CALLER,
    input,
    output,
    inputAmountRaw: input.decimals === 6 ? 10_000_000n : 10n ** 18n,
    slippageBps: 50,
    requestedAtMs: NOW - 1_000,
  };
}

function routingClient(overrides: Partial<TestnetRoutingClient> = {}): TestnetRoutingClient {
  const vaultAssets = new Map<string, readonly Address[]>([
    [OTF_A.toLowerCase(), [tsla.address, amzn.address]],
    [OTF_B.toLowerCase(), [amzn.address, tsla.address]],
  ]);
  return {
    verifyBindings: vi.fn(async () => {}),
    isVault: vi.fn(async () => true),
    poolFor: vi.fn(async (tokenA, tokenB, fee) => {
      const configured = testnetPoolForPair(tokenA, tokenB);
      if (configured && configured.fee === fee) return configured.address;
      const containsUsdg = tokenA.toLowerCase() === usdg.address.toLowerCase() || tokenB.toLowerCase() === usdg.address.toLowerCase();
      return containsUsdg && fee === 500 ? OTF_POOL : undefined;
    }),
    poolLiquidity: vi.fn(async () => 1n),
    quoteExactInput: vi.fn(async (_path, amountIn) => amountIn * 2n),
    quoteExactOutput: vi.fn(async (_path, amountOut) => (amountOut + 999_999_999_999n) / 1_000_000_000_000n),
    vaultAssets: vi.fn(async (vault) => vaultAssets.get(vault.toLowerCase()) ?? []),
    previewMint: vi.fn(async (_vault, shares) => [shares / 2n, shares - shares / 2n]),
    previewRedeem: vi.fn(async (_vault, shares, _owner, skipMask) => {
      if (skipMask !== 0n) throw new Error("Unexpected skip mask");
      return [shares / 2n, shares - shares / 2n];
    }),
    ...overrides,
  };
}

function dependencies(client = routingClient()) {
  return { now: () => NOW, client, deployment: TEST_DEPLOYMENT };
}

function swapAsset(value: BasketPlannerRequest["input"], symbol: string): SwapAsset {
  return {
    address: value.address,
    symbol,
    name: symbol,
    kind: value.kind,
    decimals: value.decimals,
    metadataResolved: true,
    isFactoryVault: value.kind === "otf",
  };
}

function parseResponse(response: unknown, request: BasketPlannerRequest) {
  const modelRequest: SwapQuoteRequest = {
    chainId: request.chainId,
    caller: request.caller,
    input: swapAsset(request.input, "IN"),
    output: swapAsset(request.output, "OUT"),
    inputAmount: request.input.decimals === 6 ? "10" : "1",
    slippageBps: request.slippageBps,
    requestedAt: request.requestedAtMs,
  };
  return parseTypedQuoteResponse(response, {
    route: request.route,
    request: modelRequest,
    chainId: 46630,
    now: NOW,
    entryRouter: TEST_DEPLOYMENT.entryRouter,
    adapter: TEST_DEPLOYMENT.uniswapV3Adapter,
    swapRouter02: testnetVenue.swapRouter02,
  });
}

describe("Uniswap V3 testnet quote planner", () => {
  it("returns a validated direct exact-input plan for an OTF pool", async () => {
    const request = plannerRequest();
    const result = await quoteTestnetSwap(request, dependencies());
    expect(result.status).toBe(200);
    const execution = (result.body as Record<string, unknown>).execution as Record<string, unknown>;
    expect(execution).toMatchObject({ kind: "direct-v3", swapRouter02: testnetVenue.swapRouter02 });
    expect(execution.path).toBe(encodeV3Path([usdg.address, OTF_A], [500]));
    const transaction = execution.transaction as { to: Address; data: Hex };
    expect(transaction.to).toBe(testnetVenue.swapRouter02);
    expect(decodeFunctionData({ abi: uniswapV3SwapRouterAbi, data: transaction.data })).toMatchObject({ functionName: "exactInput" });
    const parsed = parseResponse(result.body, request);
    expect(parsed.expiresAt).toBe(NOW + 45_000);
    expect(execution.expiresAtMs).toBe(NOW + 45_000);
    expect(parsed.execution).toMatchObject({ kind: "direct-v3", amountIn: 10_000_000n });
    expect(parsed.hops?.[0]).toMatchObject({ venue: "Uniswap V3", feeTier: 500 });
  });

  it("rejects a tampered direct router target before execution", async () => {
    const request = plannerRequest();
    const result = await quoteTestnetSwap(request, dependencies());
    const body = result.body as Record<string, unknown>;
    const execution = body.execution as Record<string, unknown>;
    expect(() => parseResponse({
      ...body,
      execution: { ...execution, swapRouter02: OTF_POOL },
    }, request)).toThrow(/router/);
  });

  it("routes WETH to an OTF through USDG", async () => {
    const request = plannerRequest(asset(weth), otf(OTF_A));
    const result = await quoteTestnetSwap(request, dependencies());
    expect(result.status).toBe(200);
    const execution = (result.body as Record<string, unknown>).execution as Record<string, unknown>;
    expect(execution.path).toBe(encodeV3Path([weth.address, usdg.address, OTF_A], [500, 500]));
  });

  it("keeps unsafe native direct routes unavailable and uses explicit native basket calls", async () => {
    const eth = { ...asset(weth), kind: "native" as const };
    const direct = await quoteTestnetSwap(plannerRequest(eth, otf(OTF_A)), dependencies());
    expect(direct.body).toMatchObject({ state: "unavailable", route: "direct" });

    const mint = plannerRequest(eth, otf(OTF_A), "basket");
    const mintResult = await quoteTestnetSwap(mint, dependencies());
    expect(parseResponse(mintResult.body, mint).execution).toMatchObject({
      kind: "basket-router",
      approval: undefined,
      nativeValue: 10n ** 18n,
      call: { method: "mintFromNative" },
    });

    const redeem = plannerRequest(otf(OTF_A), eth, "basket");
    const redeemResult = await quoteTestnetSwap(redeem, dependencies());
    expect(parseResponse(redeemResult.body, redeem).execution).toMatchObject({
      kind: "basket-router",
      nativeValue: 0n,
      call: { method: "redeemToNative" },
    });
  });

  it("rejects disallowed pairs without touching the routing client", async () => {
    const client = routingClient();
    const result = await quoteTestnetSwap(plannerRequest(asset(tsla), asset(amzn)), dependencies(client));
    expect(result.body).toMatchObject({ state: "unavailable", reason: "This pair is outside the configured testnet asset policy." });
    expect(client.poolFor).not.toHaveBeenCalled();
    expect((await quoteTestnetSwap(plannerRequest(otf(OTF_A), asset(tsla), "basket"), dependencies(client))).status).toBe(503);
  });

  it("rejects token decimals that do not match the catalog", async () => {
    const client = routingClient();
    const result = await quoteTestnetSwap(plannerRequest({ ...asset(usdg), decimals: 18 }, otf(OTF_A)), dependencies(client));
    expect(result.body).toMatchObject({ state: "unavailable", reason: "The selected asset metadata does not match the testnet catalog." });
    expect(client.poolFor).not.toHaveBeenCalled();
  });

  it("refuses a constituent pool that does not match the Uniswap V3 factory", async () => {
    const client = routingClient({ poolFor: vi.fn(async () => OTF_POOL) });
    const result = await quoteTestnetSwap(plannerRequest(asset(usdg), otf(OTF_A), "basket"), dependencies(client));
    expect(result.body).toMatchObject({ state: "unavailable", reason: "No executable basket route is currently available." });
  });

  it("rejects a stale adapter before requesting a quote", async () => {
    const client = routingClient({ verifyBindings: vi.fn(async () => { throw new Error("Stale V3 adapter"); }) });
    expect((await quoteTestnetSwap(plannerRequest(asset(usdg), otf(OTF_A), "basket"), dependencies(client))).status).toBe(503);
    expect(client.quoteExactInput).not.toHaveBeenCalled();
    expect(client.quoteExactOutput).not.toHaveBeenCalled();
  });

  it("rejects native basket routing when the connecting WETH market is missing", async () => {
    const normal = routingClient();
    const client = routingClient({ poolFor: vi.fn(async (a, b, fee) => a.toLowerCase() === weth.address.toLowerCase() || b.toLowerCase() === weth.address.toLowerCase() ? undefined : normal.poolFor(a, b, fee)) });
    const eth = { ...asset(weth), kind: "native" as const };
    expect((await quoteTestnetSwap(plannerRequest(eth, otf(OTF_A), "basket"), dependencies(client))).status).toBe(503);
  });

  it("returns typed mint, redeem, and OTF-to-OTF basket plans", async () => {
    const client = routingClient();
    const mint = plannerRequest(asset(usdg), otf(OTF_A), "basket");
    const redeem = plannerRequest(otf(OTF_A), asset(usdg), "basket");
    const convert = plannerRequest(otf(OTF_A), otf(OTF_B), "basket");

    const mintResult = await quoteTestnetSwap(mint, dependencies(client));
    const redeemResult = await quoteTestnetSwap(redeem, dependencies(client));
    const convertResult = await quoteTestnetSwap(convert, dependencies(client));
    for (const result of [mintResult, redeemResult, convertResult]) {
      expect(result.body).toMatchObject({ expiresAtMs: NOW + 45_000 });
    }

    expect(parseResponse(mintResult.body, mint).execution).toMatchObject({ kind: "basket-router", call: { method: "mintFromToken" } });
    expect(parseResponse(redeemResult.body, redeem).execution).toMatchObject({ kind: "basket-router", call: { method: "redeemToToken" } });
    expect(parseResponse(convertResult.body, convert).execution).toMatchObject({ kind: "basket-router", call: { method: "swapBasketToBasket" } });
    expect((convertResult.body as Record<string, unknown>).routeLabel).toBe("Burn + mint");
    expect(client.previewRedeem).toHaveBeenCalledTimes(2);
    expect(client.previewRedeem).toHaveBeenNthCalledWith(1, OTF_A, redeem.inputAmountRaw, CALLER, 0n);
    expect(client.previewRedeem).toHaveBeenNthCalledWith(2, OTF_A, convert.inputAmountRaw, CALLER, 0n);
  });

  it.each(["erc20", "native"] as const)("uses owner-specific redemption previews for %s quotes after NAV fees", async (kind) => {
    const collector = "0x00000000000000000000000000000000000000c1" as Address;
    const client = routingClient({
      previewRedeem: vi.fn(async (_vault, shares, owner) => {
        // The vault has accrued 10% annual NAV fees and charges investors 1% to redeem.
        const backing = shares * 9n / 10n;
        const redeemable = owner === collector ? backing : backing * 99n / 100n;
        return [redeemable / 2n, redeemable - redeemable / 2n];
      }),
    });
    const request = plannerRequest(otf(OTF_A), { ...asset(weth), kind }, "basket");
    const investorResult = await quoteTestnetSwap(request, dependencies(client));
    const collectorRequest = { ...request, caller: collector };
    const collectorResult = await quoteTestnetSwap(collectorRequest, dependencies(client));
    const investorQuote = parseResponse(investorResult.body, request);
    const collectorQuote = parseResponse(collectorResult.body, collectorRequest);

    expect(client.previewRedeem).toHaveBeenNthCalledWith(1, OTF_A, request.inputAmountRaw, CALLER, 0n);
    expect(client.previewRedeem).toHaveBeenNthCalledWith(2, OTF_A, request.inputAmountRaw, collector, 0n);
    const backing = request.inputAmountRaw * 9n / 10n;
    expect(investorQuote.expectedOutputRaw).toBe(backing * 99n / 100n * 4n);
    expect(collectorQuote.expectedOutputRaw).toBe(backing * 4n);
    expect(collectorQuote.minimumReceivedRaw).toBeGreaterThan(investorQuote.minimumReceivedRaw!);
  });

  it.each(["usdg", "weth", "native"] as const)("aggregates a five-asset burn into %s with one settlement swap at most", async (outputKind) => {
    const constituents = ["tsla", "amzn", "pltr", "nflx", "amd"].map((id) => testnetAssetById(id)!.address);
    const settlementPath = encodeV3Path([usdg.address, weth.address], [500]);
    const client = routingClient({
      vaultAssets: vi.fn(async () => constituents),
      previewRedeem: vi.fn(async (_vault, shares) => constituents.map(() => shares / 5n)),
      quoteExactInput: vi.fn(async (path, amount) => path === settlementPath
        // A nonlinear quote distinguishes one combined swap from independent quotes.
        ? amount * 10n ** 18n / (10_000_000n + amount)
        : amount / 100_000_000_000n),
    });
    const output = outputKind === "usdg" ? asset(usdg) : { ...asset(weth), kind: outputKind === "native" ? "native" as const : "erc20" as const };
    const request = plannerRequest(otf(OTF_A), output, "basket");
    const result = await quoteTestnetSwap(request, dependencies(client));
    expect(result.status).toBe(200);
    const quote = parseResponse(result.body, request);
    const expectedOutput = outputKind === "usdg" ? 10_000_000n : 500_000_000_000_000_000n;
    const minimumOutput = expectedOutput * 9950n / 10_000n;
    expect(quote.expectedOutputRaw).toBe(expectedOutput);
    expect(quote.minimumReceivedRaw).toBe(minimumOutput);
    expect(quote.hops).toHaveLength(outputKind === "usdg" ? 5 : 6);
    const execution = quote.execution;
    if (execution?.kind !== "basket-router" || (execution.call.method !== "redeemToToken" && execution.call.method !== "redeemToNative")) throw new Error("Expected a basket redemption");
    const [redeem, , legs] = execution.call.args;
    expect(redeem.minAmountOut).toBe(minimumOutput);
    expect(execution.call.method).toBe(outputKind === "native" ? "redeemToNative" : "redeemToToken");
    expect(legs).toHaveLength(outputKind === "usdg" ? 5 : 6);
    for (const [index, token] of constituents.entries()) {
      expect(legs[index]).toMatchObject({
        tokenIn: token, tokenOut: usdg.address, amountIn: maxUint256,
        minAmountOut: 1_990_000n, data: encodeV3Path([token, usdg.address], [3000]),
      });
    }
    expect(client.quoteExactInput).toHaveBeenCalledTimes(legs.length);
    if (outputKind !== "usdg") {
      expect(client.quoteExactInput).toHaveBeenLastCalledWith(settlementPath, 10_000_000n);
      expect(legs[5]).toMatchObject({
        tokenIn: usdg.address, tokenOut: weth.address, amountIn: maxUint256,
        minAmountOut: minimumOutput, data: settlementPath,
      });
    }
  });

  it("normalizes zero-liquidity routes as unavailable", async () => {
    const result = await quoteTestnetSwap(
      plannerRequest(),
      dependencies(routingClient({ poolLiquidity: vi.fn(async () => 0n) })),
    );
    expect(result.status).toBe(503);
  });
});
