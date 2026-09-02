import { createHmac, timingSafeEqual } from "node:crypto";
import { decodeFunctionData, encodeFunctionData, getAddress, isAddress, type Address, type Hex } from "viem";
import { robinhoodMainnetAddresses, robinhoodMainnetUniswap, robinhoodTestnetAddresses, robinhoodTestnetDeploymentReady } from "./deployment";
import { ERC20_APPROVE_ABI, swapIncludesOtf } from "./swap-model";
import { quoteTestnetSwap, type TestnetRoutingClient } from "./testnet-synthra-api";

const UNISWAP_API_BASE = "https://trade-api.gateway.uniswap.org/v1";
const QUOTE_LIFETIME_MS = 20_000;
const MAX_QUOTE_LIFETIME_MS = 300_000;

type ObjectRecord = Record<string, unknown>;
type ProviderRequest = (path: "check_approval" | "quote" | "swap", body: ObjectRecord, apiKey: string) => Promise<unknown>;

export type SwapQuoteApiDependencies = {
  apiKey?: string;
  now?: () => number;
  providerRequest?: ProviderRequest;
  testnetClient?: TestnetRoutingClient;
};

type ValidatedAsset = {
  address: Address;
  decimals: number;
  kind: "native" | "erc20" | "otf";
  isFactoryVault: boolean;
  isProtocolToken: boolean;
};

type ValidatedQuoteRequest = {
  route: "direct" | "basket";
  chainId: number;
  caller: Address;
  input: ValidatedAsset;
  output: ValidatedAsset;
  inputAmountRaw: bigint;
  slippageBps: number;
  requestedAtMs: number;
};

type DirectQuotePayload = {
  chainId: number;
  caller: Address;
  inputToken: Address;
  outputToken: Address;
  amountIn: string;
  minAmountOut: string;
  expectedAmountOut: string;
  expiresAtMs: number;
  providerQuote: unknown;
  permitData?: unknown;
  approvalRequired: boolean;
  nativeInput: boolean;
  nativeOutput: boolean;
  nativeValue: string;
};

const UNISWAP_NATIVE_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

function record(value: unknown, label: string): ObjectRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as ObjectRecord;
}

function exactKeys(value: ObjectRecord, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${label} contains an unsupported field: ${key}.`);
  }
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  return value;
}

function address(value: unknown, label: string): Address {
  const candidate = string(value, label);
  if (!isAddress(candidate)) throw new Error(`${label} must be an address.`);
  return getAddress(candidate);
}

function integer(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer.`);
  return value;
}

function uint(value: unknown, label: string, allowZero = true): bigint {
  const candidate = string(value, label);
  if (!/^(?:0|[1-9]\d*)$/.test(candidate)) throw new Error(`${label} must be an unsigned integer string.`);
  const parsed = BigInt(candidate);
  if (!allowZero && parsed === 0n) throw new Error(`${label} must be greater than zero.`);
  return parsed;
}

function sameAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function valueAt(value: unknown, paths: readonly string[]): unknown {
  for (const path of paths) {
    let current = value;
    let found = true;
    for (const part of path.split(".")) {
      if (current === null || typeof current !== "object" || Array.isArray(current) || !(part in current)) {
        found = false;
        break;
      }
      current = (current as ObjectRecord)[part];
    }
    if (found && current !== undefined) return current;
  }
  return undefined;
}

function validateAsset(value: unknown, label: string): ValidatedAsset {
  const asset = record(value, label);
  exactKeys(asset, ["address", "decimals", "kind", "isFactoryVault", "isProtocolToken"], label);
  const kind = string(asset.kind, `${label}.kind`);
  if (kind !== "native" && kind !== "erc20" && kind !== "otf") throw new Error(`${label}.kind is unsupported.`);
  const decimals = integer(asset.decimals, `${label}.decimals`);
  if (decimals < 0 || decimals > 36) throw new Error(`${label}.decimals is out of range.`);
  const isFactoryVault = asset.isFactoryVault === true;
  const isProtocolToken = asset.isProtocolToken === true;
  if (kind === "otf" && !isFactoryVault) throw new Error(`${label} is not a factory-confirmed OTF.`);
  if (kind === "otf" && isProtocolToken) throw new Error(`${label} cannot be both an OTF share and the protocol token.`);
  if (kind === "native" && (isFactoryVault || isProtocolToken)) throw new Error(`${label} has forged native metadata.`);
  return { address: address(asset.address, `${label}.address`), decimals, kind, isFactoryVault, isProtocolToken };
}

