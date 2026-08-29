import { getAddress, isAddress, maxUint256, zeroAddress, type Address, type Hex } from "viem";
import {
  robinhoodMainnetAddresses,
  robinhoodMainnetLiquidity,
  robinhoodTestnetAddresses,
  robinhoodTestnetLiquidity,
  robinhoodTestnetQuote,
} from "./deployment";

export type SwapAssetKind = "erc20" | "otf";

export type SwapAsset = {
  address: Address;
  symbol: string;
  name: string;
  kind: SwapAssetKind;
  decimals: number;
  /** True only after token decimals and ordinary display metadata have been resolved. */
  metadataResolved?: boolean;
  /** Informational identity metadata only. It never filters routes. */
  verified?: boolean;
  /** True only when the configured factory directory identifies this address as an OTF vault. */
  isFactoryVault?: boolean;
};

export type SwapDirection = "erc20-to-otf" | "otf-to-erc20" | "otf-to-otf" | "erc20-to-erc20";
export type QuoteRoute = "direct" | "basket";
export type QuoteState = "available" | "unavailable" | "loading" | "stale" | "failed";

export type SwapRouteHop = {
  venue: "Uniswap V3";
  tokenIn: Address;
  tokenOut: Address;
  feeTier: number;
};

export type V3SwapLeg = {
  amountIn: bigint;
  minAmountOut: bigint;
  path: Hex;
  hops: readonly SwapRouteHop[];
};

export type DirectRouterCall = {
  method: "swapDirect";
  args: readonly [
    { tokenIn: Address; tokenOut: Address; amountIn: bigint; minAmountOut: bigint; deadline: bigint },
    readonly V3SwapLeg[],
  ];
};

export type MintRouterCall = {
  method: "mintFromToken";
  args: readonly [
    { inputToken: Address; vault: Address; amountIn: bigint; minShares: bigint; deadline: bigint },
    readonly V3SwapLeg[],
  ];
};

export type RedeemRouterCall = {
  method: "redeemToToken";
  args: readonly [
    { vault: Address; outputToken: Address; shares: bigint; minAmountOut: bigint; deadline: bigint },
    readonly bigint[],
    readonly V3SwapLeg[],
  ];
};

export type BasketToBasketRouterCall = {
  method: "swapBasketToBasket";
  args: readonly [
    { sourceVault: Address; targetVault: Address; sharesIn: bigint; minSharesOut: bigint; deadline: bigint },
    readonly bigint[],
    readonly V3SwapLeg[],
  ];
};

/** The only contract calls a quote response can describe. It has no arbitrary target or calldata field. */
export type TypedRouterCall = DirectRouterCall | MintRouterCall | RedeemRouterCall | BasketToBasketRouterCall;

export type SwapQuote = {
  id: string;
  route: QuoteRoute;
  state: QuoteState;
  queriedAt: number;
  /** The time after which this response must never be used, even if its normal age has not elapsed. */
  expiresAt?: number;
  inputAmount: string;
  outputAmount?: string;
  expectedOutput?: string;
  minimumReceived?: string;
  venueFeeBps?: number;
  priceImpactBps?: number;
  gasEstimate?: string;
  routeLabel: string;
  hops?: readonly SwapRouteHop[];
  reason?: string;
  /** Present only after the response has passed the typed entry-router validation below. */
  execution?: TypedRouterCall;
  router?: Address;
  caller?: Address;
  chainId?: number;
};

export type SwapQuoteRequest = {
  chainId: number;
  input: SwapAsset;
  output: SwapAsset;
  inputAmount: string;
  slippageBps: number;
  requestedAt: number;
  /** OTF settlement pays msg.sender only, so live quotes are bound to the connected wallet. */
  caller?: Address;
};

export type SwapQuoteService = {
  quoteDirect(request: SwapQuoteRequest): Promise<SwapQuote>;
  quoteBasket(request: SwapQuoteRequest): Promise<SwapQuote>;
};

export type SwapExecutionStage = "wallet" | "approval" | "simulation" | "submission" | "success" | "failure";
export type SwapExecutionState = "ready" | "blocked" | "unavailable" | "pending" | "complete" | "failed";

export const MAX_V3_LEGS = 40;
export const MAX_V3_HOPS_PER_LEG = 3;
export const QUOTE_MAX_AGE_MS = 20_000;
export const QUOTE_MAX_FUTURE_DEADLINE_SECONDS = 300;

const FORBIDDEN_RESPONSE_FIELDS = new Set([
  "adapter", "adapterdata", "calldata", "commands", "delegatecall", "recipient", "target", "universalrouter",
]);

