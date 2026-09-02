import {
  decodeFunctionData,
  getAddress,
  isAddress,
  maxUint256,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import {
  robinhoodMainnetAddresses,
  robinhoodMainnetLiquidity,
  robinhoodMainnetUniswap,
  robinhoodTestnetAddresses,
  robinhoodTestnetLiquidity,
} from "./deployment";
import { testnetSwapPairAllowed, testnetVenue } from "./asset-catalog";

export type SwapAssetKind = "native" | "erc20" | "otf";

export type SwapAsset = {
  address: Address;
  symbol: string;
  name: string;
  kind: SwapAssetKind;
  decimals: number;
  metadataResolved?: boolean;
  verified?: boolean;
  isFactoryVault?: boolean;
  isProtocolToken?: boolean;
};

export type SwapDirection = "erc20-to-otf" | "otf-to-erc20" | "otf-to-otf" | "erc20-to-erc20";
export type QuoteRoute = "direct" | "basket";
export type QuoteState = "available" | "unavailable" | "loading" | "stale" | "failed";

export type SwapRouteHop = {
  venue: "Uniswap V3" | "Uniswap V4" | "Synthra V3";
  tokenIn: Address;
  tokenOut: Address;
  feeTier?: number;
};

export type AdapterSwapLeg = {
  adapter: Address;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  minAmountOut: bigint;
  data: Hex;
  hops: readonly SwapRouteHop[];
};

export type MintRouterCall = {
  method: "mintFromToken";
  args: readonly [
    { inputToken: Address; vault: Address; amountIn: bigint; minShares: bigint; deadline: bigint },
    readonly AdapterSwapLeg[],
  ];
};

export type NativeMintRouterCall = Omit<MintRouterCall, "method"> & { method: "mintFromNative" };

export type RedeemRouterCall = {
  method: "redeemToToken";
  args: readonly [
    { vault: Address; outputToken: Address; shares: bigint; minAmountOut: bigint; deadline: bigint },
    readonly bigint[],
    readonly AdapterSwapLeg[],
  ];
};

export type NativeRedeemRouterCall = Omit<RedeemRouterCall, "method"> & { method: "redeemToNative" };

export type BasketToBasketRouterCall = {
  method: "swapBasketToBasket";
  args: readonly [
    { sourceVault: Address; targetVault: Address; sharesIn: bigint; minSharesOut: bigint; deadline: bigint },
    readonly bigint[],
    readonly AdapterSwapLeg[],
  ];
};

export type TypedRouterCall = MintRouterCall | NativeMintRouterCall | RedeemRouterCall | NativeRedeemRouterCall | BasketToBasketRouterCall;

export type PlannedTransaction = {
  chainId: number;
  from: Address;
  to: Address;
  data: Hex;
  value: bigint;
};

export type PermitData = {
  domain: Record<string, unknown>;
  types: Record<string, readonly { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
};

export type DirectApiExecution = {
  kind: "direct-api";
  chainId: number;
  caller: Address;
  inputToken: Address;
  outputToken: Address;
  universalRouter: Address;
  amountIn: bigint;
  minAmountOut: bigint;
  expiresAt: number;
  quoteToken: string;
  nativeInput: boolean;
  nativeOutput: boolean;
  nativeValue: bigint;
  approval?: PlannedTransaction;
  cancel?: PlannedTransaction;
  permitData?: PermitData;
  transaction?: PlannedTransaction;
};

export type DirectV3Execution = {
  kind: "direct-v3";
  chainId: number;
  caller: Address;
  inputToken: Address;
  outputToken: Address;
  swapRouter02: Address;
  amountIn: bigint;
  minAmountOut: bigint;
  expiresAt: number;
  approval: { token: Address; spender: Address; amount: bigint };
  path: Hex;
  transaction: PlannedTransaction;
};

export type BasketRouterExecution = {
  kind: "basket-router";
  chainId: number;
  caller: Address;
  router: Address;
  adapter: Address;
  approval?: { token: Address; spender: Address; amount: bigint };
  nativeValue: bigint;
  funding: readonly { token: Address; amount: bigint }[];
  call: TypedRouterCall;
};

export type SwapExecutionPlan = DirectApiExecution | DirectV3Execution | BasketRouterExecution;

export type ResidualRefund = {
  token: Address;
  amount: bigint;
  displayAmount?: string;
};

export type SwapQuote = {
  id: string;
  route: QuoteRoute;
  state: QuoteState;
  queriedAt: number;
  expiresAt?: number;
  inputAmount: string;
  outputAmount?: string;
  expectedOutput?: string;
  expectedOutputRaw?: bigint;
  minimumReceived?: string;
  minimumReceivedRaw?: bigint;
  venueFeeBps?: number;
  priceImpactBps?: number;
  gasEstimate?: string;
  routeLabel: string;
  hops?: readonly SwapRouteHop[];
  residualRefunds?: readonly ResidualRefund[];
  reason?: string;
  execution?: SwapExecutionPlan;
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
  caller?: Address;
};

export type SwapQuoteService = {
  quoteDirect(request: SwapQuoteRequest): Promise<SwapQuote>;
  quoteBasket(request: SwapQuoteRequest): Promise<SwapQuote>;
  finalizeDirect(plan: DirectApiExecution, signature?: Hex): Promise<DirectApiExecution>;
};

export type SwapExecutionStage = "wallet" | "approval" | "simulation" | "submission" | "success" | "failure";
export type SwapExecutionState = "ready" | "blocked" | "unavailable" | "pending" | "complete" | "failed";

export const MAX_SWAP_LEGS = 40;
export const MAX_V3_HOPS_PER_LEG = 3;
export const QUOTE_MAX_AGE_MS = 20_000;
export const QUOTE_MAX_FUTURE_DEADLINE_SECONDS = 300;
export const FIRST_PURCHASE_MINIMUM_SHARES = 10_000_000_000_000_000n;

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

const SYNTHRA_SWAP_ROUTER_ABI = [{
  type: "function",
  name: "exactInput",
  stateMutability: "payable",
  inputs: [{
    type: "tuple",
    name: "params",
    components: [
      { type: "bytes", name: "path" },
      { type: "address", name: "recipient" },
      { type: "uint256", name: "amountIn" },
      { type: "uint256", name: "amountOutMinimum" },
    ],
  }],
  outputs: [{ type: "uint256", name: "amountOut" }],
}] as const;

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

export function swapIncludesOtf(
  input?: Pick<SwapAsset, "kind" | "isProtocolToken">,
  output?: Pick<SwapAsset, "kind" | "isProtocolToken">,
): boolean {
  return input?.kind === "otf"
    || output?.kind === "otf"
    || input?.isProtocolToken === true
    || output?.isProtocolToken === true;
}

export function supportedSwapDirection(input?: SwapAsset, output?: SwapAsset, chainId?: number): boolean {
  if (!input || !output || !swapIncludesOtf(input, output)) return false;
  return chainId === 46630 ? testnetSwapPairAllowed(input, output) : true;
}

export function pastedAsset(value: string): SwapAsset | undefined {
  const candidate = value.trim();
  if (!isAddress(candidate)) return undefined;
  const normalized = getAddress(candidate);
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

export function assetHasExecutableMetadata(asset: SwapAsset): boolean {
  return asset.address !== zeroAddress
    && asset.metadataResolved === true
    && Number.isInteger(asset.decimals)
    && asset.decimals >= 0
    && asset.decimals <= 36
    && (asset.kind === "native" || asset.kind === "erc20" || asset.isFactoryVault === true);
}

export function validSwapPair(input: SwapAsset, output: SwapAsset): boolean {
  return input.address !== zeroAddress
    && output.address !== zeroAddress
    && (input.kind !== output.kind || input.address.toLowerCase() !== output.address.toLowerCase());
}

export function nativeMaxAmount(balance: bigint, estimatedGas: bigint, maxFeePerGas: bigint): bigint {
  const reserve = estimatedGas * maxFeePerGas;
  return balance > reserve ? balance - reserve : 0n;
}

export function decimalAmount(value: string, decimals = 18): bigint | undefined {
  const match = value.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match || match[2]?.length > decimals) return undefined;
  const fractional = (match[2] ?? "").padEnd(decimals, "0");
  const amount = BigInt(match[1]) * 10n ** BigInt(decimals) + BigInt(fractional || "0");
  return amount <= maxUint256 ? amount : undefined;
}

export function decimalInputValue(value: string): string | undefined {
  if (value === "" || /^\d*(?:\.\d*)?$/.test(value)) return value;
  return undefined;
}

export function isPositiveDecimalAmount(value: string, decimals = 18): boolean {
  const amount = decimalAmount(value, decimals);
  return amount !== undefined && amount > 0n;
}

export async function requestConcurrentQuotes(service: SwapQuoteService, request: SwapQuoteRequest): Promise<SwapQuote[]> {
  if (!assetHasExecutableMetadata(request.input) || !assetHasExecutableMetadata(request.output)) {
    const reason = "Resolve token decimals and OTF factory identity before requesting an executable route.";
    return classifySwapDirection(request.input, request.output) === "erc20-to-erc20"
      ? [unavailableQuote("direct", request, reason)]
      : [unavailableQuote("direct", request, reason), unavailableQuote("basket", request, reason)];
  }
  if (!swapIncludesOtf(request.input, request.output)) {
    return [unavailableQuote("direct", request, "Swap is only available for OTF assets.")];
  }
  if (classifySwapDirection(request.input, request.output) === "erc20-to-erc20") {
    try {
      return [await service.quoteDirect(request)];
    } catch {
      return [failedQuote("direct", request, "The direct-pool quote request failed.")];
    }
  }
  const [direct, basket] = await Promise.allSettled([service.quoteDirect(request), service.quoteBasket(request)]);
  return [
    direct.status === "fulfilled" ? direct.value : failedQuote("direct", request, "The direct-pool quote request failed."),
    basket.status === "fulfilled" ? basket.value : failedQuote("basket", request, "The basket quote request failed."),
  ];
}

export function quoteIsFresh(quote: SwapQuote, now: number, maxAgeMs = QUOTE_MAX_AGE_MS): boolean {
  return quote.state === "available"
    && now >= quote.queriedAt
    && now - quote.queriedAt <= maxAgeMs
    && (quote.expiresAt === undefined || now < quote.expiresAt);
}

export function enforceFirstPurchaseMinimum(
  quotes: readonly SwapQuote[],
  output: SwapAsset,
  outputTotalSupply: bigint | undefined,
): SwapQuote[] {
  if (output.kind !== "otf") return [...quotes];
  if (outputTotalSupply === undefined) {
    return quotes.map((quote) => quote.state === "available" ? {
      ...quote,
      state: "unavailable",
      reason: "The output OTF supply could not be confirmed, so this quote cannot be used safely.",
      execution: undefined,
    } : quote);
  }
  if (outputTotalSupply !== 0n) return [...quotes];
  return quotes.map((quote) => {
    if (quote.state !== "available" || (quote.minimumReceivedRaw ?? 0n) >= FIRST_PURCHASE_MINIMUM_SHARES) return quote;
    return {
      ...quote,
      state: "unavailable",
      reason: "The first purchase must guarantee at least 0.01 OTF.",
      execution: undefined,
    };
  });
}

export function bestQueriedQuote(quotes: readonly SwapQuote[], now: number): SwapQuote | undefined {
  return quotes
    .filter((quote) => quoteIsFresh(quote, now) && (quote.expectedOutputRaw ?? 0n) > 0n)
    .sort((left, right) => {
      const leftAmount = left.expectedOutputRaw ?? 0n;
      const rightAmount = right.expectedOutputRaw ?? 0n;
      return rightAmount > leftAmount ? 1 : rightAmount < leftAmount ? -1 : 0;
    })[0];
}

export function quoteNeedsRefresh(quote: SwapQuote | undefined, now: number): boolean {
  return !quote || !quoteIsFresh(quote, now);
}

function basketRouteLabel(request: SwapQuoteRequest): string {
  const direction = classifySwapDirection(request.input, request.output);
  if (direction === "erc20-to-otf") return "Mint basket";
  if (direction === "otf-to-erc20") return "Burn basket";
  return "Burn + mint";
}

export function unavailableQuote(route: QuoteRoute, request: SwapQuoteRequest, reason: string): SwapQuote {
  return {
    id: `${route}-unavailable-${request.requestedAt}`,
    route,
    state: "unavailable",
    queriedAt: request.requestedAt,
    inputAmount: request.inputAmount,
    routeLabel: route === "direct" ? "Direct pool" : basketRouteLabel(request),
    reason,
  };
}

export function failedQuote(route: QuoteRoute, request: SwapQuoteRequest, reason: string): SwapQuote {
  return { ...unavailableQuote(route, request, reason), id: `${route}-failed-${request.requestedAt}`, state: "failed" };
}

export const unavailableQuoteService: SwapQuoteService = {
  quoteDirect: async (request) => unavailableQuote("direct", request, "Direct pool quotes are unavailable for this network."),
  quoteBasket: async (request) => unavailableQuote("basket", request, "Basket quotes require a compatible router deployment."),
  finalizeDirect: async () => { throw new Error("Direct pool execution is unavailable for this network."); },
};

type ObjectRecord = Record<string, unknown>;
type TypedQuoteParseContext = {
  route: QuoteRoute;
  request: SwapQuoteRequest;
  entryRouter?: Address;
  adapter?: Address;
  permit2?: Address;
  universalRouter?: Address;
  swapRouter02?: Address;
  chainId: number;
  now: number;
};

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
function integer(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer.`);
  return value;
}
function optionalInteger(value: unknown, label: string): number | undefined {
  return value === undefined ? undefined : integer(value, label);
}
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
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${label} contains an unsupported field: ${key}.`);
  }
}
function sameAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export function parseV3Path(path: Hex, venue: SwapRouteHop["venue"] = "Uniswap V3"): readonly SwapRouteHop[] {
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
    if (feeTier === 0 || sameAddress(tokenIn, tokenOut) || tokenOut === zeroAddress) throw new Error("V3 path has an invalid hop.");
    hops.push({ venue, tokenIn, tokenOut, feeTier });
    tokenIn = tokenOut;
  }
  return hops;
}

