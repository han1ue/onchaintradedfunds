import { zeroAddress, type Address } from "viem";
import { QUOTE_MAX_AGE_MS, type AdapterSwapLeg } from "./swap-model";
import { quoteStep } from "./quote-errors";

export type BasketPlannerRequest = {
  route: "direct" | "basket";
  chainId: number;
  caller: Address;
  input: { address: Address; decimals: number; kind: "native" | "erc20" | "otf"; isFactoryVault: boolean };
  output: { address: Address; decimals: number; kind: "native" | "erc20" | "otf"; isFactoryVault: boolean };
  inputAmountRaw: bigint;
  slippageBps: number;
  requestedAtMs: number;
};


export type BasketAsset = { address: Address; decimals: number };
export type BasketClient = {
  vaultAssets(vault: Address): Promise<readonly Address[]>;
  previewMint(vault: Address, shares: bigint): Promise<readonly bigint[]>;
  previewRedeem(vault: Address, shares: bigint, owner: Address, skipMask: bigint): Promise<readonly bigint[]>;
};
export type BasketRouteQuote = { amountIn: bigint; amountOut: bigint; legs: AdapterSwapLeg[] };
export type BasketRouteProvider = {
  quote(type: "EXACT_INPUT" | "EXACT_OUTPUT", tokenIn: Address, tokenOut: Address, amount: bigint): Promise<BasketRouteQuote>;
};
const ONE_OTF = 10n ** 18n;
const ROUTER_DEADLINE_SECONDS = 120;
export function sameAddress(left: Address, right: Address): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export function formatRaw(value: bigint, decimals: number): string {
  if (decimals === 0) return value.toString();
  const digits = value.toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, -decimals);
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function applySlippageDown(value: bigint, slippageBps: number): bigint {
  const result = value * BigInt(10_000 - slippageBps) / 10_000n;
  return result === 0n && value > 0n ? 1n : result;
}

export function applySlippageUp(value: bigint, slippageBps: number): bigint {
  return (value * BigInt(10_000 + slippageBps) + 9_999n) / 10_000n;
}

async function basketAssets(vault: Address, client: BasketClient) {
  const assets = await client.vaultAssets(vault);
  if (!assets.length || assets.length > 20 || assets.some((asset) => sameAddress(asset, zeroAddress))
    || new Set(assets.map((asset) => asset.toLowerCase())).size !== assets.length) throw new Error("Invalid basket assets.");
  return assets;
}

function validateAmounts(amounts: readonly bigint[], assets: readonly Address[]) {
  if (amounts.length !== assets.length || amounts.some((amount) => amount <= 0n)) throw new Error("Invalid basket preview.");
}

export async function planMint(vault: Address, input: BasketAsset, amountIn: bigint, routes: BasketRouteProvider, client: BasketClient) {
  const assets = await basketAssets(vault, client);
  const quoteAmounts = async (shares: bigint) => {
    const required = await client.previewMint(vault, shares);
    validateAmounts(required, assets);
    const quotes = await Promise.all(assets.map((asset, index) => sameAddress(input.address, asset)
      ? Promise.resolve({ amountIn: required[index]!, amountOut: required[index]!, legs: [] })
      : quoteStep("QUOTE_FAILED", () => routes.quote("EXACT_OUTPUT", input.address, asset, required[index]!), { tokenIn: input.address, tokenOut: asset })));
    return { spent: quotes.reduce((sum, quote) => sum + quote.amountIn, 0n), legs: quotes.flatMap((quote) => quote.legs) };
  };
  const unit = await quoteAmounts(ONE_OTF);
  if (unit.spent <= 0n) throw new Error("The basket has no quotable cost.");
  let shares = amountIn * ONE_OTF / unit.spent;
  for (let attempt = 0; attempt < 3 && shares > 0n; attempt++) {
    const plan = await quoteAmounts(shares);
    if (plan.spent <= amountIn) return { ...plan, shares, residual: amountIn - plan.spent };
    const next = shares * amountIn / plan.spent;
    shares = next < shares ? next : shares - 1n;
  }
  throw new Error("The input is too small after applying route slippage.");
}

