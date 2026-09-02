import { readFileSync } from "node:fs";
import { encodeFunctionData, getAddress } from "viem";
import { describe, expect, it, vi } from "vitest";
import { ERC20_APPROVE_ABI } from "./swap-model";
import { robinhoodMainnetAddresses } from "./deployment";
import { handleSwapQuoteRequest } from "./uniswap-trading-api";

const INPUT = "0x0000000000000000000000000000000000000001" as const;
const OUTPUT = "0x0000000000000000000000000000000000000002" as const;
const CALLER = "0x0000000000000000000000000000000000000003" as const;
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as const;
const UNIVERSAL_ROUTER = "0x8876789976decbfcbbbe364623c63652db8c0904" as const;
const NOW = 1_750_000_000_000;
const AMOUNT = 10n * 10n ** 18n;
const NATIVE = "0x0000000000000000000000000000000000000000" as const;

function request(overrides: Record<string, unknown> = {}) {
  return {
    action: "quote",
    route: "direct",
    chainId: 4663,
    caller: CALLER,
    input: { address: INPUT, decimals: 18, kind: "erc20", isFactoryVault: false, isProtocolToken: false },
    output: { address: OUTPUT, decimals: 18, kind: "otf", isFactoryVault: true, isProtocolToken: false },
    inputAmountRaw: AMOUNT.toString(),
    slippageBps: 50,
    requestedAtMs: NOW - 1_000,
    ...overrides,
  };
}

function approval() {
  return {
    to: INPUT,
    data: encodeFunctionData({ abi: ERC20_APPROVE_ABI, functionName: "approve", args: [PERMIT2, AMOUNT] }),
    value: "0",
  };
}

function provider(overrides: Record<string, unknown> = {}) {
  return vi.fn(async (path: string, body: Record<string, unknown> = {}) => {
    void body;
    if (path === "check_approval") return { approval: approval() };
    if (path === "quote") {
      return {
        routing: "CLASSIC",
        quote: {
          input: { token: INPUT, amount: AMOUNT.toString(), chainId: 4663 },
          output: { token: OUTPUT, amount: "9500000000000000000", chainId: 4663 },
          amountOutMinimum: "9452500000000000000",
          swapper: CALLER,
          deadline: String(Math.floor((NOW + 20_000) / 1_000)),
          ...overrides,
        },
      };
    }
    return { swap: { to: UNIVERSAL_ROUTER, from: CALLER, data: "0x1234", value: "0", chainId: 4663 } };
  });
}

