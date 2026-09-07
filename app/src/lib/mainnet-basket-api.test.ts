import { decodeFunctionData, maxUint256, zeroAddress, type Address } from "viem";
import { describe, expect, it, vi } from "vitest";
import { type BasketPlannerRequest } from "./basket-planner";
import { quoteMainnetBasket } from "./mainnet-basket-api";
import { basketSimulationCalls, type MainnetBasketClient, type MainnetBasketDeployment } from "./mainnet-basket-client";
import { parseTypedQuoteResponse, type BasketRouterExecution } from "./swap-model";
import { handleSwapQuoteRequest } from "./uniswap-trading-api";
import { otfEntryExitRouterAbi } from "@onchaintradedfunds/generated";
import { encodeV4Path, parseV4Path } from "./v4-route";
import { QuoteFailure } from "./quote-errors";

const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
const INPUT = addr(1), A = addr(2), B = addr(3), VAULT = addr(4), CALLER = addr(5);
const NOW = 1_750_000_000_000;
const DEPLOYMENT: MainnetBasketDeployment = {
  factory: addr(10), entryRouter: addr(11), uniswapV3Adapter: addr(12), weth: addr(13), uniswapV3Factory: addr(14), uniswapV3Router: addr(15),
  uniswapV4Adapter: addr(30), uniswapV4PoolManager: addr(31), uniswapV4StateView: addr(32), universalRouter: addr(33), permit2: addr(34),
};
const token = (address: Address, kind: "erc20" | "native" | "otf" = "erc20") => ({ address, kind, decimals: 18, isFactoryVault: kind === "otf" });
function request(burn = false): BasketPlannerRequest {
  return { route: "basket", chainId: 4663, caller: CALLER,
    input: burn ? token(VAULT, "otf") : token(INPUT), output: burn ? token(INPUT) : token(VAULT, "otf"),
    inputAmountRaw: 10n ** 18n, slippageBps: 50, requestedAtMs: NOW - 1_000,
  };
}
function provider(split = false) {
  return vi.fn(async (body: Record<string, unknown>) => {
    const amount = BigInt(body.amount as string);
    const amountIn = body.type === "EXACT_INPUT" ? amount : (amount + 1n) / 2n;
    const amountOut = body.type === "EXACT_OUTPUT" ? amount : amount * 2n;
    const from = { address: body.tokenIn, chainId: 4663 };
    const to = { address: body.tokenOut, chainId: 4663 };
    const hop = (input: bigint, output: bigint, pool: Address) => ({
      type: "v3-pool", address: pool, tokenIn: from, tokenOut: to, fee: "3000", amountIn: input.toString(), amountOut: output.toString(),
    });
    return { routing: "CLASSIC", quote: {
      input: { token: body.tokenIn, amount: amountIn.toString() },
      output: { token: body.tokenOut, amount: amountOut.toString(), recipient: DEPLOYMENT.entryRouter },
      chainId: 4663, swapper: DEPLOYMENT.entryRouter, tradeType: body.type,
      route: split ? [[hop(amountIn / 2n, amountOut / 2n, addr(20))], [hop(amountIn - amountIn / 2n, amountOut - amountOut / 2n, addr(21))]]
        : [[hop(amountIn, amountOut, addr(20))]],
    } };
  });
}
function client(overrides: Partial<MainnetBasketClient> = {}): MainnetBasketClient {
  return {
    verifyBindings: vi.fn(async () => {}), isVault: vi.fn(async () => true), decimals: vi.fn(async () => 18),
    authenticatePool: vi.fn(async () => {}), authenticateV4Pool: vi.fn(async () => {}), vaultAssets: vi.fn(async () => [A, B]),
    previewMint: vi.fn(async (_vault, shares) => [shares / 2n, shares - shares / 2n]),
    previewRedeem: vi.fn(async (_vault, shares) => [shares / 2n, shares - shares / 2n]),
    simulate: vi.fn(async (execution) => ({
      amountOut: execution.call.method === "mintFromToken" || execution.call.method === "mintFromNative"
        ? execution.call.args[0].minShares
        : execution.call.method === "swapBasketToBasket" ? execution.call.args[0].minSharesOut : 2n * 10n ** 18n,
      refunds: [], gasUsed: 500_000n,
    })), ...overrides,
  };
}
function deps(routingClient = client(), quoteProvider = provider()) {
  return { now: () => NOW, deployment: DEPLOYMENT, client: routingClient, requestQuote: quoteProvider };
}
function parse(body: unknown, req: BasketPlannerRequest) {
  return parseTypedQuoteResponse(body, {
    route: "basket", chainId: 4663, now: NOW, weth: DEPLOYMENT.weth, entryRouter: DEPLOYMENT.entryRouter, adapter: DEPLOYMENT.uniswapV3Adapter, v4Adapter: DEPLOYMENT.uniswapV4Adapter,
    request: { ...req, inputAmount: "1", requestedAt: req.requestedAtMs,
      input: { ...req.input, name: "IN", symbol: "IN", metadataResolved: true }, output: { ...req.output, name: "OUT", symbol: "OUT", metadataResolved: true } },
  });
}