function parseTransaction(
  value: unknown,
  label: string,
  binding: { chainId: number; caller: Address; target: Address; value?: bigint; spender?: Address; amount?: bigint },
): PlannedTransaction {
  const transaction = object(value, label);
  exactKeys(transaction, ["chainId", "from", "to", "data", "value"], label);
  const parsed = {
    chainId: integer(transaction.chainId, `${label}.chainId`),
    from: address(transaction.from, `${label}.from`),
    to: address(transaction.to, `${label}.to`),
    data: hex(transaction.data, `${label}.data`),
    value: uint(transaction.value, `${label}.value`),
  };
  if (parsed.chainId !== binding.chainId || !sameAddress(parsed.from, binding.caller)) throw new Error(`${label} has the wrong chain or sender.`);
  if (!sameAddress(parsed.to, binding.target) || parsed.value !== (binding.value ?? 0n)) throw new Error(`${label} has an unsupported target or native value.`);
  if (binding.spender) {
    let decoded: ReturnType<typeof decodeFunctionData<typeof ERC20_APPROVE_ABI>>;
    try {
      decoded = decodeFunctionData({ abi: ERC20_APPROVE_ABI, data: parsed.data });
    } catch {
      throw new Error(`${label} is not an ERC-20 approval.`);
    }
    if (decoded.functionName !== "approve") throw new Error(`${label} is not an ERC-20 approval.`);
    const [spender, amount] = decoded.args;
    if (!sameAddress(getAddress(spender), binding.spender) || amount !== binding.amount) {
      throw new Error(`${label} has the wrong approval spender or amount.`);
    }
  }
  return parsed;
}