describe("same-origin Uniswap quote API", () => {
  it("requests exact-input BEST_PRICE V3/V4 CLASSIC quotes and returns validated targets", async () => {
    const requestProvider = provider();
    const result = await handleSwapQuoteRequest(request(), { apiKey: "test-key", now: () => NOW, providerRequest: requestProvider });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ state: "available", route: "direct", routeLabel: "Direct pool" });
    const quoteCall = requestProvider.mock.calls.find(([path]) => path === "quote");
    expect(quoteCall?.[1]).toMatchObject({
      type: "EXACT_INPUT",
      routingPreference: "BEST_PRICE",
      protocols: ["V3", "V4"],
      tokenInChainId: 4663,
      tokenOutChainId: 4663,
      swapper: CALLER,
    });
    const execution = (result.body as Record<string, unknown>).execution as Record<string, unknown>;
    expect(execution.universalRouter).toBe(getAddress(UNIVERSAL_ROUTER));
    expect((execution.approval as Record<string, unknown>).to).toBe(INPUT);
  });

  it("uses the provider native identity, skips approvals, and seals the exact transaction value", async () => {
    const weth = robinhoodMainnetAddresses.weth!;
    const requestProvider = vi.fn(async (path: string, body: Record<string, unknown> = {}) => {
      if (path === "check_approval") throw new Error("native input must not request approval");
      if (path === "quote") return { routing: "CLASSIC", quote: {
        input: { token: NATIVE, amount: AMOUNT.toString(), chainId: 4663 },
        output: { token: OUTPUT, amount: "9500000000000000000", chainId: 4663 },
        amountOutMinimum: "9452500000000000000", swapper: CALLER,
        deadline: String(Math.floor((NOW + 20_000) / 1_000)),
      } };
      void body;
      return { swap: { to: UNIVERSAL_ROUTER, from: CALLER, data: "0x1234", value: AMOUNT.toString(), chainId: 4663 } };
    });
    const nativeRequest = request({ input: { address: weth, decimals: 18, kind: "native", isFactoryVault: false, isProtocolToken: false } });
    const quoted = await handleSwapQuoteRequest(nativeRequest, { apiKey: "test-key", now: () => NOW, providerRequest: requestProvider });
    expect(quoted.status).toBe(200);
    const quoteCall = requestProvider.mock.calls.find(([path]) => path === "quote");
    expect(quoteCall?.[1]).toMatchObject({ tokenIn: NATIVE });
    expect(requestProvider.mock.calls.some(([path]) => path === "check_approval")).toBe(false);
    const execution = (quoted.body as Record<string, unknown>).execution as Record<string, unknown>;
    expect(execution).toMatchObject({ nativeInput: true, nativeOutput: false, nativeValue: AMOUNT.toString() });
    expect(execution.approval).toBeUndefined();
    expect(execution.permitData).toBeUndefined();
    const plan = Object.fromEntries(Object.entries(execution).filter(([key]) => [
      "kind", "chainId", "caller", "inputToken", "outputToken", "universalRouter", "amountIn", "minAmountOut", "expiresAtMs", "quoteToken", "nativeInput", "nativeOutput", "nativeValue",
    ].includes(key)));
    const finalized = await handleSwapQuoteRequest({ action: "finalize-direct", plan }, { apiKey: "test-key", now: () => NOW, providerRequest: requestProvider });
    expect(finalized.status).toBe(200);
    expect(((finalized.body as Record<string, unknown>).execution as Record<string, unknown>).transaction).toMatchObject({ value: AMOUNT.toString() });
    expect((await handleSwapQuoteRequest({ action: "finalize-direct", plan: { ...plan, nativeValue: "0" } }, { apiKey: "test-key", now: () => NOW, providerRequest: requestProvider })).status).toBe(400);
  });

  it("keeps native output explicit and rejects a forged native input identity", async () => {
    const weth = robinhoodMainnetAddresses.weth!;
    const outputProvider = vi.fn(async (path: string) => path === "check_approval"
      ? { approval: approval() }
      : path === "quote" ? { routing: "CLASSIC", quote: {
          input: { token: INPUT, amount: AMOUNT.toString(), chainId: 4663 },
          output: { token: NATIVE, amount: "9500000000000000000", chainId: 4663 },
          amountOutMinimum: "9452500000000000000", swapper: CALLER,
          deadline: String(Math.floor((NOW + 20_000) / 1_000)),
        } }
        : { swap: { to: UNIVERSAL_ROUTER, from: CALLER, data: "0x1234", value: "0", chainId: 4663 } });
    const result = await handleSwapQuoteRequest(request({
      input: { address: INPUT, decimals: 18, kind: "otf", isFactoryVault: true, isProtocolToken: false },
      output: { address: weth, decimals: 18, kind: "native", isFactoryVault: false, isProtocolToken: false },
    }), { apiKey: "test-key", now: () => NOW, providerRequest: outputProvider });
    expect(result.status).toBe(200);
    expect(((result.body as Record<string, unknown>).execution as Record<string, unknown>)).toMatchObject({ nativeOutput: true, nativeValue: "0" });
    const forged = await handleSwapQuoteRequest(request({ input: { address: INPUT, decimals: 18, kind: "native", isFactoryVault: false, isProtocolToken: false } }), { apiKey: "test-key", now: () => NOW, providerRequest: outputProvider });
    expect(forged.status).toBe(400);
  });

  it("returns truthful unavailable states without a key or supported deployment", async () => {
    expect((await handleSwapQuoteRequest(request(), { now: () => NOW })).body).toMatchObject({ state: "unavailable", route: "direct" });
    expect((await handleSwapQuoteRequest(request({ chainId: 46630 }), { apiKey: "test-key", now: () => NOW, providerRequest: provider() })).body).toMatchObject({ state: "unavailable" });
    expect((await handleSwapQuoteRequest(request({ route: "basket", chainId: 46630 }), { apiKey: "test-key", now: () => NOW, providerRequest: provider() })).body).toMatchObject({ state: "unavailable", route: "basket" });
  });

  it("does not contact Uniswap for token-to-token swaps", async () => {
    const requestProvider = provider();
    const result = await handleSwapQuoteRequest(request({
      output: { address: OUTPUT, decimals: 18, kind: "erc20", isFactoryVault: false, isProtocolToken: false },
    }), { apiKey: "test-key", now: () => NOW, providerRequest: requestProvider });
    expect(result.body).toMatchObject({ state: "unavailable", reason: "Swap is only available for OTF assets." });
    expect(requestProvider).not.toHaveBeenCalled();
  });

  it("normalizes provider failures without exposing provider details", async () => {
    const result = await handleSwapQuoteRequest(request(), {
      apiKey: "test-key",
      now: () => NOW,
      providerRequest: async () => { throw new Error("private upstream detail"); },
    });
    expect(result).toEqual({ status: 503, body: { state: "unavailable", route: "direct", reason: "The Uniswap direct-pool quote is temporarily unavailable." } });
  });

  it.each([
    ["chain", { chainId: 1 }],
    ["caller", { swapper: INPUT }],
    ["recipient", { recipient: INPUT }],
    ["input token", { input: { token: OUTPUT, amount: AMOUNT.toString(), chainId: 4663 } }],
    ["input amount", { input: { token: INPUT, amount: "1", chainId: 4663 } }],
    ["deadline", { deadline: String(Math.floor((NOW + 600_000) / 1_000)) }],
  ])("rejects a provider quote with the wrong %s", async (_label, override) => {
    const body = _label === "chain" ? request(override) : request();
    const result = await handleSwapQuoteRequest(body, { apiKey: "test-key", now: () => NOW, providerRequest: provider(_label === "chain" ? {} : override) });
    expect(result.status).toBe(503);
  });

  it("rejects an approval with the wrong Permit2 target", async () => {
    const requestProvider = provider();
    requestProvider.mockImplementationOnce(async () => ({
      approval: {
        ...approval(),
        data: encodeFunctionData({ abi: ERC20_APPROVE_ABI, functionName: "approve", args: [OUTPUT, AMOUNT] }),
      },
    }));
    const result = await handleSwapQuoteRequest(request(), { apiKey: "test-key", now: () => NOW, providerRequest: requestProvider });
    expect(result.status).toBe(503);
  });

  it("finalizes only a sealed unchanged plan and validates the Universal Router transaction", async () => {
    const requestProvider = provider();
    const quoted = await handleSwapQuoteRequest(request(), { apiKey: "test-key", now: () => NOW, providerRequest: requestProvider });
    const execution = (quoted.body as Record<string, unknown>).execution as Record<string, unknown>;
    const plan = Object.fromEntries(Object.entries(execution).filter(([key]) => [
      "kind", "chainId", "caller", "inputToken", "outputToken", "universalRouter", "amountIn", "minAmountOut", "expiresAtMs", "quoteToken", "nativeInput", "nativeOutput", "nativeValue",
    ].includes(key)));
    const finalized = await handleSwapQuoteRequest({ action: "finalize-direct", plan }, { apiKey: "test-key", now: () => NOW, providerRequest: requestProvider });
    expect(finalized.status).toBe(200);
    expect(((finalized.body as Record<string, unknown>).execution as Record<string, unknown>).transaction).toMatchObject({ to: getAddress(UNIVERSAL_ROUTER), from: CALLER, value: "0" });
    const tampered = await handleSwapQuoteRequest({ action: "finalize-direct", plan: { ...plan, minAmountOut: "1" } }, { apiKey: "test-key", now: () => NOW, providerRequest: requestProvider });
    expect(tampered.status).toBe(400);
  });

  it("rejects a provider transaction with the wrong final target", async () => {
    const requestProvider = provider();
    const quoted = await handleSwapQuoteRequest(request(), { apiKey: "test-key", now: () => NOW, providerRequest: requestProvider });
    const execution = (quoted.body as Record<string, unknown>).execution as Record<string, unknown>;
    const plan = Object.fromEntries(Object.entries(execution).filter(([key]) => [
      "kind", "chainId", "caller", "inputToken", "outputToken", "universalRouter", "amountIn", "minAmountOut", "expiresAtMs", "quoteToken", "nativeInput", "nativeOutput", "nativeValue",
    ].includes(key)));
    const badSwapProvider = async (
      path: "check_approval" | "quote" | "swap",
      body: Record<string, unknown>,
    ): Promise<unknown> => path === "swap"
      ? { swap: { to: OUTPUT, from: CALLER, data: "0x1234", value: "0", chainId: 4663 } }
      : requestProvider(path, body);
    const result = await handleSwapQuoteRequest({ action: "finalize-direct", plan }, { apiKey: "test-key", now: () => NOW, providerRequest: badSwapProvider });
    expect(result.status).toBe(400);
  });

  it("rejects malformed browser input before contacting Uniswap", async () => {
    const requestProvider = provider();
    const result = await handleSwapQuoteRequest(request({ caller: "not-an-address" }), { apiKey: "test-key", now: () => NOW, providerRequest: requestProvider });
    expect(result.status).toBe(400);
    expect(requestProvider).not.toHaveBeenCalled();
  });

  it("keeps UNISWAP_API_KEY out of client-imported modules", () => {
    expect(readFileSync(new URL("./swap-model.ts", import.meta.url), "utf8")).not.toContain("UNISWAP_API_KEY");
    expect(readFileSync(new URL("../components/OperateExperience.tsx", import.meta.url), "utf8")).not.toContain("UNISWAP_API_KEY");
    expect(readFileSync(new URL("./uniswap-trading-api.ts", import.meta.url), "utf8")).toContain("process.env.UNISWAP_API_KEY");
  });
});