export const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export function executionStages(input: {
  walletConnected: boolean;
  networkSupported: boolean;
  usableQuote: boolean;
  deploymentReady?: boolean;
  execution?: "approval" | "simulation" | "submission" | "success" | "failure";
}): Record<SwapExecutionStage, SwapExecutionState> {
  if (!input.walletConnected) {
    return { wallet: "blocked", approval: "blocked", simulation: "blocked", submission: "blocked", success: "unavailable", failure: "unavailable" };
  }
  if (!input.networkSupported || !input.usableQuote || input.deploymentReady === false) {
    return { wallet: "ready", approval: "unavailable", simulation: "unavailable", submission: "unavailable", success: "unavailable", failure: "unavailable" };
  }
  const execution = input.execution;
  return {
    wallet: "ready",
    approval: execution === "approval" ? "pending" : "ready",
    simulation: execution === "simulation" ? "pending" : execution === "approval" ? "blocked" : "ready",
    submission: execution === "submission" ? "pending" : execution === "success" ? "complete" : execution === "failure" ? "failed" : "blocked",
    success: execution === "success" ? "complete" : "unavailable",
    failure: execution === "failure" ? "failed" : "unavailable",
  };
}

export function classifySwapDirection(input: SwapAsset, output: SwapAsset): SwapDirection {
  if (input.kind === "otf" && output.kind === "otf") return "otf-to-otf";
  if (input.kind === "otf") return "otf-to-erc20";
  if (output.kind === "otf") return "erc20-to-otf";
  return "erc20-to-erc20";
}

export function swapDirectionLabel(input: SwapAsset, output: SwapAsset): string {
  const direction = classifySwapDirection(input, output);
  if (direction === "erc20-to-otf") return "ERC-20 → OTF";
  if (direction === "otf-to-erc20") return "OTF → ERC-20";
  if (direction === "otf-to-otf") return "OTF → OTF";
  return "ERC-20 → ERC-20";
}

export function supportedSwapDirection(input: SwapAsset, output: SwapAsset): boolean {
  return classifySwapDirection(input, output) !== "erc20-to-erc20";
}

export function pastedAsset(address: string): SwapAsset | undefined {
  const trimmed = address.trim();
  if (!isAddress(trimmed)) return undefined;
  const normalized = getAddress(trimmed);
  return {
    address: normalized,
    symbol: `${normalized.slice(0, 6)}…${normalized.slice(-4)}`,
    name: "Unresolved address",
    kind: "erc20",
    decimals: 18,
    metadataResolved: false,
    verified: false,
  };
}

/**
 * Prevents decimal assumptions and user-selected OTF labels from crossing the quote boundary.
 * Informational verification is intentionally not part of this decision.
 */
export function assetHasExecutableMetadata(asset: SwapAsset): boolean {
  return asset.address !== zeroAddress
    && asset.metadataResolved === true
    && Number.isInteger(asset.decimals)
    && asset.decimals >= 0
    && asset.decimals <= 36
    && (asset.kind === "erc20" || asset.isFactoryVault === true);
}

export function validSwapPair(input: SwapAsset, output: SwapAsset): boolean {
  return input.address !== zeroAddress
    && output.address !== zeroAddress
    && input.address.toLowerCase() !== output.address.toLowerCase();
}

/** Keeps the amount field representable as an onchain decimal without silently repairing input. */
export function isPositiveDecimalAmount(value: string, decimals = 18): boolean {
  const amount = decimalAmount(value, decimals);
  return amount !== undefined && amount > 0n;
}

export function decimalInputValue(value: string): string | undefined {
  if (value === "" || /^\d*(?:\.\d*)?$/.test(value)) return value;
  return undefined;
}

export async function requestConcurrentQuotes(service: SwapQuoteService, request: SwapQuoteRequest): Promise<SwapQuote[]> {
  if (!assetHasExecutableMetadata(request.input) || !assetHasExecutableMetadata(request.output)) {
    const reason = "Resolve token decimals and OTF factory identity before requesting an executable route.";
    return [unavailableQuote("direct", request, reason), unavailableQuote("basket", request, reason)];
  }
  const [direct, basket] = await Promise.allSettled([service.quoteDirect(request), service.quoteBasket(request)]);
  return [
    direct.status === "fulfilled" ? direct.value : failedQuote("direct", request, "The direct-liquidity quote request failed."),
    basket.status === "fulfilled" ? basket.value : failedQuote("basket", request, "The basket-settlement quote request failed."),
  ];
}

export function quoteIsFresh(quote: SwapQuote, now: number, maxAgeMs = QUOTE_MAX_AGE_MS): boolean {
  return quote.state === "available" && now >= quote.queriedAt && now - quote.queriedAt <= maxAgeMs && (quote.expiresAt === undefined || now < quote.expiresAt);
}