function parsePermitData(value: unknown, binding: { chainId: number; permit2: Address; inputToken: Address; universalRouter: Address; amountIn: bigint }): PermitData {
  const permit = object(value, "permitData");
  exactKeys(permit, ["domain", "types", "primaryType", "message"], "permitData");
  const domain = object(permit.domain, "permitData.domain");
  const message = object(permit.message, "permitData.message");
  const typesObject = object(permit.types, "permitData.types");
  const types: Record<string, readonly { name: string; type: string }[]> = {};
  for (const [name, fieldsValue] of Object.entries(typesObject)) {
    types[name] = array(fieldsValue, `permitData.types.${name}`).map((fieldValue, index) => {
      const field = object(fieldValue, `permitData.types.${name}[${index}]`);
      exactKeys(field, ["name", "type"], `permitData.types.${name}[${index}]`);
      return { name: string(field.name, "permit field name"), type: string(field.type, "permit field type") };
    });
  }
  if (integer(domain.chainId, "permitData.domain.chainId") !== binding.chainId) throw new Error("Permit2 data has the wrong chain.");
  if (!sameAddress(address(domain.verifyingContract, "permitData.domain.verifyingContract"), binding.permit2)) throw new Error("Permit2 data has the wrong verifying contract.");
  const details = object(message.details, "permitData.message.details");
  if (!sameAddress(address(details.token, "permitData.message.details.token"), binding.inputToken)) throw new Error("Permit2 data has the wrong input token.");
  if (uint(details.amount, "permitData.message.details.amount", false) < binding.amountIn) throw new Error("Permit2 data authorizes too little input.");
  if (!sameAddress(address(message.spender, "permitData.message.spender"), binding.universalRouter)) throw new Error("Permit2 data has the wrong spender.");
  return { domain, types, primaryType: string(permit.primaryType, "permitData.primaryType"), message };
}