function validateProtocolToken(asset: ValidatedAsset, chainId: number, label: string): ValidatedAsset {
  if (asset.kind === "native") {
    const weth = chainId === 46630 ? robinhoodTestnetAddresses.weth : chainId === 4663 ? robinhoodMainnetAddresses.weth : undefined;
    if (!weth || !sameAddress(asset.address, weth)) throw new Error(`${label} is not canonical native ETH.`);
  }
  if (!asset.isProtocolToken) return asset;
  const configured = chainId === 46630
    ? robinhoodTestnetAddresses.otfToken
    : chainId === 4663
      ? robinhoodMainnetAddresses.otfToken
      : undefined;
  if (!configured || !sameAddress(asset.address, configured)) throw new Error(`${label} is not the configured OTF token.`);
  return asset;
}

function validateQuoteRequest(value: unknown, now: number): ValidatedQuoteRequest {
  const body = record(value, "request");
  exactKeys(body, ["action", "route", "chainId", "caller", "input", "output", "inputAmountRaw", "slippageBps", "requestedAtMs"], "request");
  if (body.action !== "quote") throw new Error("Request action is unsupported.");
  const route = string(body.route, "route");
  if (route !== "direct" && route !== "basket") throw new Error("Quote route is unsupported.");
  const chainId = integer(body.chainId, "chainId");
  const input = validateProtocolToken(validateAsset(body.input, "input"), chainId, "input");
  const output = validateProtocolToken(validateAsset(body.output, "output"), chainId, "output");
  if (input.kind === output.kind && sameAddress(input.address, output.address)) throw new Error("Input and output tokens must differ.");
  const requestedAtMs = integer(body.requestedAtMs, "requestedAtMs");
  if (requestedAtMs > now + 1_000 || now - requestedAtMs > MAX_QUOTE_LIFETIME_MS) throw new Error("Quote request timestamp is invalid.");
  const slippageBps = integer(body.slippageBps, "slippageBps");
  if (slippageBps < 1 || slippageBps > 3_000) throw new Error("Slippage is out of range.");
  return {
    route,
    chainId,
    caller: address(body.caller, "caller"),
    input,
    output,
    inputAmountRaw: uint(body.inputAmountRaw, "inputAmountRaw", false),
    slippageBps,
    requestedAtMs,
  };
}

async function defaultProviderRequest(path: "check_approval" | "quote" | "swap", body: ObjectRecord, apiKey: string): Promise<unknown> {
  const response = await fetch(`${UNISWAP_API_BASE}/${path}`, {
    method: "POST",
    cache: "no-store",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`UNISWAP_${path.toUpperCase()}_${response.status}`);
  return response.json();
}

function canonicalApproval(caller: Address, token: Address, spender: Address, amount: bigint, chainId: number) {
  return {
    chainId,
    from: caller,
    to: token,
    data: encodeFunctionData({ abi: ERC20_APPROVE_ABI, functionName: "approve", args: [spender, amount] }),
    value: "0",
  };
}

function validateProviderApproval(value: unknown, inputToken: Address, permit2: Address, amountIn: bigint): boolean {
  if (value === undefined || value === null) return false;
  const approval = record(value, "Uniswap approval");
  const target = address(approval.to, "Uniswap approval.to");
  if (!sameAddress(target, inputToken)) throw new Error("Uniswap approval has the wrong token target.");
  const data = string(approval.data, "Uniswap approval.data") as Hex;
  const decoded = decodeFunctionData({ abi: ERC20_APPROVE_ABI, data });
  if (decoded.functionName !== "approve") throw new Error("Uniswap approval has unsupported calldata.");
  const [spender, amount] = decoded.args;
  if (!sameAddress(getAddress(spender), permit2) || amount < amountIn) throw new Error("Uniswap approval has the wrong spender or insufficient amount.");
  const nativeValue = approval.value === undefined ? 0n : uint(String(approval.value), "Uniswap approval.value");
  if (nativeValue !== 0n) throw new Error("Uniswap approval requests native value.");
  return true;
}

function providerAddress(value: unknown): Address | undefined {
  if (typeof value === "string" && isAddress(value)) return getAddress(value);
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const candidate = (value as ObjectRecord).address;
    if (typeof candidate === "string" && isAddress(candidate)) return getAddress(candidate);
  }
  return undefined;
}