export async function liquidationPlan(vault: Address, shares: bigint, owner: Address, output: BasketAsset, slippageBps: number, routes: BasketRouteProvider, client: BasketClient, intermediate?: Address) {
  const assets = await basketAssets(vault, client);
  const amounts = await client.previewRedeem(vault, shares, owner, 0n);
  validateAmounts(amounts, assets);
  const target = intermediate ?? output.address;
  const quotes = await Promise.all(assets.map((asset, index) => sameAddress(asset, target)
    ? Promise.resolve({ amountIn: amounts[index]!, amountOut: amounts[index]!, legs: [] })
    : quoteStep("QUOTE_FAILED", () => routes.quote("EXACT_INPUT", asset, target, amounts[index]!), { tokenIn: asset, tokenOut: target })));
  let expectedOutput = quotes.reduce((sum, quote) => sum + quote.amountOut, 0n);
  let minimumOutput = applySlippageDown(expectedOutput, slippageBps);
  const legs = quotes.flatMap((quote) => quote.legs);
  if (!sameAddress(target, output.address)) {
    const settlement = await routes.quote("EXACT_INPUT", target, output.address, expectedOutput);
    expectedOutput = settlement.amountOut;
    minimumOutput = applySlippageDown(expectedOutput, slippageBps);
    legs.push(...settlement.legs);
  }
  return { assets, amounts, sourceMinimums: amounts.map((amount) => applySlippageDown(amount, slippageBps)), expectedOutput, minimumOutput, legs };
}

function serializedLeg(leg: AdapterSwapLeg) {
  return {
    adapter: leg.adapter,
    tokenIn: leg.tokenIn,
    tokenOut: leg.tokenOut,
    amountIn: leg.amountIn.toString(),
    minAmountOut: leg.minAmountOut.toString(),
    data: leg.data,
  };
}

function serializedFunding(funding: readonly { token: Address; amount: bigint }[]) {
  return funding.map((entry) => ({ token: entry.token, amount: entry.amount.toString() }));
}

export function availableResponse(
  request: BasketPlannerRequest,
  now: number,
  expectedOutput: bigint,
  minimumOutput: bigint,
  routeLabel: string,
  execution: Record<string, unknown>,
  hops: AdapterSwapLeg["hops"],
  residualRefunds?: readonly { token: Address; amount: string; displayAmount: string }[],
) {
  return {
    status: 200,
    body: {
      state: "available",
      id: `uniswap-v3-${request.route}-${request.requestedAtMs}`,
      route: request.route,
      chainId: request.chainId,
      caller: request.caller,
      quotedAtMs: now,
      expiresAtMs: now + QUOTE_MAX_AGE_MS,
      inputAmountRaw: request.inputAmountRaw.toString(),
      outputAmount: formatRaw(expectedOutput, request.output.decimals),
      expectedOutput: formatRaw(expectedOutput, request.output.decimals),
      expectedOutputRaw: expectedOutput.toString(),
      minimumReceived: formatRaw(minimumOutput, request.output.decimals),
      minimumReceivedRaw: minimumOutput.toString(),
      routeLabel,
      hops,
      residualRefunds,
      execution,
    },
  };
}