function parseDirectExecution(value: unknown, context: TypedQuoteParseContext, expected?: DirectApiExecution): DirectApiExecution {
  if (!context.permit2 || !context.universalRouter || !context.request.caller) throw new Error("Direct execution targets are not configured.");
  const execution = object(value, "execution");
  exactKeys(execution, [
    "kind", "chainId", "caller", "inputToken", "outputToken", "universalRouter", "amountIn", "minAmountOut",
    "expiresAtMs", "quoteToken", "nativeInput", "nativeOutput", "nativeValue", "approval", "cancel", "permitData", "transaction",
  ], "execution");
  if (string(execution.kind, "execution.kind") !== "direct-api") throw new Error("Direct quote has the wrong execution kind.");
  const plan: DirectApiExecution = {
    kind: "direct-api",
    chainId: integer(execution.chainId, "execution.chainId"),
    caller: address(execution.caller, "execution.caller"),
    inputToken: address(execution.inputToken, "execution.inputToken"),
    outputToken: address(execution.outputToken, "execution.outputToken"),
    universalRouter: address(execution.universalRouter, "execution.universalRouter"),
    amountIn: uint(execution.amountIn, "execution.amountIn", false),
    minAmountOut: uint(execution.minAmountOut, "execution.minAmountOut", false),
    expiresAt: integer(execution.expiresAtMs, "execution.expiresAtMs"),
    quoteToken: string(execution.quoteToken, "execution.quoteToken"),
    nativeInput: execution.nativeInput === true,
    nativeOutput: execution.nativeOutput === true,
    nativeValue: uint(execution.nativeValue, "execution.nativeValue"),
  };
  if (
    plan.chainId !== context.chainId
    || !sameAddress(plan.caller, context.request.caller)
    || !sameAddress(plan.inputToken, context.request.input.address)
    || !sameAddress(plan.outputToken, context.request.output.address)
    || !sameAddress(plan.universalRouter, context.universalRouter)
  ) throw new Error("Direct execution does not match the selected chain, caller, or pair.");
  if (plan.nativeInput !== (context.request.input.kind === "native") || plan.nativeOutput !== (context.request.output.kind === "native")) throw new Error("Direct execution has forged native asset flags.");
  if (plan.nativeInput && plan.nativeOutput) throw new Error("Direct execution cannot use native ETH on both sides.");
  const requestedAmount = decimalAmount(context.request.inputAmount, context.request.input.decimals);
  if (requestedAmount === undefined || plan.amountIn !== requestedAmount) throw new Error("Direct execution has the wrong exact input amount.");
  if (plan.nativeValue !== (plan.nativeInput ? plan.amountIn : 0n)) throw new Error("Direct execution has the wrong native transaction value.");
  if (plan.expiresAt <= context.now || plan.expiresAt > context.now + QUOTE_MAX_FUTURE_DEADLINE_SECONDS * 1_000) throw new Error("Direct execution has an invalid expiry.");
  if (execution.approval !== undefined) {
    if (plan.nativeInput) throw new Error("Native input cannot contain an ERC-20 approval.");
    plan.approval = parseTransaction(execution.approval, "execution.approval", {
      chainId: context.chainId,
      caller: plan.caller,
      target: plan.inputToken,
      spender: context.permit2,
      amount: plan.amountIn,
    });
  }
  if (execution.cancel !== undefined) {
    if (plan.nativeInput) throw new Error("Native input cannot contain an ERC-20 approval reset.");
    plan.cancel = parseTransaction(execution.cancel, "execution.cancel", {
      chainId: context.chainId,
      caller: plan.caller,
      target: plan.inputToken,
      spender: context.permit2,
      amount: 0n,
    });
  }
  if (execution.permitData !== undefined) {
    if (plan.nativeInput) throw new Error("Native input cannot contain Permit2 data.");
    plan.permitData = parsePermitData(execution.permitData, {
      chainId: context.chainId,
      permit2: context.permit2,
      inputToken: plan.inputToken,
      universalRouter: context.universalRouter,
      amountIn: plan.amountIn,
    });
  }
  if (execution.transaction !== undefined) {
    plan.transaction = parseTransaction(execution.transaction, "execution.transaction", {
      chainId: context.chainId,
      caller: plan.caller,
      target: context.universalRouter,
      value: plan.nativeValue,
    });
  }
  if (expected && (
    plan.quoteToken !== expected.quoteToken
    || plan.amountIn !== expected.amountIn
    || plan.minAmountOut !== expected.minAmountOut
    || plan.expiresAt !== expected.expiresAt
    || plan.nativeInput !== expected.nativeInput
    || plan.nativeOutput !== expected.nativeOutput
    || plan.nativeValue !== expected.nativeValue
  )) throw new Error("Final direct transaction does not match the authorized quote.");
  return plan;
}

function parseDirectV3Execution(value: unknown, context: TypedQuoteParseContext): DirectV3Execution {
  if (!context.swapRouter02 || !context.request.caller) throw new Error("Synthra direct execution is not configured.");
  if (context.request.input.kind === "native" || context.request.output.kind === "native") throw new Error("An atomic native Synthra route has not been verified.");
  const execution = object(value, "execution");
  exactKeys(execution, [
    "kind", "chainId", "caller", "inputToken", "outputToken", "swapRouter02", "amountIn", "minAmountOut",
    "expiresAtMs", "approval", "path", "transaction",
  ], "execution");
  if (string(execution.kind, "execution.kind") !== "direct-v3") throw new Error("Synthra quote has the wrong execution kind.");
  const plan = {
    kind: "direct-v3" as const,
    chainId: integer(execution.chainId, "execution.chainId"),
    caller: address(execution.caller, "execution.caller"),
    inputToken: address(execution.inputToken, "execution.inputToken"),
    outputToken: address(execution.outputToken, "execution.outputToken"),
    swapRouter02: address(execution.swapRouter02, "execution.swapRouter02"),
    amountIn: uint(execution.amountIn, "execution.amountIn", false),
    minAmountOut: uint(execution.minAmountOut, "execution.minAmountOut", false),
    expiresAt: integer(execution.expiresAtMs, "execution.expiresAtMs"),
    path: hex(execution.path, "execution.path"),
  };
  if (
    plan.chainId !== context.chainId
    || !sameAddress(plan.caller, context.request.caller)
    || !sameAddress(plan.inputToken, context.request.input.address)
    || !sameAddress(plan.outputToken, context.request.output.address)
    || !sameAddress(plan.swapRouter02, context.swapRouter02)
  ) throw new Error("Synthra execution does not match the selected chain, caller, pair, or router.");
  const requestedAmount = decimalAmount(context.request.inputAmount, context.request.input.decimals);
  if (requestedAmount === undefined || plan.amountIn !== requestedAmount) throw new Error("Synthra execution has the wrong exact input amount.");
  if (plan.expiresAt <= context.now || plan.expiresAt > context.now + QUOTE_MAX_FUTURE_DEADLINE_SECONDS * 1_000) throw new Error("Synthra execution has an invalid expiry.");
  const hops = parseV3Path(plan.path, "Synthra V3");
  if (!sameAddress(hops[0]!.tokenIn, plan.inputToken) || !sameAddress(hops.at(-1)!.tokenOut, plan.outputToken)) throw new Error("Synthra path endpoints do not match the selected pair.");

  const approvalValue = object(execution.approval, "execution.approval");
  exactKeys(approvalValue, ["token", "spender", "amount"], "execution.approval");
  const approval = {
    token: address(approvalValue.token, "execution.approval.token"),
    spender: address(approvalValue.spender, "execution.approval.spender"),
    amount: uint(approvalValue.amount, "execution.approval.amount", false),
  };
  if (!sameAddress(approval.token, plan.inputToken) || !sameAddress(approval.spender, plan.swapRouter02) || approval.amount !== plan.amountIn) throw new Error("Synthra approval does not match the exact route input.");
  const transaction = parseTransaction(execution.transaction, "execution.transaction", {
    chainId: context.chainId,
    caller: plan.caller,
    target: plan.swapRouter02,
  });
  let decoded: ReturnType<typeof decodeFunctionData<typeof SYNTHRA_SWAP_ROUTER_ABI>>;
  try {
    decoded = decodeFunctionData({ abi: SYNTHRA_SWAP_ROUTER_ABI, data: transaction.data });
  } catch {
    throw new Error("Synthra transaction is not an exact-input swap.");
  }
  if (decoded.functionName !== "exactInput") throw new Error("Synthra transaction is not an exact-input swap.");
  const [params] = decoded.args;
  if (
    params.path.toLowerCase() !== plan.path.toLowerCase()
    || !sameAddress(getAddress(params.recipient), plan.caller)
    || params.amountIn !== plan.amountIn
    || params.amountOutMinimum !== plan.minAmountOut
  ) throw new Error("Synthra calldata does not match the quoted path, recipient, or amounts.");
  return { ...plan, approval, transaction };
}