describe("mainnet basket planner", () => {
  it.each([false, true])("uses native V4 pools behind WETH router endpoints (burn=%s)", async (burn) => {
    const base = provider();
    const requestQuote = vi.fn(async (body: Record<string, unknown>) => {
      if (body.tokenIn !== zeroAddress && body.tokenOut !== zeroAddress) throw new QuoteFailure("NO_ROUTE");
      const response = await base(body);
      response.quote.route = response.quote.route.map((path) => path.map((pool) => ({ ...pool, type: "v4-pool", tickSpacing: 60, hooks: zeroAddress })));
      return response;
    });
    const req = request(burn);
    if (burn) req.output = token(DEPLOYMENT.weth, "native"); else req.input = token(DEPLOYMENT.weth, "native");
    const dependencies = { ...deps(), requestQuote };
    const result = await quoteMainnetBasket(req, dependencies);
    expect(result.status).toBe(200);
    const execution = parse(result.body, req).execution as BasketRouterExecution;
    const legs = execution.call.method === "mintFromNative" ? execution.call.args[1] : execution.call.args[2];
    for (const leg of legs!) {
      expect(burn ? leg.tokenOut : leg.tokenIn).toBe(DEPLOYMENT.weth);
      expect(burn ? leg.hops.at(-1)!.tokenOut : leg.hops[0]!.tokenIn).toBe(zeroAddress);
    }
    expect(dependencies.client.simulate).toHaveBeenCalledWith(execution);
    const data = structuredClone(result.body) as unknown as { execution: { legs: { tokenIn: Address; tokenOut: Address }[] } };
    if (burn) data.execution.legs[0]!.tokenOut = INPUT; else data.execution.legs[0]!.tokenIn = INPUT;
    expect(() => parse(data, req)).toThrow(/endpoints/);
  });

  it.each([false, true])("supports splits across V3 and V4 and preserves returned hook data (burn=%s)", async (burn) => {
    const base = provider(true);
    const requestQuote = vi.fn(async (body: Record<string, unknown>) => {
      const response = await base(body);
      response.quote.route = response.quote.route.map((path, index) => path.map((pool) => index === 0 ? pool : {
        ...pool, type: "v4-pool", tickSpacing: 60, hooks: addr(40), hookData: "0x1234",
      }));
      return response;
    });
    const req = request(burn), dependencies = { ...deps(), requestQuote };
    const result = await quoteMainnetBasket(req, dependencies);
    expect(result.status).toBe(200);
    const quote = parse(result.body, req);
    expect(quote.hops?.map((hop) => hop.venue)).toEqual(["Uniswap V3", "Uniswap V4", "Uniswap V3", "Uniswap V4"]);
    const execution = quote.execution as BasketRouterExecution;
    const legs = execution.call.method === "mintFromToken" ? execution.call.args[1] : execution.call.args[2];
    for (const index of [1, 3]) {
      const leg = legs![index]!;
      expect(leg.data).toBe(encodeV4Path(leg.tokenIn, [{ intermediateCurrency: leg.tokenOut, fee: 3000, tickSpacing: 60, hooks: addr(40), hookData: "0x1234" }]));
      if (burn) expect(leg.amountIn).toBe(maxUint256);
    }
    expect(dependencies.client.simulate).toHaveBeenCalledWith(execution);
  });

  it.each([false, true])("executes API V4 routes through the V4 adapter (burn=%s)", async (burn) => {
    const base = provider();
    const requestQuote = vi.fn(async (body: Record<string, unknown>) => {
      const response = await base(body);
      response.quote.route = response.quote.route.map((path) => path.map((pool) => ({ ...pool, type: "v4-pool", tickSpacing: 60, hooks: zeroAddress })));
      return response;
    });
    const dependencies = { ...deps(), requestQuote };
    const req = request(burn);
    const result = await quoteMainnetBasket(req, dependencies);
    expect(result.status).toBe(200);
    const quote = parse(result.body, req);
    expect(quote.hops?.map((hop) => hop.venue)).toEqual(["Uniswap V4", "Uniswap V4"]);
    const execution = quote.execution as BasketRouterExecution;
    expect(execution.v4Adapter).toBe(DEPLOYMENT.uniswapV4Adapter);
    const legs = execution.call.method === "mintFromToken" ? execution.call.args[1] : execution.call.args[2];
    for (const leg of legs!) {
      expect(leg.adapter.toLowerCase()).toBe(DEPLOYMENT.uniswapV4Adapter.toLowerCase());
      expect(parseV4Path(leg.data)).toEqual(leg.hops);
    }
    expect(dependencies.client.authenticateV4Pool).toHaveBeenCalled();
    expect(dependencies.client.authenticatePool).not.toHaveBeenCalled();
    expect(dependencies.client.simulate).toHaveBeenCalledWith(execution);
    const altered = { ...result.body, execution: { ...(result.body as { execution: object }).execution, v4Adapter: addr(99) } };
    expect(() => parse(altered, req)).toThrow(/adapter/i);
  });

  it.each([false, true])("connects mixed V3/V4 paths without spending intermediate tokens twice (burn=%s)", async (burn) => {
    const base = provider();
    const requestQuote = vi.fn(async (body: Record<string, unknown>) => {
      const response = await base(body);
      const middle = { address: addr(40), chainId: 4663 };
      response.quote.route = response.quote.route.map(([pool]) => [
        { ...pool!, tokenOut: middle },
        { ...pool!, type: "v4-pool", tokenIn: middle, tickSpacing: 60, hooks: zeroAddress },
      ]);
      return response;
    });
    const req = request(burn), dependencies = { ...deps(), requestQuote };
    const result = await quoteMainnetBasket(req, dependencies);
    expect(result.status).toBe(200);
    const quote = parse(result.body, req);
    expect(quote.hops?.map((hop) => hop.venue)).toEqual(["Uniswap V3", "Uniswap V4", "Uniswap V3", "Uniswap V4"]);
    const execution = quote.execution as BasketRouterExecution;
    const legs = execution.call.method === "mintFromToken" ? execution.call.args[1] : execution.call.args[2];
    expect(legs![0].minAmountOut).toBe(1n);
    expect(legs![1]).toMatchObject({ tokenIn: addr(40), amountIn: maxUint256 });
    expect(legs![3]).toMatchObject({ tokenIn: addr(40), amountIn: maxUint256 });
    if (!burn) expect(legs![0].amountIn + legs![2].amountIn).toBeLessThanOrEqual(req.inputAmountRaw);
  });

  it("rejects mixed-protocol boundaries that would consume another constituent", async () => {
    const base = provider();
    const requestQuote = vi.fn(async (body: Record<string, unknown>) => {
      const response = await base(body);
      const middle = { address: body.tokenIn === A ? B : A, chainId: 4663 };
      response.quote.route = response.quote.route.map(([pool]) => [
        { ...pool!, tokenOut: middle },
        { ...pool!, type: "v4-pool", tokenIn: middle, tickSpacing: 60, hooks: zeroAddress },
      ]);
      return response;
    });
    const dependencies = { ...deps(), requestQuote };
    expect((await quoteMainnetBasket(request(true), dependencies)).status).toBe(503);
    expect(dependencies.client.simulate).not.toHaveBeenCalled();
  });

  it.each([false, true])("quotes and simulates independent constituent routes (burn=%s)", async (burn) => {
    const req = request(burn), dependencies = deps();
    const result = await quoteMainnetBasket(req, dependencies);
    expect(result.status).toBe(200);
    const quote = parse(result.body, req);
    expect(quote.hops).toHaveLength(2);
    expect(dependencies.requestQuote).toHaveBeenCalledWith(expect.objectContaining({
      type: burn ? "EXACT_INPUT" : "EXACT_OUTPUT", protocols: ["V3", "V4"], routingPreference: "BEST_PRICE", swapper: DEPLOYMENT.entryRouter,
    }));
    expect(dependencies.client.simulate).toHaveBeenCalledOnce();
    expect(dependencies.client.simulate).toHaveBeenCalledWith(quote.execution);
    expect(quote.gasEstimate).toBe("500000");
    expect(quote.minimumReceivedRaw).toBeLessThanOrEqual(quote.expectedOutputRaw!);
  });

  it.each([false, true])("supports V3 split routes within each constituent (burn=%s)", async (burn) => {
    const dependencies = deps(client(), provider(true));
    const req = request(burn);
    const result = await quoteMainnetBasket(req, dependencies);
    expect(result.status).toBe(200);
    const execution = parse(result.body, req).execution as BasketRouterExecution;
    const legs = execution.call.method === "mintFromToken" ? execution.call.args[1] : execution.call.args[2];
    expect(legs).toHaveLength(4);
    if (burn) {
      expect(legs![0]).toMatchObject({ tokenIn: A, amountIn: req.inputAmountRaw / 4n });
      expect(legs![1]).toMatchObject({ tokenIn: A, amountIn: maxUint256 });
      expect(legs![2]).toMatchObject({ tokenIn: B, amountIn: req.inputAmountRaw / 4n });
      expect(legs![3]).toMatchObject({ tokenIn: B, amountIn: maxUint256 });
    }
  });

  it.each([false, true])("keeps native wrap/unwrap in the basket router (burn=%s)", async (burn) => {
    const req = request(burn);
    if (burn) req.output = token(DEPLOYMENT.weth, "native"); else req.input = token(DEPLOYMENT.weth, "native");
    const result = await quoteMainnetBasket(req, deps());
    expect(result.status).toBe(200);
    const execution = parse(result.body, req).execution as BasketRouterExecution;
    expect(execution.call.method).toBe(burn ? "redeemToNative" : "mintFromNative");
    expect(execution.nativeValue).toBe(burn ? 0n : req.inputAmountRaw);
    const calls = basketSimulationCalls(execution);
    expect(calls).toHaveLength(burn ? 3 : 1);
    const call = calls[calls.length - 1]!;
    expect(call.value).toBe(execution.nativeValue);
    expect(decodeFunctionData({ abi: otfEntryExitRouterAbi, data: call.data }).functionName).toBe(execution.call.method);
  });

  it.each([false, true])("retains a constituent matching the settlement token (burn=%s)", async (burn) => {
    const routingClient = client({ vaultAssets: vi.fn(async () => [INPUT, B]) });
    const dependencies = deps(routingClient);
    const req = request(burn);
    const result = await quoteMainnetBasket(req, dependencies);
    expect(result.status).toBe(200);
    expect(parse(result.body, req).hops).toHaveLength(1);
    for (const [body] of dependencies.requestQuote.mock.calls) expect(body.tokenIn).not.toBe(body.tokenOut);
  });

  it("uses the owner preview, reports simulated refunds, and includes approval reset in preflight", async () => {
    const dependencies = deps(client({ simulate: vi.fn(async () => ({ amountOut: 2n * 10n ** 18n, refunds: [{ token: B, amount: 7n }], gasUsed: 123n })) }));
    const req = request(true);
    const result = await quoteMainnetBasket(req, dependencies);
    expect(result.status).toBe(200);
    expect(dependencies.client.previewRedeem).toHaveBeenCalledWith(VAULT, req.inputAmountRaw, CALLER, 0n);
    expect(parse(result.body, req).residualRefunds).toEqual([{ token: B, amount: 7n, displayAmount: "0.000000000000000007" }]);
    const execution = parse(result.body, req).execution as BasketRouterExecution;
    expect(basketSimulationCalls(execution).map((call) => call.to)).toEqual([VAULT, VAULT, DEPLOYMENT.entryRouter]);
  });

  it.each(["bindings", "vault", "decimals", "pool", "simulation", "insufficient output", "preview"])("fails closed on %s failures", async (failure) => {
    const fail = async () => { throw new Error("Private RPC detail"); };
    const routingClient = client({
      ...(failure === "bindings" ? { verifyBindings: fail } : {}),
      ...(failure === "vault" ? { isVault: async () => false } : {}),
      ...(failure === "decimals" ? { decimals: async () => 6 } : {}),
      ...(failure === "pool" ? { authenticatePool: fail } : {}),
      ...(failure === "simulation" ? { simulate: fail } : {}),
      ...(failure === "insufficient output" ? { simulate: async () => ({ amountOut: 1n, refunds: [], gasUsed: 1n }) } : {}),
      ...(failure === "preview" ? { previewRedeem: async () => [1n] } : {}),
    });
    const result = await quoteMainnetBasket(request(true), deps(routingClient));
    const codes: Record<string, string> = { bindings: "DEPLOYMENT_MISMATCH", vault: "INVALID_ASSET_METADATA", decimals: "INVALID_ASSET_METADATA", pool: "POOL_VALIDATION_FAILED", simulation: "SIMULATION_FAILED", "insufficient output": "MINIMUM_OUTPUT_NOT_MET", preview: "QUOTE_FAILED" };
    expect(result).toMatchObject({ status: 503, body: { state: "unavailable", code: codes[failure], requestId: expect.any(String) } });
    expect(JSON.stringify(result)).not.toContain("Private RPC detail");
    expect(parse(result.body, request(true)).failureCode).toBe(codes[failure]);
  });

  it("does not renew a quote that expired during routing or simulation", async () => {
    const clock = vi.fn().mockReturnValueOnce(NOW).mockReturnValue(NOW + 46_000);
    expect((await quoteMainnetBasket(request(true), { ...deps(), now: clock })).status).toBe(503);
  });

  it("wires mainnet baskets into the same-origin API without using wallet swap calldata", async () => {
    const req = request(true), dependencies = deps();
    const providerRequest = vi.fn(async (path: string, body: Record<string, unknown>) => {
      expect(path).toBe("quote");
      return dependencies.requestQuote(body);
    });
    const result = await handleSwapQuoteRequest({ action: "quote", ...req, inputAmountRaw: req.inputAmountRaw.toString() }, {
      apiKey: "test", now: dependencies.now, mainnetClient: dependencies.client, mainnetDeployment: DEPLOYMENT, providerRequest,
    });
    expect(result.status).toBe(200);
    expect(providerRequest).toHaveBeenCalledTimes(2);
  });

  it("keeps unconfigured mainnet and unsupported networks unavailable", async () => {
    const requestQuote = provider();
    expect((await quoteMainnetBasket(request(), { requestQuote })).body).toMatchObject({ code: "ROUTE_NOT_CONFIGURED" });
    expect((await quoteMainnetBasket({ ...request(), chainId: 1 }, { ...deps(), requestQuote })).status).toBe(503);
    expect(requestQuote).not.toHaveBeenCalled();
  });
});