function assertOptionalAddress(value: unknown, expected: Address, label: string): void {
  if (value === undefined) return;
  const parsed = providerAddress(value);
  if (!parsed || !sameAddress(parsed, expected)) throw new Error(`Uniswap quote has the wrong ${label}.`);
}

function assertOptionalInteger(value: unknown, expected: number, label: string): void {
  if (value === undefined) return;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed !== expected) throw new Error(`Uniswap quote has the wrong ${label}.`);
}

function providerToken(asset: ValidatedAsset): Address {
  return asset.kind === "native" ? UNISWAP_NATIVE_ADDRESS : asset.address;
}

function quoteSemantics(response: unknown, request: ValidatedQuoteRequest, now: number): {
  providerQuote: unknown;
  expectedAmountOut: bigint;
  minAmountOut: bigint;
  expiresAtMs: number;
  permitData?: unknown;
} {
  const root = record(response, "Uniswap quote response");
  const providerQuote = root.quote ?? root;
  const routing = valueAt(root, ["routing", "quote.routing"]);
  if (routing !== "CLASSIC") throw new Error("Uniswap quote is not a CLASSIC route.");
  assertOptionalAddress(valueAt(providerQuote, ["input.token", "inputToken", "tokenIn"]), providerToken(request.input), "input token");
  assertOptionalAddress(valueAt(providerQuote, ["output.token", "outputToken", "tokenOut"]), providerToken(request.output), "output token");
  assertOptionalAddress(valueAt(providerQuote, ["swapper"]), request.caller, "swapper");
  assertOptionalAddress(valueAt(providerQuote, ["recipient"]), request.caller, "recipient");
  assertOptionalAddress(valueAt(providerQuote, ["quoteRecipient"]), request.caller, "quote recipient");
  assertOptionalInteger(valueAt(providerQuote, ["tokenInChainId", "input.chainId", "chainId"]), request.chainId, "input chain");
  assertOptionalInteger(valueAt(providerQuote, ["tokenOutChainId", "output.chainId"]), request.chainId, "output chain");
  const returnedAmountIn = valueAt(providerQuote, ["input.amount", "amountIn", "inputAmount"]);
  if (returnedAmountIn !== undefined && uint(String(returnedAmountIn), "Uniswap quote input amount", false) !== request.inputAmountRaw) throw new Error("Uniswap quote has the wrong exact input amount.");
  const amountOutValue = valueAt(providerQuote, ["output.amount", "amountOut", "outputAmount"]);
  const expectedAmountOut = uint(String(amountOutValue), "Uniswap quote output amount", false);
  const floorMinimum = expectedAmountOut * BigInt(10_000 - request.slippageBps) / 10_000n;
  const providerMinimumValue = valueAt(providerQuote, ["amountOutMinimum", "minimumAmountOut", "output.minimumAmount"]);
  const minAmountOut = providerMinimumValue === undefined
    ? floorMinimum
    : uint(String(providerMinimumValue), "Uniswap quote minimum output", false);
  if (minAmountOut > expectedAmountOut || minAmountOut < floorMinimum) throw new Error("Uniswap quote minimum output violates the requested slippage.");
  const deadlineValue = valueAt(providerQuote, ["deadline", "expiresAt"]);
  const expiresAtMs = deadlineValue === undefined ? now + QUOTE_LIFETIME_MS : Number(deadlineValue) * 1_000;
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= now || expiresAtMs > now + MAX_QUOTE_LIFETIME_MS) throw new Error("Uniswap quote expiry is invalid.");
  return { providerQuote, expectedAmountOut, minAmountOut, expiresAtMs, permitData: root.permitData ?? undefined };
}