export function decimalAmount(value: string, decimals = 18): bigint | undefined {
  const match = value.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match || match[2]?.length > decimals) return undefined;
  const fractional = (match[2] ?? "").padEnd(decimals, "0");
  const amount = BigInt(match[1]) * 10n ** BigInt(decimals) + BigInt(fractional || "0");
  return amount <= maxUint256 ? amount : undefined;
}

/** Selects only between returned, usable route quotes—not all liquidity in the market. */
export function bestQueriedQuote(quotes: readonly SwapQuote[], now: number): SwapQuote | undefined {
  return quotes
    .filter((quote) => quoteIsFresh(quote, now) && (decimalAmount(quote.outputAmount ?? "") ?? 0n) > 0n)
    .sort((left, right) => {
      const leftAmount = decimalAmount(left.outputAmount ?? "") ?? 0n;
      const rightAmount = decimalAmount(right.outputAmount ?? "") ?? 0n;
      return rightAmount > leftAmount ? 1 : rightAmount < leftAmount ? -1 : 0;
    })[0];
}

export function quoteNeedsRefresh(quote: SwapQuote | undefined, now: number): boolean {
  return !quote || !quoteIsFresh(quote, now);
}

export function unavailableQuote(route: QuoteRoute, request: SwapQuoteRequest, reason: string): SwapQuote {
  return {
    id: `${route}-unavailable-${request.requestedAt}`,
    route,
    state: "unavailable",
    queriedAt: request.requestedAt,
    inputAmount: request.inputAmount,
    routeLabel: route === "direct" ? "Direct liquidity" : "Basket settlement",
    reason,
  };
}

export function failedQuote(route: QuoteRoute, request: SwapQuoteRequest, reason: string): SwapQuote {
  return { ...unavailableQuote(route, request, reason), id: `${route}-failed-${request.requestedAt}`, state: "failed" };
}

/** An explicit unavailable service prevents a UI-only quote from looking executable. */
export const unavailableQuoteService: SwapQuoteService = {
  quoteDirect: async (request) => unavailableQuote("direct", request, "A direct-liquidity quote endpoint is not configured for this network."),
  quoteBasket: async (request) => unavailableQuote("basket", request, "A basket-settlement quote endpoint is not configured for this network."),
};

export type TypedQuoteServiceConfig = { endpoint?: string; chainId: number; entryRouter?: Address; now?: () => number };

/**
 * Builds a narrow network client rather than accepting opaque route calldata.
 * A deployed router and HTTPS endpoint are both required before the UI can ask for executable quotes.
 */
export function typedQuoteService(config: TypedQuoteServiceConfig): SwapQuoteService {
  if (!config.endpoint || !config.entryRouter) return unavailableQuoteService;
  const now = config.now ?? Date.now;
  const requestQuote = async (route: QuoteRoute, request: SwapQuoteRequest): Promise<SwapQuote> => {
    if (!request.caller) return unavailableQuote(route, request, "Connect the wallet that will submit this route before requesting it.");
    const response = await fetch(config.endpoint!, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        route,
        chainId: request.chainId,
        caller: request.caller,
        input: { address: request.input.address, decimals: request.input.decimals },
        output: { address: request.output.address, decimals: request.output.decimals },
        inputAmount: request.inputAmount,
        slippageBps: request.slippageBps,
      }),
    });
    if (!response.ok) throw new Error(`Quote endpoint returned ${response.status}.`);
    return parseTypedQuoteResponse(await response.json(), { route, request, entryRouter: config.entryRouter!, chainId: config.chainId, now: now() });
  };
  return { quoteDirect: (request) => requestQuote("direct", request), quoteBasket: (request) => requestQuote("basket", request) };
}

type TypedQuoteParseContext = { route: QuoteRoute; request: SwapQuoteRequest; entryRouter: Address; chainId: number; now: number };
type ObjectRecord = Record<string, unknown>;

function object(value: unknown, label: string): ObjectRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as ObjectRecord;
}
function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}
function string(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  return value;
}
function number(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer.`);
  return value;
}
function optionalString(value: unknown, label: string): string | undefined { return value === undefined ? undefined : string(value, label); }
function optionalNumber(value: unknown, label: string): number | undefined { return value === undefined ? undefined : number(value, label); }
function address(value: unknown, label: string): Address {
  const candidate = string(value, label);
  if (!isAddress(candidate)) throw new Error(`${label} must be an address.`);
  return getAddress(candidate);
}
function uint(value: unknown, label: string, allowZero = true): bigint {
  const candidate = string(value, label);
  if (!/^(?:0|[1-9]\d*)$/.test(candidate)) throw new Error(`${label} must be an unsigned integer string.`);
  const parsed = BigInt(candidate);
  if (!allowZero && parsed === 0n) throw new Error(`${label} must be greater than zero.`);
  if (parsed > maxUint256) throw new Error(`${label} exceeds uint256.`);
  return parsed;
}
function hex(value: unknown, label: string): Hex {
  const candidate = string(value, label);
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(candidate)) throw new Error(`${label} must be nonempty even-length hex.`);
  return candidate as Hex;
}
function exactKeys(value: ObjectRecord, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${label} contains an unsupported field: ${key}.`);
}
function rejectForbiddenFields(value: unknown): void {
  if (Array.isArray(value)) { value.forEach(rejectForbiddenFields); return; }
  if (value === null || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as ObjectRecord)) {
    if (FORBIDDEN_RESPONSE_FIELDS.has(key.toLowerCase())) throw new Error(`Quote response contains forbidden field: ${key}.`);
    rejectForbiddenFields(nested);
  }
}