function parseLeg(value: unknown, index: number, adapter: Address, venue: SwapRouteHop["venue"]): AdapterSwapLeg {
  const leg = object(value, `legs[${index}]`);
  exactKeys(leg, ["adapter", "tokenIn", "tokenOut", "amountIn", "minAmountOut", "data"], `legs[${index}]`);
  const parsedAdapter = address(leg.adapter, `legs[${index}].adapter`);
  if (!sameAddress(parsedAdapter, adapter)) throw new Error("Route uses an unknown adapter.");
  const tokenIn = address(leg.tokenIn, `legs[${index}].tokenIn`);
  const tokenOut = address(leg.tokenOut, `legs[${index}].tokenOut`);
  const amountIn = uint(leg.amountIn, `legs[${index}].amountIn`, false);
  const minAmountOut = uint(leg.minAmountOut, `legs[${index}].minAmountOut`, false);
  const data = hex(leg.data, `legs[${index}].data`);
  const hops = parseV3Path(data, venue);
  if (!sameAddress(hops[0]!.tokenIn, tokenIn) || !sameAddress(hops.at(-1)!.tokenOut, tokenOut)) {
    throw new Error("Adapter data endpoints do not match the leg.");
  }
  return { adapter: parsedAdapter, tokenIn, tokenOut, amountIn, minAmountOut, data, hops };
}

function parseFunding(value: unknown): readonly { token: Address; amount: bigint }[] {
  const seen = new Set<string>();
  return array(value, "execution.funding").map((entryValue, index) => {
    const entry = object(entryValue, `execution.funding[${index}]`);
    exactKeys(entry, ["token", "amount"], `execution.funding[${index}]`);
    const token = address(entry.token, `execution.funding[${index}].token`);
    const amount = uint(entry.amount, `execution.funding[${index}].amount`, false);
    if (seen.has(token.toLowerCase())) throw new Error("Basket funding contains a duplicate token.");
    seen.add(token.toLowerCase());
    return { token, amount };
  });
}

function assertLegFunding(legs: readonly AdapterSwapLeg[], funding: readonly { token: Address; amount: bigint }[]): void {
  const available = new Map(funding.map((entry) => [entry.token.toLowerCase(), entry.amount]));
  for (const leg of legs) {
    const inputKey = leg.tokenIn.toLowerCase();
    const outputKey = leg.tokenOut.toLowerCase();
    const current = available.get(inputKey) ?? 0n;
    const spent = leg.amountIn === maxUint256 ? current : leg.amountIn;
    if (spent === 0n || spent > current) throw new Error("Route leg overspends its connected transient balance.");
    available.set(inputKey, current - spent);
    available.set(outputKey, (available.get(outputKey) ?? 0n) + leg.minAmountOut);
  }
}