function validatePermitData(value: unknown, request: ValidatedQuoteRequest, permit2: Address, universalRouter: Address): void {
  if (request.input.kind === "native" && value !== undefined && value !== null) throw new Error("Native input returned unexpected Permit2 data.");
  if (value === undefined || value === null) return;
  const permit = record(value, "Uniswap Permit2 data");
  const domain = record(permit.domain, "Uniswap Permit2 domain");
  const message = record(permit.message, "Uniswap Permit2 message");
  const details = record(message.details, "Uniswap Permit2 details");
  if (integer(Number(domain.chainId), "Uniswap Permit2 chain") !== request.chainId) throw new Error("Uniswap Permit2 data has the wrong chain.");
  if (!sameAddress(address(domain.verifyingContract, "Uniswap Permit2 verifying contract"), permit2)) throw new Error("Uniswap Permit2 data has the wrong verifying contract.");
  if (!sameAddress(address(details.token, "Uniswap Permit2 token"), request.input.address)) throw new Error("Uniswap Permit2 data has the wrong token.");
  if (uint(String(details.amount), "Uniswap Permit2 amount", false) < request.inputAmountRaw) throw new Error("Uniswap Permit2 amount is insufficient.");
  if (!sameAddress(address(message.spender, "Uniswap Permit2 spender"), universalRouter)) throw new Error("Uniswap Permit2 data has the wrong spender.");
}

function sealQuote(payload: DirectQuotePayload, apiKey: string): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", apiKey).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function openQuote(token: string, apiKey: string): DirectQuotePayload {
  const [encoded, receivedSignature, extra] = token.split(".");
  if (!encoded || !receivedSignature || extra !== undefined) throw new Error("Quote token is malformed.");
  const expectedSignature = createHmac("sha256", apiKey).update(encoded).digest();
  const received = Buffer.from(receivedSignature, "base64url");
  if (received.length !== expectedSignature.length || !timingSafeEqual(received, expectedSignature)) throw new Error("Quote token signature is invalid.");
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as DirectQuotePayload;
}

function executionJson(payload: DirectQuotePayload, quoteToken: string, permit2: Address, universalRouter: Address, transaction?: ObjectRecord) {
  return {
    kind: "direct-api",
    chainId: payload.chainId,
    caller: payload.caller,
    inputToken: payload.inputToken,
    outputToken: payload.outputToken,
    universalRouter,
    amountIn: payload.amountIn,
    minAmountOut: payload.minAmountOut,
    expiresAtMs: payload.expiresAtMs,
    quoteToken,
    nativeInput: payload.nativeInput,
    nativeOutput: payload.nativeOutput,
    nativeValue: payload.nativeValue,
    approval: payload.approvalRequired
      ? canonicalApproval(payload.caller, payload.inputToken, permit2, BigInt(payload.amountIn), payload.chainId)
      : undefined,
    cancel: payload.approvalRequired
      ? canonicalApproval(payload.caller, payload.inputToken, permit2, 0n, payload.chainId)
      : undefined,
    permitData: payload.permitData,
    transaction,
  };
}

function unavailable(route: "direct" | "basket", reason: string, status = 503) {
  return { status, body: { state: "unavailable", route, reason } };
}