/** Decodes the V3 token/fee/token path before any quote becomes selectable. */
export function parseV3Path(path: Hex): readonly SwapRouteHop[] {
  const bytes = path.slice(2);
  const byteLength = bytes.length / 2;
  if (byteLength < 43 || (byteLength - 20) % 23 !== 0) throw new Error("V3 path has an invalid packed length.");
  const hopCount = (byteLength - 20) / 23;
  if (hopCount > MAX_V3_HOPS_PER_LEG) throw new Error("V3 path exceeds the hop limit.");
  let offset = 0;
  let tokenIn = getAddress(`0x${bytes.slice(offset, offset + 40)}`);
  if (tokenIn === zeroAddress) throw new Error("V3 path uses the zero address.");
  offset += 40;
  const hops: SwapRouteHop[] = [];
  for (let index = 0; index < hopCount; index += 1) {
    const feeTier = Number.parseInt(bytes.slice(offset, offset + 6), 16);
    offset += 6;
    const tokenOut = getAddress(`0x${bytes.slice(offset, offset + 40)}`);
    offset += 40;
    if (feeTier === 0 || tokenIn === tokenOut || tokenOut === zeroAddress) throw new Error("V3 path has an invalid hop.");
    hops.push({ venue: "Uniswap V3", tokenIn, tokenOut, feeTier });
    tokenIn = tokenOut;
  }
  return hops;
}

function parseLeg(value: unknown, index: number): V3SwapLeg {
  const leg = object(value, `legs[${index}]`);
  exactKeys(leg, ["amountIn", "minAmountOut", "path"], `legs[${index}]`);
  const amountIn = uint(leg.amountIn, `legs[${index}].amountIn`, false);
  const minAmountOut = uint(leg.minAmountOut, `legs[${index}].minAmountOut`, false);
  const path = hex(leg.path, `legs[${index}].path`);
  return { amountIn, minAmountOut, path, hops: parseV3Path(path) };
}
function parseLegs(value: unknown): readonly V3SwapLeg[] {
  const legs = array(value, "legs");
  if (legs.length > MAX_V3_LEGS) throw new Error("Route exceeds the V3 leg limit.");
  return legs.map(parseLeg);
}
function sameAddress(left: Address, right: Address): boolean { return left.toLowerCase() === right.toLowerCase(); }
function assertForwardContinuity(legs: readonly V3SwapLeg[], input: Address): void {
  const reachable = new Set([input.toLowerCase()]);
  for (const leg of legs) {
    const start = leg.hops[0]!.tokenIn;
    const end = leg.hops.at(-1)!.tokenOut;
    if (!reachable.has(start.toLowerCase())) throw new Error("Route leg is not funded by a previous route leg or the selected input.");
    reachable.add(end.toLowerCase());
  }
}
function assertDirectContinuity(legs: readonly V3SwapLeg[], input: Address, output: Address): void {
  if (!legs.length) throw new Error("Direct liquidity requires at least one V3 leg.");
  assertForwardContinuity(legs, input);
  if (!sameAddress(legs.at(-1)!.hops.at(-1)!.tokenOut, output)) throw new Error("Direct route does not end in the selected output token.");
  for (let index = 0; index < legs.length - 1; index += 1) {
    const end = legs[index]!.hops.at(-1)!.tokenOut;
    const laterConsumes = legs.slice(index + 1).some((leg) => sameAddress(leg.hops[0]!.tokenIn, end));
    if (!sameAddress(end, output) && !laterConsumes) throw new Error("Direct route has a disconnected output leg.");
  }
}
function assertRedeemContinuity(legs: readonly V3SwapLeg[], output: Address): void {
  for (let index = 0; index < legs.length; index += 1) {
    const end = legs[index]!.hops.at(-1)!.tokenOut;
    const laterConsumes = legs.slice(index + 1).some((leg) => sameAddress(leg.hops[0]!.tokenIn, end));
    if (!sameAddress(end, output) && !laterConsumes) throw new Error("Basket redemption has a route leg that cannot reach the selected output.");
  }
}
function routeLabel(route: QuoteRoute): string { return route === "direct" ? "Direct liquidity" : "Basket settlement"; }

