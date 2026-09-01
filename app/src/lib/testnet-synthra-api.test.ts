import { decodeFunctionData, type Address, type Hex } from "viem";
import { describe, expect, it, vi } from "vitest";
import {
  testnetAssetById,
  testnetPoolForPair,
  testnetVenue,
} from "./asset-catalog";
import { parseTypedQuoteResponse, type SwapAsset, type SwapQuoteRequest } from "./swap-model";
import {
  encodeV3Path,
  quoteTestnetSwap,
  synthraSwapRouterAbi,
  type TestnetPlannerRequest,
  type TestnetRoutingClient,
} from "./testnet-synthra-api";

const CALLER = "0x00000000000000000000000000000000000000C0" as const;
const OTF_A = "0x00000000000000000000000000000000000000f1" as const;
const OTF_B = "0x00000000000000000000000000000000000000f2" as const;
const OTF_POOL = "0x00000000000000000000000000000000000000a1" as const;
const NOW = 1_750_000_000_000;
const TEST_DEPLOYMENT = {
  factory: "0x00000000000000000000000000000000000000d1",
  entryRouter: "0x00000000000000000000000000000000000000d2",
  uniswapV3Adapter: "0x00000000000000000000000000000000000000d3",
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
  input: TestnetPlannerRequest["input"] = asset(usdg),
  output: TestnetPlannerRequest["output"] = otf(OTF_A),
  route: "direct" | "basket" = "direct",
): TestnetPlannerRequest {
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
    previewRedeem: vi.fn(async (_vault, shares) => [shares / 2n, shares - shares / 2n]),
    ...overrides,
  };
}

function dependencies(client = routingClient()) {
  return { now: () => NOW, client, deployment: TEST_DEPLOYMENT };
}

function swapAsset(value: TestnetPlannerRequest["input"], symbol: string): SwapAsset {
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

function parseResponse(response: unknown, request: TestnetPlannerRequest) {
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

describe("Synthra testnet quote planner", () => {
  it("returns a validated direct exact-input plan for an OTF pool", async () => {
    const request = plannerRequest();
    const result = await quoteTestnetSwap(request, dependencies());
    expect(result.status).toBe(200);
    const execution = (result.body as Record<string, unknown>).execution as Record<string, unknown>;
    expect(execution).toMatchObject({ kind: "direct-v3", swapRouter02: testnetVenue.swapRouter02 });
    expect(execution.path).toBe(encodeV3Path([usdg.address, OTF_A], [500]));
    const transaction = execution.transaction as { to: Address; data: Hex };
    expect(transaction.to).toBe(testnetVenue.swapRouter02);
    expect(decodeFunctionData({ abi: synthraSwapRouterAbi, data: transaction.data })).toMatchObject({ functionName: "exactInput" });
    const parsed = parseResponse(result.body, request);
    expect(parsed.execution).toMatchObject({ kind: "direct-v3", amountIn: 10_000_000n });
    expect(parsed.hops?.[0]).toMatchObject({ venue: "Synthra V3", feeTier: 500 });
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
    expect(execution.path).toBe(encodeV3Path([weth.address, usdg.address, OTF_A], [100, 500]));
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

  it("refuses a constituent pool that does not match the Synthra factory", async () => {
    const client = routingClient({ poolFor: vi.fn(async () => OTF_POOL) });
    const result = await quoteTestnetSwap(plannerRequest(asset(usdg), otf(OTF_A), "basket"), dependencies(client));
    expect(result.body).toMatchObject({ state: "unavailable", reason: "No executable basket route is currently available." });
  });

  it("returns typed mint, redeem, and OTF-to-OTF basket plans", async () => {
    const client = routingClient();
    const mint = plannerRequest(asset(usdg), otf(OTF_A), "basket");
    const redeem = plannerRequest(otf(OTF_A), asset(usdg), "basket");
    const convert = plannerRequest(otf(OTF_A), otf(OTF_B), "basket");

    const mintResult = await quoteTestnetSwap(mint, dependencies(client));
    const redeemResult = await quoteTestnetSwap(redeem, dependencies(client));
    const convertResult = await quoteTestnetSwap(convert, dependencies(client));

    expect(parseResponse(mintResult.body, mint).execution).toMatchObject({ kind: "basket-router", call: { method: "mintFromToken" } });
    expect(parseResponse(redeemResult.body, redeem).execution).toMatchObject({ kind: "basket-router", call: { method: "redeemToToken" } });
    expect(parseResponse(convertResult.body, convert).execution).toMatchObject({ kind: "basket-router", call: { method: "swapBasketToBasket" } });
    expect((convertResult.body as Record<string, unknown>).routeLabel).toBe("Burn + mint");
  });

  it("normalizes zero-liquidity routes as unavailable", async () => {
    const result = await quoteTestnetSwap(
      plannerRequest(),
      dependencies(routingClient({ poolLiquidity: vi.fn(async () => 0n) })),
    );
    expect(result.status).toBe(503);
  });
});