function parseBasketCall(
  execution: ObjectRecord,
  context: TypedQuoteParseContext,
  adapter: Address,
  deadline: bigint,
): { call: TypedRouterCall; funding: readonly { token: Address; amount: bigint }[] } {
  const method = string(execution.method, "execution.method");
  const request = object(execution.request, "execution.request");
  const legsValue = array(execution.legs, "execution.legs");
  if (legsValue.length > MAX_SWAP_LEGS) throw new Error("Route exceeds the leg limit.");
  const venue: SwapRouteHop["venue"] = context.chainId === 46630 ? "Synthra V3" : "Uniswap V3";
  const legs = legsValue.map((leg, index) => parseLeg(leg, index, adapter, venue));
  const funding = parseFunding(execution.funding);
  assertLegFunding(legs, funding);
  const requestedAmount = decimalAmount(context.request.inputAmount, context.request.input.decimals);
  if (requestedAmount === undefined) throw new Error("Selected input amount is invalid.");

  if (method === "mintFromToken" || method === "mintFromNative") {
    const native = method === "mintFromNative";
    if ((native ? context.request.input.kind !== "native" : context.request.input.kind !== "erc20") || context.request.output.kind !== "otf") throw new Error("Mint method does not match the selected pair.");
    exactKeys(request, ["inputToken", "vault", "amountIn", "minShares", "deadline"], "execution.request");
    const value = {
      inputToken: address(request.inputToken, "request.inputToken"),
      vault: address(request.vault, "request.vault"),
      amountIn: uint(request.amountIn, "request.amountIn", false),
      minShares: uint(request.minShares, "request.minShares", false),
      deadline: uint(request.deadline, "request.deadline", false),
    };
    if (!sameAddress(value.inputToken, context.request.input.address) || !sameAddress(value.vault, context.request.output.address) || value.amountIn !== requestedAmount || value.deadline !== deadline) throw new Error("Mint request does not match the selected quote.");
    if (funding.length !== 1 || !sameAddress(funding[0]!.token, value.inputToken) || funding[0]!.amount !== value.amountIn) throw new Error("Mint funding does not match the exact input.");
    return { call: { method, args: [value, legs] }, funding };
  }
  const minimums = array(execution.minBasketAmounts, "execution.minBasketAmounts").map((amount, index) => uint(amount, `minBasketAmounts[${index}]`));
  if (method === "redeemToToken" || method === "redeemToNative") {
    const native = method === "redeemToNative";
    if (context.request.input.kind !== "otf" || (native ? context.request.output.kind !== "native" : context.request.output.kind !== "erc20")) throw new Error("Redeem method does not match the selected pair.");
    exactKeys(request, ["vault", "outputToken", "shares", "minAmountOut", "deadline"], "execution.request");
    const value = {
      vault: address(request.vault, "request.vault"),
      outputToken: address(request.outputToken, "request.outputToken"),
      shares: uint(request.shares, "request.shares", false),
      minAmountOut: uint(request.minAmountOut, "request.minAmountOut", false),
      deadline: uint(request.deadline, "request.deadline", false),
    };
    if (!sameAddress(value.vault, context.request.input.address) || !sameAddress(value.outputToken, context.request.output.address) || value.shares !== requestedAmount || value.deadline !== deadline) throw new Error("Redeem request does not match the selected quote.");
    return { call: { method, args: [value, minimums, legs] }, funding };
  }
  if (method === "swapBasketToBasket") {
    if (context.request.input.kind !== "otf" || context.request.output.kind !== "otf") throw new Error("Basket swap method does not match the selected pair.");
    exactKeys(request, ["sourceVault", "targetVault", "sharesIn", "minSharesOut", "deadline"], "execution.request");
    const value = {
      sourceVault: address(request.sourceVault, "request.sourceVault"),
      targetVault: address(request.targetVault, "request.targetVault"),
      sharesIn: uint(request.sharesIn, "request.sharesIn", false),
      minSharesOut: uint(request.minSharesOut, "request.minSharesOut", false),
      deadline: uint(request.deadline, "request.deadline", false),
    };
    if (!sameAddress(value.sourceVault, context.request.input.address) || !sameAddress(value.targetVault, context.request.output.address) || value.sharesIn !== requestedAmount || value.deadline !== deadline) throw new Error("Basket swap request does not match the selected quote.");
    return { call: { method, args: [value, minimums, legs] }, funding };
  }
  throw new Error("Basket quote uses an unsupported entry-router method.");
}

function parseBasketExecution(value: unknown, context: TypedQuoteParseContext, expiresAt: number): BasketRouterExecution {
  if (!context.entryRouter || !context.adapter || !context.request.caller) throw new Error("Basket execution is not configured.");
  const execution = object(value, "execution");
  exactKeys(execution, [
    "kind", "chainId", "caller", "router", "adapter", "approval", "nativeValue", "funding",
    "method", "request", "legs", "minBasketAmounts",
  ], "execution");
  if (string(execution.kind, "execution.kind") !== "basket-router") throw new Error("Basket quote has the wrong execution kind.");
  const chainId = integer(execution.chainId, "execution.chainId");
  const caller = address(execution.caller, "execution.caller");
  const router = address(execution.router, "execution.router");
  const adapter = address(execution.adapter, "execution.adapter");
  if (chainId !== context.chainId || !sameAddress(caller, context.request.caller)) throw new Error("Basket execution has the wrong chain or caller.");
  if (!sameAddress(router, context.entryRouter) || !sameAddress(adapter, context.adapter)) throw new Error("Basket execution has a deployment mismatch.");
  const requestedAmount = decimalAmount(context.request.inputAmount, context.request.input.decimals);
  if (requestedAmount === undefined) throw new Error("Basket execution has an invalid input amount.");
  const nativeValue = uint(execution.nativeValue, "execution.nativeValue");
  let approval: BasketRouterExecution["approval"];
  if (execution.approval !== undefined) {
    const approvalValue = object(execution.approval, "execution.approval");
    exactKeys(approvalValue, ["token", "spender", "amount"], "execution.approval");
    approval = {
      token: address(approvalValue.token, "execution.approval.token"),
      spender: address(approvalValue.spender, "execution.approval.spender"),
      amount: uint(approvalValue.amount, "execution.approval.amount", false),
    };
  }
  if (context.request.input.kind === "native") {
    if (approval || nativeValue !== requestedAmount) throw new Error("Native basket input has an approval or the wrong transaction value.");
  } else {
    if (!approval || !sameAddress(approval.token, context.request.input.address) || !sameAddress(approval.spender, router) || approval.amount !== requestedAmount || nativeValue !== 0n) throw new Error("Basket approval does not match the exact input and entry router.");
  }
  const deadline = callDeadline(execution.request);
  const nowSeconds = BigInt(Math.floor(context.now / 1_000));
  if (
    deadline <= nowSeconds
    || deadline > nowSeconds + BigInt(QUOTE_MAX_FUTURE_DEADLINE_SECONDS)
    || BigInt(Math.ceil(expiresAt / 1_000)) > deadline
  ) throw new Error("Basket execution deadline is invalid.");
  const { call, funding } = parseBasketCall(execution, context, adapter, deadline);
  return { kind: "basket-router", chainId, caller, router, adapter, approval, nativeValue, funding, call };
}

function callDeadline(requestValue: unknown): bigint {
  return uint(object(requestValue, "execution.request").deadline, "execution.request.deadline", false);
}

function parseRefunds(value: unknown): readonly ResidualRefund[] | undefined {
  if (value === undefined) return undefined;
  return array(value, "residualRefunds").map((refundValue, index) => {
    const refund = object(refundValue, `residualRefunds[${index}]`);
    exactKeys(refund, ["token", "amount", "displayAmount"], `residualRefunds[${index}]`);
    return {
      token: address(refund.token, `residualRefunds[${index}].token`),
      amount: uint(refund.amount, `residualRefunds[${index}].amount`),
      displayAmount: refund.displayAmount === undefined ? undefined : string(refund.displayAmount, `residualRefunds[${index}].displayAmount`),
    };
  });
}