function parseQuoteTiming(response: ObjectRecord, context: TypedQuoteParseContext): { queriedAt: number; expiresAt: number; deadline: bigint } {
  const queriedAt = number(response.quotedAtMs, "quotedAtMs");
  const expiresAt = number(response.expiresAtMs, "expiresAtMs");
  const deadline = uint(response.deadline, "deadline", false);
  const nowSeconds = Math.floor(context.now / 1_000);
  if (queriedAt > context.now || context.now - queriedAt > QUOTE_MAX_AGE_MS) throw new Error("Quote is stale or timestamped in the future.");
  if (expiresAt <= context.now || BigInt(Math.ceil(expiresAt / 1_000)) > deadline) throw new Error("Quote expiry is invalid.");
  if (deadline <= BigInt(nowSeconds) || deadline > BigInt(nowSeconds + QUOTE_MAX_FUTURE_DEADLINE_SECONDS)) throw new Error("Quote deadline is expired or exceeds the allowed horizon.");
  return { queriedAt, expiresAt, deadline };
}

function parseCommonQuote(response: ObjectRecord, context: TypedQuoteParseContext): {
  id: string; queriedAt: number; expiresAt: number; deadline: bigint; outputAmount: string; expectedOutput: string; minimumReceived: string; expectedOutputRaw: bigint; minimumReceivedRaw: bigint; legs: readonly V3SwapLeg[];
} {
  if (number(response.chainId, "chainId") !== context.chainId || context.request.chainId !== context.chainId) throw new Error("Quote has the wrong chain.");
  if (!sameAddress(address(response.router, "router"), context.entryRouter)) throw new Error("Quote has the wrong entry router.");
  if (!context.request.caller || !sameAddress(address(response.caller, "caller"), context.request.caller)) throw new Error("Quote has the wrong caller.");
  if (string(response.route, "route") !== context.route) throw new Error("Quote response route does not match the requested source.");
  const inputAmountRaw = uint(response.inputAmountRaw, "inputAmountRaw", false);
  const requestedAmount = decimalAmount(context.request.inputAmount, context.request.input.decimals);
  if (requestedAmount === undefined || inputAmountRaw !== requestedAmount) throw new Error("Quote input does not match the selected amount.");
  const outputAmount = string(response.outputAmount, "outputAmount");
  const expectedOutput = string(response.expectedOutput, "expectedOutput");
  const minimumReceived = string(response.minimumReceived, "minimumReceived");
  const expectedOutputRaw = uint(response.expectedOutputRaw, "expectedOutputRaw", false);
  const minimumReceivedRaw = uint(response.minimumReceivedRaw, "minimumReceivedRaw", false);
  if (minimumReceivedRaw > expectedOutputRaw) throw new Error("Quote minimum received exceeds expected output.");
  if (decimalAmount(outputAmount, context.request.output.decimals) !== expectedOutputRaw) throw new Error("Quote display output does not match its raw output.");
  if (decimalAmount(expectedOutput, context.request.output.decimals) !== expectedOutputRaw) throw new Error("Quote expected output does not match its raw output.");
  if (decimalAmount(minimumReceived, context.request.output.decimals) !== minimumReceivedRaw) throw new Error("Quote minimum received does not match its raw output.");
  return { id: string(response.id, "id"), ...parseQuoteTiming(response, context), outputAmount, expectedOutput, minimumReceived, expectedOutputRaw, minimumReceivedRaw, legs: parseLegs(response.legs) };
}
function parseOptionalMetrics(response: ObjectRecord): Pick<SwapQuote, "venueFeeBps" | "priceImpactBps" | "gasEstimate"> {
  const venueFeeBps = optionalNumber(response.venueFeeBps, "venueFeeBps");
  const priceImpactBps = optionalNumber(response.priceImpactBps, "priceImpactBps");
  if (venueFeeBps !== undefined && (venueFeeBps < 0 || venueFeeBps > 10_000)) throw new Error("venueFeeBps is out of range.");
  if (priceImpactBps !== undefined && (priceImpactBps < 0 || priceImpactBps > 10_000)) throw new Error("priceImpactBps is out of range.");
  return { venueFeeBps, priceImpactBps, gasEstimate: optionalString(response.gasEstimate, "gasEstimate") };
}

/**
 * Accepts a quote response only if it maps exactly to one generated OTFEntryExitRouter method.
 * The router still validates pools, route balances, callbacks, and all settlement atomically.
 */