export async function basketQuote(
  request: BasketPlannerRequest,
  client: BasketClient,
  now: number,
  router: Address,
  adapter: Address,
  routes: BasketRouteProvider,
  bridge: BasketAsset,
  liquidationIntermediate?: Address,
) {
  const deadline = BigInt(Math.floor(now / 1_000) + ROUTER_DEADLINE_SECONDS);
  const approval = { token: request.input.address, spender: router, amount: request.inputAmountRaw.toString() };
  if ((request.input.kind === "erc20" || request.input.kind === "native") && request.output.kind === "otf") {
    const nativeInput = request.input.kind === "native";
    const input = request.input;
    const plan = await planMint(request.output.address, input, request.inputAmountRaw, routes, client);
    const residuals = plan.residual > 0n ? [{ token: input.address, amount: plan.residual.toString(), displayAmount: formatRaw(plan.residual, input.decimals) }] : undefined;
    return availableResponse(request, now, plan.shares, plan.shares, "Mint basket", {
      kind: "basket-router",
      chainId: request.chainId,
      caller: request.caller,
      router,
      adapter,
      approval: nativeInput ? undefined : approval,
      nativeValue: nativeInput ? request.inputAmountRaw.toString() : "0",
      funding: serializedFunding([{ token: input.address, amount: request.inputAmountRaw }]),
      method: nativeInput ? "mintFromNative" : "mintFromToken",
      request: { inputToken: input.address, vault: request.output.address, amountIn: request.inputAmountRaw.toString(), minShares: plan.shares.toString(), deadline: deadline.toString() },
      legs: plan.legs.map(serializedLeg),
    }, plan.legs.flatMap((leg) => leg.hops), residuals);
  }
  if (request.input.kind === "otf" && (request.output.kind === "erc20" || request.output.kind === "native")) {
    const nativeOutput = request.output.kind === "native";
    const output = request.output;
    const plan = await liquidationPlan(request.input.address, request.inputAmountRaw, request.caller, output, request.slippageBps, routes, client, liquidationIntermediate);
    return availableResponse(request, now, plan.expectedOutput, plan.minimumOutput, "Burn basket", {
      kind: "basket-router",
      chainId: request.chainId,
      caller: request.caller,
      router,
      adapter,
      approval,
      nativeValue: "0",
      funding: serializedFunding(plan.assets.map((token, index) => ({ token, amount: plan.amounts[index]! }))),
      method: nativeOutput ? "redeemToNative" : "redeemToToken",
      request: { vault: request.input.address, outputToken: output.address, shares: request.inputAmountRaw.toString(), minAmountOut: plan.minimumOutput.toString(), skipMask: "0", deadline: deadline.toString() },
      minBasketAmounts: plan.sourceMinimums.map((amount) => amount.toString()),
      legs: plan.legs.map(serializedLeg),
    }, plan.legs.flatMap((leg) => leg.hops));
  }
  if (request.input.kind === "otf" && request.output.kind === "otf") {
    const usdg = bridge;
    const liquidation = await liquidationPlan(request.input.address, request.inputAmountRaw, request.caller, usdg, request.slippageBps, routes, client);
    const mint = await planMint(request.output.address, usdg, liquidation.minimumOutput, routes, client);
    const residuals = mint.residual > 0n ? [{ token: usdg.address, amount: mint.residual.toString(), displayAmount: formatRaw(mint.residual, usdg.decimals) }] : undefined;
    const legs = [...liquidation.legs, ...mint.legs];
    return availableResponse(request, now, mint.shares, mint.shares, "Burn + mint", {
      kind: "basket-router",
      chainId: request.chainId,
      caller: request.caller,
      router,
      adapter,
      approval,
      nativeValue: "0",
      funding: serializedFunding(liquidation.assets.map((token, index) => ({ token, amount: liquidation.amounts[index]! }))),
      method: "swapBasketToBasket",
      request: { sourceVault: request.input.address, targetVault: request.output.address, sharesIn: request.inputAmountRaw.toString(), minSharesOut: mint.shares.toString(), sourceSkipMask: "0", deadline: deadline.toString() },
      minBasketAmounts: liquidation.sourceMinimums.map((amount) => amount.toString()),
      legs: legs.map(serializedLeg),
    }, legs.flatMap((leg) => leg.hops), residuals);
  }
  throw new Error("Basket settlement requires at least one OTF.");
}