export function parseTypedQuoteResponse(value: unknown, context: TypedQuoteParseContext): SwapQuote {
  if (!assetHasExecutableMetadata(context.request.input) || !assetHasExecutableMetadata(context.request.output)) throw new Error("Quote assets require resolved metadata and OTF factory identity.");
  const response = object(value, "quote response");
  if (response.state === "unavailable") {
    exactKeys(response, ["state", "route", "reason"], "quote response");
    if (string(response.route, "route") !== context.route) throw new Error("Unavailable quote has the wrong route.");
    return unavailableQuote(context.route, context.request, string(response.reason, "reason"));
  }
  exactKeys(response, [
    "state", "id", "route", "chainId", "caller", "quotedAtMs", "expiresAtMs", "inputAmountRaw",
    "outputAmount", "expectedOutput", "expectedOutputRaw", "minimumReceived", "minimumReceivedRaw",
    "venueFeeBps", "priceImpactBps", "gasEstimate", "routeLabel", "hops", "residualRefunds", "execution",
  ], "quote response");
  if (string(response.state, "state") !== "available" || string(response.route, "route") !== context.route) throw new Error("Quote response has the wrong state or route.");
  if (integer(response.chainId, "chainId") !== context.chainId || context.request.chainId !== context.chainId) throw new Error("Quote has the wrong chain.");
  if (!context.request.caller || !sameAddress(address(response.caller, "caller"), context.request.caller)) throw new Error("Quote has the wrong caller.");
  const queriedAt = integer(response.quotedAtMs, "quotedAtMs");
  const expiresAt = integer(response.expiresAtMs, "expiresAtMs");
  if (queriedAt > context.now || context.now - queriedAt > QUOTE_MAX_AGE_MS || expiresAt <= context.now || expiresAt > context.now + QUOTE_MAX_FUTURE_DEADLINE_SECONDS * 1_000) throw new Error("Quote is stale or has an invalid expiry.");
  const requestedAmount = decimalAmount(context.request.inputAmount, context.request.input.decimals);
  if (requestedAmount === undefined || uint(response.inputAmountRaw, "inputAmountRaw", false) !== requestedAmount) throw new Error("Quote has the wrong exact input amount.");
  const outputAmount = string(response.outputAmount, "outputAmount");
  const expectedOutput = string(response.expectedOutput, "expectedOutput");
  const minimumReceived = string(response.minimumReceived, "minimumReceived");
  const expectedOutputRaw = uint(response.expectedOutputRaw, "expectedOutputRaw", false);
  const minimumReceivedRaw = uint(response.minimumReceivedRaw, "minimumReceivedRaw", false);
  if (minimumReceivedRaw > expectedOutputRaw) throw new Error("Quote minimum exceeds expected output.");
  if (decimalAmount(outputAmount, context.request.output.decimals) !== expectedOutputRaw || decimalAmount(expectedOutput, context.request.output.decimals) !== expectedOutputRaw || decimalAmount(minimumReceived, context.request.output.decimals) !== minimumReceivedRaw) throw new Error("Quote display amounts do not match their integer amounts.");
  const executionValue = object(response.execution, "execution");
  const execution = context.route === "direct"
    ? executionValue.kind === "direct-v3"
      ? parseDirectV3Execution(response.execution, context)
      : parseDirectExecution(response.execution, context)
    : parseBasketExecution(response.execution, context, expiresAt);
  if (execution.kind === "direct-api" || execution.kind === "direct-v3") {
    if (execution.minAmountOut !== minimumReceivedRaw) throw new Error("Direct execution minimum does not match the quote.");
  } else if (execution.call.method === "mintFromToken" || execution.call.method === "mintFromNative") {
    if (execution.call.args[0].minShares !== minimumReceivedRaw) throw new Error("Basket execution minimum does not match the quote.");
  } else if (execution.call.method === "redeemToToken" || execution.call.method === "redeemToNative") {
    if (execution.call.args[0].minAmountOut !== minimumReceivedRaw) throw new Error("Basket execution minimum does not match the quote.");
  } else {
    if (execution.call.args[0].minSharesOut !== minimumReceivedRaw) throw new Error("Basket execution minimum does not match the quote.");
  }
  const venueFeeBps = optionalInteger(response.venueFeeBps, "venueFeeBps");
  const priceImpactBps = optionalInteger(response.priceImpactBps, "priceImpactBps");
  if (venueFeeBps !== undefined && (venueFeeBps < 0 || venueFeeBps > 10_000)) throw new Error("venueFeeBps is out of range.");
  if (priceImpactBps !== undefined && (priceImpactBps < 0 || priceImpactBps > 10_000)) throw new Error("priceImpactBps is out of range.");
  const basketLegs = execution.kind === "basket-router"
    ? execution.call.method === "mintFromToken" || execution.call.method === "mintFromNative" ? execution.call.args[1] : execution.call.args[2]
    : [];
  const hops = response.hops === undefined ? basketLegs.flatMap((leg) => leg.hops)
    : array(response.hops, "hops").map((hopValue, index) => {
      const hop = object(hopValue, `hops[${index}]`);
      exactKeys(hop, ["venue", "tokenIn", "tokenOut", "feeTier"], `hops[${index}]`);
      const venue = string(hop.venue, `hops[${index}].venue`);
      if (venue !== "Uniswap V3" && venue !== "Uniswap V4" && venue !== "Synthra V3") throw new Error("Quote uses an unsupported venue.");
      return {
        venue: venue as SwapRouteHop["venue"],
        tokenIn: address(hop.tokenIn, `hops[${index}].tokenIn`),
        tokenOut: address(hop.tokenOut, `hops[${index}].tokenOut`),
        feeTier: optionalInteger(hop.feeTier, `hops[${index}].feeTier`),
      };
    });
  return {
    id: string(response.id, "id"),
    route: context.route,
    state: "available",
    queriedAt,
    expiresAt,
    inputAmount: context.request.inputAmount,
    outputAmount,
    expectedOutput,
    expectedOutputRaw,
    minimumReceived,
    minimumReceivedRaw,
    venueFeeBps,
    priceImpactBps,
    gasEstimate: response.gasEstimate === undefined ? undefined : string(response.gasEstimate, "gasEstimate"),
    routeLabel: string(response.routeLabel, "routeLabel"),
    hops,
    residualRefunds: parseRefunds(response.residualRefunds),
    execution,
    caller: context.request.caller,
    chainId: context.chainId,
  };
}