async function directQuote(request: ValidatedQuoteRequest, dependencies: Required<Pick<SwapQuoteApiDependencies, "apiKey" | "now" | "providerRequest">>) {
  if (request.chainId !== 4663 || !robinhoodMainnetUniswap.permit2 || !robinhoodMainnetUniswap.universalRouter) {
    return unavailable("direct", "Uniswap Trading API swaps are unsupported on this network.");
  }
  const permit2 = robinhoodMainnetUniswap.permit2;
  const universalRouter = robinhoodMainnetUniswap.universalRouter;
  try {
    const approvalResponse = request.input.kind === "native"
      ? undefined
      : record(await dependencies.providerRequest("check_approval", {
          amount: request.inputAmountRaw.toString(),
          chainId: request.chainId,
          token: request.input.address,
          walletAddress: request.caller,
        }, dependencies.apiKey), "Uniswap approval response");
    const quoteResponse = await dependencies.providerRequest("quote", {
      type: "EXACT_INPUT",
      amount: request.inputAmountRaw.toString(),
      tokenInChainId: request.chainId,
      tokenOutChainId: request.chainId,
      tokenIn: providerToken(request.input),
      tokenOut: providerToken(request.output),
      swapper: request.caller,
      slippageTolerance: request.slippageBps / 100,
      routingPreference: "BEST_PRICE",
      protocols: ["V3", "V4"],
    }, dependencies.apiKey);
    const semantics = quoteSemantics(quoteResponse, request, dependencies.now());
    validatePermitData(semantics.permitData, request, permit2, universalRouter);
    const approvalRequired = request.input.kind === "native"
      ? false
      : validateProviderApproval(approvalResponse?.approval, request.input.address, permit2, request.inputAmountRaw);
    const payload: DirectQuotePayload = {
      chainId: request.chainId,
      caller: request.caller,
      inputToken: request.input.address,
      outputToken: request.output.address,
      amountIn: request.inputAmountRaw.toString(),
      minAmountOut: semantics.minAmountOut.toString(),
      expectedAmountOut: semantics.expectedAmountOut.toString(),
      expiresAtMs: semantics.expiresAtMs,
      providerQuote: semantics.providerQuote,
      permitData: semantics.permitData,
      approvalRequired,
      nativeInput: request.input.kind === "native",
      nativeOutput: request.output.kind === "native",
      nativeValue: request.input.kind === "native" ? request.inputAmountRaw.toString() : "0",
    };
    const quoteToken = sealQuote(payload, dependencies.apiKey);
    return {
      status: 200,
      body: {
        state: "available",
        id: `uniswap-${request.requestedAtMs}`,
        route: "direct",
        chainId: request.chainId,
        caller: request.caller,
        quotedAtMs: dependencies.now(),
        expiresAtMs: semantics.expiresAtMs,
        inputAmountRaw: request.inputAmountRaw.toString(),
        outputAmount: formatRaw(semantics.expectedAmountOut, request.output.decimals),
        expectedOutput: formatRaw(semantics.expectedAmountOut, request.output.decimals),
        expectedOutputRaw: semantics.expectedAmountOut.toString(),
        minimumReceived: formatRaw(semantics.minAmountOut, request.output.decimals),
        minimumReceivedRaw: semantics.minAmountOut.toString(),
        routeLabel: "Direct pool",
        hops: [],
        execution: executionJson(payload, quoteToken, permit2, universalRouter),
      },
    };
  } catch {
    return unavailable("direct", "The Uniswap direct-pool quote is temporarily unavailable.");
  }
}

function formatRaw(value: bigint, decimals: number): string {
  if (decimals === 0) return value.toString();
  const digits = value.toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, -decimals);
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function validateFinalPlan(value: unknown, payload: DirectQuotePayload, now: number): void {
  const plan = record(value, "plan");
  exactKeys(plan, ["kind", "chainId", "caller", "inputToken", "outputToken", "universalRouter", "amountIn", "minAmountOut", "expiresAtMs", "quoteToken", "nativeInput", "nativeOutput", "nativeValue"], "plan");
  if (
    plan.kind !== "direct-api"
    || integer(plan.chainId, "plan.chainId") !== payload.chainId
    || !sameAddress(address(plan.caller, "plan.caller"), payload.caller)
    || !sameAddress(address(plan.inputToken, "plan.inputToken"), payload.inputToken)
    || !sameAddress(address(plan.outputToken, "plan.outputToken"), payload.outputToken)
    || !sameAddress(address(plan.universalRouter, "plan.universalRouter"), robinhoodMainnetUniswap.universalRouter!)
    || string(plan.amountIn, "plan.amountIn") !== payload.amountIn
    || string(plan.minAmountOut, "plan.minAmountOut") !== payload.minAmountOut
    || integer(plan.expiresAtMs, "plan.expiresAtMs") !== payload.expiresAtMs
    || plan.nativeInput !== payload.nativeInput
    || plan.nativeOutput !== payload.nativeOutput
    || string(plan.nativeValue, "plan.nativeValue") !== payload.nativeValue
  ) throw new Error("Finalization plan does not match its sealed quote.");
  if (payload.expiresAtMs <= now) throw new Error("Finalization quote has expired.");
}