export function parseTypedQuoteResponse(value: unknown, context: TypedQuoteParseContext): SwapQuote {
  rejectForbiddenFields(value);
  if (!assetHasExecutableMetadata(context.request.input) || !assetHasExecutableMetadata(context.request.output)) {
    throw new Error("Quote assets require resolved token decimals and OTF factory identity.");
  }
  const response = object(value, "quote response");
  exactKeys(response, [
    "id", "route", "chainId", "router", "caller", "quotedAtMs", "expiresAtMs", "deadline", "inputAmountRaw", "outputAmount", "expectedOutput", "minimumReceived", "expectedOutputRaw", "minimumReceivedRaw", "venueFeeBps", "priceImpactBps", "gasEstimate", "method", "request", "legs", "minBasketAmounts",
  ], "quote response");
  const common = parseCommonQuote(response, context);
  if (!supportedSwapDirection(context.request.input, context.request.output)) throw new Error("OTF routing requires an OTF input or output.");
  const method = string(response.method, "method");
  const request = object(response.request, "request");
  let execution: TypedRouterCall;
  if (method === "swapDirect") {
    if (response.minBasketAmounts !== undefined) throw new Error("Direct quote contains basket minimums.");
    if (context.route !== "direct") throw new Error("Basket response cannot use the direct method.");
    exactKeys(request, ["tokenIn", "tokenOut", "amountIn", "minAmountOut", "deadline"], "direct request");
    const tokenIn = address(request.tokenIn, "direct request.tokenIn"); const tokenOut = address(request.tokenOut, "direct request.tokenOut"); const amountIn = uint(request.amountIn, "direct request.amountIn", false); const minAmountOut = uint(request.minAmountOut, "direct request.minAmountOut", false);
    if (!sameAddress(tokenIn, context.request.input.address) || !sameAddress(tokenOut, context.request.output.address)) throw new Error("Direct request tokens do not match the selected pair.");
    if (amountIn !== uint(response.inputAmountRaw, "inputAmountRaw", false) || minAmountOut !== common.minimumReceivedRaw || uint(request.deadline, "direct request.deadline", false) !== common.deadline) throw new Error("Direct request amounts or deadline do not match the quote.");
    assertDirectContinuity(common.legs, tokenIn, tokenOut);
    execution = { method, args: [{ tokenIn, tokenOut, amountIn, minAmountOut, deadline: common.deadline }, common.legs] };
  } else if (method === "mintFromToken") {
    if (response.minBasketAmounts !== undefined) throw new Error("Mint quote contains source-basket minimums.");
    if (context.route !== "basket" || context.request.input.kind !== "erc20" || context.request.output.kind !== "otf") throw new Error("Mint route does not match the selected basket direction.");
    exactKeys(request, ["inputToken", "vault", "amountIn", "minShares", "deadline"], "mint request");
    const inputToken = address(request.inputToken, "mint request.inputToken"); const vault = address(request.vault, "mint request.vault"); const amountIn = uint(request.amountIn, "mint request.amountIn", false); const minShares = uint(request.minShares, "mint request.minShares", false);
    if (!sameAddress(inputToken, context.request.input.address) || !sameAddress(vault, context.request.output.address)) throw new Error("Mint request tokens do not match the selected pair.");
    if (amountIn !== uint(response.inputAmountRaw, "inputAmountRaw", false) || minShares !== common.minimumReceivedRaw || uint(request.deadline, "mint request.deadline", false) !== common.deadline) throw new Error("Mint request amounts or deadline do not match the quote.");
    assertForwardContinuity(common.legs, inputToken);
    execution = { method, args: [{ inputToken, vault, amountIn, minShares, deadline: common.deadline }, common.legs] };
  } else if (method === "redeemToToken") {
    if (context.route !== "basket" || context.request.input.kind !== "otf" || context.request.output.kind !== "erc20") throw new Error("Redeem route does not match the selected basket direction.");
    exactKeys(request, ["vault", "outputToken", "shares", "minAmountOut", "deadline"], "redeem request");
    const vault = address(request.vault, "redeem request.vault"); const outputToken = address(request.outputToken, "redeem request.outputToken"); const shares = uint(request.shares, "redeem request.shares", false); const minAmountOut = uint(request.minAmountOut, "redeem request.minAmountOut", false);
    const minBasketAmounts = array(response.minBasketAmounts, "minBasketAmounts").map((amount, index) => uint(amount, `minBasketAmounts[${index}]`, true));
    if (!sameAddress(vault, context.request.input.address) || !sameAddress(outputToken, context.request.output.address)) throw new Error("Redeem request tokens do not match the selected pair.");
    if (shares !== uint(response.inputAmountRaw, "inputAmountRaw", false) || minAmountOut !== common.minimumReceivedRaw || uint(request.deadline, "redeem request.deadline", false) !== common.deadline) throw new Error("Redeem request amounts or deadline do not match the quote.");
    assertRedeemContinuity(common.legs, outputToken);
    execution = { method, args: [{ vault, outputToken, shares, minAmountOut, deadline: common.deadline }, minBasketAmounts, common.legs] };
  } else if (method === "swapBasketToBasket") {
    if (context.route !== "basket" || context.request.input.kind !== "otf" || context.request.output.kind !== "otf") throw new Error("Basket-to-basket route does not match the selected pair.");
    exactKeys(request, ["sourceVault", "targetVault", "sharesIn", "minSharesOut", "deadline"], "basket swap request");
    const sourceVault = address(request.sourceVault, "basket swap request.sourceVault"); const targetVault = address(request.targetVault, "basket swap request.targetVault"); const sharesIn = uint(request.sharesIn, "basket swap request.sharesIn", false); const minSharesOut = uint(request.minSharesOut, "basket swap request.minSharesOut", false);
    const minSourceAmounts = array(response.minBasketAmounts, "minBasketAmounts").map((amount, index) => uint(amount, `minBasketAmounts[${index}]`, true));
    if (!sameAddress(sourceVault, context.request.input.address) || !sameAddress(targetVault, context.request.output.address)) throw new Error("Basket swap request tokens do not match the selected pair.");
    if (sharesIn !== uint(response.inputAmountRaw, "inputAmountRaw", false) || minSharesOut !== common.minimumReceivedRaw || uint(request.deadline, "basket swap request.deadline", false) !== common.deadline) throw new Error("Basket swap request amounts or deadline do not match the quote.");
    execution = { method, args: [{ sourceVault, targetVault, sharesIn, minSharesOut, deadline: common.deadline }, minSourceAmounts, common.legs] };
  } else {
    throw new Error("Quote uses an unsupported entry-router method.");
  }
  return {
    id: common.id, route: context.route, state: "available", queriedAt: common.queriedAt, expiresAt: common.expiresAt, inputAmount: context.request.inputAmount, outputAmount: common.outputAmount, expectedOutput: common.expectedOutput, minimumReceived: common.minimumReceived, ...parseOptionalMetrics(response), routeLabel: routeLabel(context.route), hops: common.legs.flatMap((leg) => leg.hops), execution, router: context.entryRouter, caller: context.request.caller, chainId: context.chainId,
  };
}