export function executionPlanForQuote(quote: SwapQuote | undefined, chainId: number, now: number): SwapExecutionPlan | undefined {
  if (!quote?.execution || quote.chainId !== chainId || !quoteIsFresh(quote, now)) return undefined;
  if (quote.execution.chainId !== chainId) return undefined;
  const amountIn = quote.execution.kind === "basket-router"
    ? quote.execution.approval?.amount ?? quote.execution.nativeValue
    : quote.execution.amountIn;
  if (amountIn === 0n || amountIn === maxUint256) return undefined;
  return quote.execution;
}

function routerLeg(leg: AdapterSwapLeg) {
  return {
    adapter: leg.adapter,
    tokenIn: leg.tokenIn,
    tokenOut: leg.tokenOut,
    amountIn: leg.amountIn,
    minAmountOut: leg.minAmountOut,
    data: leg.data,
  };
}

export function routerArgsForExecution(call: TypedRouterCall): readonly unknown[] {
  if (call.method === "mintFromToken" || call.method === "mintFromNative") return [call.args[0], call.args[1].map(routerLeg)];
  return [call.args[0], call.args[1], call.args[2].map(routerLeg)];
}

function directExecutionBody(plan: DirectApiExecution, signature?: Hex): ObjectRecord {
  return {
    action: "finalize-direct",
    signature,
    plan: {
      kind: plan.kind,
      chainId: plan.chainId,
      caller: plan.caller,
      inputToken: plan.inputToken,
      outputToken: plan.outputToken,
      universalRouter: plan.universalRouter,
      amountIn: plan.amountIn.toString(),
      minAmountOut: plan.minAmountOut.toString(),
      expiresAtMs: plan.expiresAt,
      quoteToken: plan.quoteToken,
      nativeInput: plan.nativeInput,
      nativeOutput: plan.nativeOutput,
      nativeValue: plan.nativeValue.toString(),
    },
  };
}

export type TypedQuoteServiceConfig = {
  endpoint: string;
  chainId: number;
  entryRouter?: Address;
  adapter?: Address;
  permit2?: Address;
  universalRouter?: Address;
  swapRouter02?: Address;
  now?: () => number;
};

export function typedQuoteService(config: TypedQuoteServiceConfig): SwapQuoteService {
  const now = config.now ?? Date.now;
  const context = (route: QuoteRoute, request: SwapQuoteRequest): TypedQuoteParseContext => ({
    route,
    request,
    entryRouter: config.entryRouter,
    adapter: config.adapter,
    permit2: config.permit2,
    universalRouter: config.universalRouter,
    swapRouter02: config.swapRouter02,
    chainId: config.chainId,
    now: now(),
  });
  const requestQuote = async (route: QuoteRoute, request: SwapQuoteRequest): Promise<SwapQuote> => {
    if (!request.caller) return unavailableQuote(route, request, "Connect the wallet that will submit this route before requesting it.");
    const inputAmountRaw = decimalAmount(request.inputAmount, request.input.decimals);
    if (!inputAmountRaw) return unavailableQuote(route, request, "Enter a valid exact input amount.");
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "quote",
        route,
        chainId: request.chainId,
        caller: request.caller,
        input: { address: request.input.address, decimals: request.input.decimals, kind: request.input.kind, isFactoryVault: request.input.isFactoryVault === true, isProtocolToken: request.input.isProtocolToken === true },
        output: { address: request.output.address, decimals: request.output.decimals, kind: request.output.kind, isFactoryVault: request.output.isFactoryVault === true, isProtocolToken: request.output.isProtocolToken === true },
        inputAmountRaw: inputAmountRaw.toString(),
        slippageBps: request.slippageBps,
        requestedAtMs: request.requestedAt,
      }),
    });
    const payload: unknown = await response.json();
    if (!response.ok && object(payload, "quote response").state !== "unavailable") throw new Error(`Quote endpoint returned ${response.status}.`);
    return parseTypedQuoteResponse(payload, context(route, request));
  };
  const finalizeDirect = async (plan: DirectApiExecution, signature?: Hex): Promise<DirectApiExecution> => {
    const request: SwapQuoteRequest = {
      chainId: plan.chainId,
      caller: plan.caller,
      input: { address: plan.inputToken, symbol: "", name: "", kind: plan.nativeInput ? "native" : "erc20", decimals: 0, metadataResolved: true },
      output: { address: plan.outputToken, symbol: "", name: "", kind: plan.nativeOutput ? "native" : "erc20", decimals: 0, metadataResolved: true },
      inputAmount: plan.amountIn.toString(),
      slippageBps: 0,
      requestedAt: now(),
    };
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(directExecutionBody(plan, signature)),
    });
    if (!response.ok) throw new Error("Uniswap could not produce the final transaction.");
    const payload = object(await response.json(), "finalize response");
    exactKeys(payload, ["execution"], "finalize response");
    const execution = parseDirectExecution(payload.execution, context("direct", request), plan);
    if (!execution.transaction) throw new Error("Final direct execution is missing its transaction.");
    return execution;
  };
  return {
    quoteDirect: (request) => requestQuote("direct", request),
    quoteBasket: (request) => requestQuote("basket", request),
    finalizeDirect,
  };
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
  46630: {
    venue: "synthra",
    officialBaseUrl: robinhoodTestnetLiquidity.venue === "Synthra" ? robinhoodTestnetLiquidity.baseUrl ?? "" : "",
    usdgAddress: robinhoodTestnetAddresses.usdg,
  },
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

export function liquidityActionLabel(otfSymbol: string): string {
  return `Add liquidity to ${otfSymbol}/USDG`;
}

export function quoteServiceForChain(chainId: number): SwapQuoteService {
  if (chainId === 4663) {
    return typedQuoteService({
      endpoint: "/api/swap-quotes",
      chainId,
      permit2: robinhoodMainnetUniswap.permit2,
      universalRouter: robinhoodMainnetUniswap.universalRouter,
    });
  }
  if (chainId === 46630) {
    return typedQuoteService({
      endpoint: "/api/swap-quotes",
      chainId,
      entryRouter: robinhoodTestnetAddresses.entryRouter,
      adapter: robinhoodTestnetAddresses.uniswapV3Adapter,
      swapRouter02: testnetVenue.swapRouter02,
    });
  }
  return unavailableQuoteService;
}