function validateSwapTransaction(value: unknown, payload: DirectQuotePayload, universalRouter: Address): ObjectRecord {
  const transaction = record(value, "Uniswap swap transaction");
  const to = address(transaction.to, "Uniswap swap transaction.to");
  const fromValue = transaction.from === undefined ? payload.caller : address(transaction.from, "Uniswap swap transaction.from");
  if (!sameAddress(to, universalRouter) || !sameAddress(fromValue, payload.caller)) throw new Error("Uniswap swap transaction has the wrong target or sender.");
  const data = string(transaction.data, "Uniswap swap transaction.data");
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(data)) throw new Error("Uniswap swap transaction calldata is invalid.");
  const valueAmount = transaction.value === undefined ? 0n : uint(String(transaction.value), "Uniswap swap transaction.value");
  const expectedValue = payload.nativeInput ? BigInt(payload.amountIn) : 0n;
  if (valueAmount !== expectedValue || payload.nativeOutput && valueAmount !== 0n) throw new Error("Swap transaction has the wrong native value.");
  if (transaction.chainId !== undefined && Number(transaction.chainId) !== payload.chainId) throw new Error("Uniswap swap transaction has the wrong chain.");
  return { chainId: payload.chainId, from: payload.caller, to, data, value: expectedValue.toString() };
}

async function finalizeDirect(value: unknown, dependencies: Required<Pick<SwapQuoteApiDependencies, "apiKey" | "now" | "providerRequest">>) {
  if (!robinhoodMainnetUniswap.permit2 || !robinhoodMainnetUniswap.universalRouter) throw new Error("Uniswap targets are not configured.");
  const body = record(value, "request");
  exactKeys(body, ["action", "plan", "signature"], "request");
  const plan = record(body.plan, "plan");
  const quoteToken = string(plan.quoteToken, "plan.quoteToken");
  const payload = openQuote(quoteToken, dependencies.apiKey);
  validateFinalPlan(plan, payload, dependencies.now());
  const signature = body.signature;
  if (payload.permitData !== undefined) {
    if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error("A valid Permit2 signature is required.");
  } else if (signature !== undefined) {
    throw new Error("A Permit2 signature was supplied for a quote that does not require one.");
  }
  const swapResponse = record(await dependencies.providerRequest("swap", {
    quote: payload.providerQuote,
    ...(signature === undefined ? {} : { signature }),
  }, dependencies.apiKey), "Uniswap swap response");
  const transaction = validateSwapTransaction(swapResponse.swap ?? swapResponse.transaction, payload, robinhoodMainnetUniswap.universalRouter);
  return {
    status: 200,
    body: { execution: executionJson(payload, quoteToken, robinhoodMainnetUniswap.permit2, robinhoodMainnetUniswap.universalRouter, transaction) },
  };
}

export async function handleSwapQuoteRequest(value: unknown, dependencies: SwapQuoteApiDependencies = {}) {
  const now = dependencies.now ?? Date.now;
  const apiKey = dependencies.apiKey ?? process.env.UNISWAP_API_KEY;
  const providerRequest = dependencies.providerRequest ?? defaultProviderRequest;
  try {
    const body = record(value, "request");
    if (body.action === "finalize-direct") {
      if (!apiKey) return { status: 503, body: { error: "UNISWAP_API_UNAVAILABLE" } };
      return await finalizeDirect(body, { apiKey, now, providerRequest });
    }
    const request = validateQuoteRequest(body, now());
    if (!swapIncludesOtf(request.input, request.output)) {
      return unavailable(request.route, "Swap is only available for OTF assets.");
    }
    if (request.chainId === 46630) {
      return quoteTestnetSwap(request, { now, client: dependencies.testnetClient });
    }
    if (request.route === "basket") {
      if (!robinhoodTestnetDeploymentReady || !robinhoodTestnetAddresses.entryRouter || !robinhoodTestnetAddresses.uniswapV3Adapter) {
        return unavailable("basket", "Basket writes require a fresh generic router and approved Uniswap V3 adapter deployment.");
      }
      return unavailable("basket", "The basket route planner is not configured.");
    }
    if (!apiKey) return unavailable("direct", "The Uniswap Trading API key is not configured.");
    return await directQuote(request, { apiKey, now, providerRequest });
  } catch {
    return { status: 400, body: { error: "INVALID_SWAP_QUOTE_REQUEST" } };
  }
}