export type SwapExecutionPlan = { chainId: number; router: Address; approval: { token: Address; spender: Address; amount: bigint }; call: TypedRouterCall };
function executionInput(call: TypedRouterCall): { token: Address; amount: bigint } {
  if (call.method === "swapDirect") return { token: call.args[0].tokenIn, amount: call.args[0].amountIn };
  if (call.method === "mintFromToken") return { token: call.args[0].inputToken, amount: call.args[0].amountIn };
  if (call.method === "redeemToToken") return { token: call.args[0].vault, amount: call.args[0].shares };
  return { token: call.args[0].sourceVault, amount: call.args[0].sharesIn };
}
/** Derives both the exact approval target and entry-router call locally from the validated quote. */
export function executionPlanForQuote(quote: SwapQuote | undefined, chainId: number, now: number): SwapExecutionPlan | undefined {
  if (!quote || !quote.execution || !quote.router || quote.chainId !== chainId || !quoteIsFresh(quote, now)) return undefined;
  const input = executionInput(quote.execution);
  if (input.amount === 0n || input.amount === maxUint256) return undefined;
  return { chainId, router: quote.router, approval: { token: input.token, spender: quote.router, amount: input.amount }, call: quote.execution };
}

function routerLeg(leg: V3SwapLeg): { amountIn: bigint; minAmountOut: bigint; path: Hex } {
  return { amountIn: leg.amountIn, minAmountOut: leg.minAmountOut, path: leg.path };
}

/** Removes client-only inspection metadata before ABI encoding a locally validated call. */
export function routerArgsForExecution(call: TypedRouterCall): readonly unknown[] {
  if (call.method === "swapDirect") return [call.args[0], call.args[1].map(routerLeg)];
  if (call.method === "mintFromToken") return [call.args[0], call.args[1].map(routerLeg)];
  if (call.method === "redeemToToken") return [call.args[0], call.args[1], call.args[2].map(routerLeg)];
  return [call.args[0], call.args[1], call.args[2].map(routerLeg)];
}

export type LiquidityVenue = { name: "Uniswap" | "Synthra"; href: string; prefilled: boolean };
type LiquidityNetworkConfig = {
  venue: "uniswap" | "synthra";
  chainSlug?: string;
  officialBaseUrl: string;
  usdgAddress?: Address;
  feeAmount?: number;
  tickSpacing?: number;
  isDynamic?: boolean;
};
const LIQUIDITY_NETWORKS: Record<number, LiquidityNetworkConfig> = {
  4663: {
    venue: "uniswap",
    chainSlug: robinhoodMainnetLiquidity.chainSlug,
    officialBaseUrl: robinhoodMainnetLiquidity.venue === "Uniswap" ? robinhoodMainnetLiquidity.baseUrl ?? "" : "",
    usdgAddress: robinhoodMainnetAddresses.usdg,
    feeAmount: robinhoodMainnetLiquidity.feeAmount,
    tickSpacing: robinhoodMainnetLiquidity.tickSpacing,
    isDynamic: robinhoodMainnetLiquidity.isDynamic,
  },
  // Synthra publishes no documented OTF/USDG pair-prefill URL format, so use its official app base only.
  46630: { venue: "synthra", officialBaseUrl: robinhoodTestnetLiquidity.venue === "Synthra" ? robinhoodTestnetLiquidity.baseUrl ?? "" : "", usdgAddress: robinhoodTestnetAddresses.usdg },
};
export function liquidityVenueFor(chainId: number | undefined, otf: SwapAsset | undefined, usdg: SwapAsset | undefined): LiquidityVenue | undefined {
  if (!chainId || !otf || !usdg || otf.kind !== "otf" || !otf.isFactoryVault || usdg.kind !== "erc20" || usdg.symbol.toUpperCase() !== "USDG" || !validSwapPair(otf, usdg)) return undefined;
  const config = LIQUIDITY_NETWORKS[chainId];
  if (!config?.officialBaseUrl || !config.usdgAddress || config.usdgAddress.toLowerCase() !== usdg.address.toLowerCase()) return undefined;
  if (config.venue === "synthra") return { name: "Synthra", href: config.officialBaseUrl, prefilled: false };
  if (!config.chainSlug || !config.feeAmount || !config.tickSpacing || config.isDynamic !== false) return undefined;
  const params = new URLSearchParams({
    chain: config.chainSlug,
    currencyA: otf.address,
    currencyB: usdg.address,
    fee: JSON.stringify({ feeAmount: config.feeAmount, tickSpacing: config.tickSpacing, isDynamic: config.isDynamic }),
    step: "1",
  });
  return { name: "Uniswap", href: `${config.officialBaseUrl}?${params.toString()}`, prefilled: true };
}
export function liquidityActionLabel(otfSymbol: string): string { return `Add liquidity to ${otfSymbol}/USDG`; }

export function quoteServiceForChain(chainId: number): SwapQuoteService {
  if (chainId !== 46630) return unavailableQuoteService;
  return typedQuoteService({ chainId, entryRouter: robinhoodTestnetAddresses.entryRouter, endpoint: robinhoodTestnetQuote.endpoint });
}

export const MAX_OTF_MANDATE_BYTES = 2_048;

export function creationValidation(input: { name: string; symbol: string; mandate: string; constituents: readonly { address: string }[]; annualExpenseRatioBps: number; beneficiary: string }): string[] {
  const errors: string[] = [];
  const active = input.constituents.filter((asset) => asset.address.trim());
  const normalizedName = input.name.trim();
  const mandateBytes = new TextEncoder().encode(input.mandate.trim()).length;
  if (normalizedName.length <= 4 || !normalizedName.endsWith(" OTF")) errors.push("Enter the complete fund name ending in ' OTF' (for example, 'Technology Leaders OTF').");
  if (!/^[A-Z0-9][A-Z0-9-]*$/.test(input.symbol)) errors.push("Enter a ticker using letters, numbers, or hyphens.");
  if (!mandateBytes) errors.push("Write an initial strategy rationale.");
  if (mandateBytes > MAX_OTF_MANDATE_BYTES) errors.push(`Shorten the initial strategy rationale to ${MAX_OTF_MANDATE_BYTES.toLocaleString("en-US")} bytes or fewer.`);
  if (!active.length) errors.push("Add at least one constituent.");
  if (active.length > 20) errors.push("An OTF can include at most 20 constituents.");
  const addresses = active.map((asset) => asset.address.trim().toLowerCase());
  if (addresses.some((asset) => !isAddress(asset))) errors.push("Each constituent needs a valid token address.");
  if (addresses.some((asset) => asset === zeroAddress)) errors.push("The zero address cannot be a constituent.");
  if (new Set(addresses).size !== addresses.length) errors.push("Duplicate constituents are not allowed.");
  if (!Number.isInteger(input.annualExpenseRatioBps) || input.annualExpenseRatioBps < 0 || input.annualExpenseRatioBps > 1_000) errors.push("Annual creator expense ratio must be between 0 and 1000 bps.");
  if (!isAddress(input.beneficiary) || input.beneficiary.toLowerCase() === zeroAddress) errors.push("A valid nonzero fixed beneficiary address is required.");
  return errors;
}
