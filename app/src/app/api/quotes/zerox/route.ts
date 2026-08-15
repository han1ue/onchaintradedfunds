import { NextResponse } from "next/server";
import { getAddress, isAddress, isAddressEqual, isHex, type Address } from "viem";
import deployment from "@/config/robinhood-testnet.json";
import { robinhoodTestnetAddresses, robinhoodZeroXVenue } from "@/lib/deployment";

export const dynamic = "force-dynamic";

type QuoteBody = {
  sellToken?: unknown;
  buyToken?: unknown;
  sellAmount?: unknown;
  buyAmount?: unknown;
  txOrigin?: unknown;
  slippageBps?: unknown;
};

type ZeroXResponse = {
  liquidityAvailable?: boolean;
  mode?: string;
  sellToken?: string;
  buyToken?: string;
  sellAmount?: string;
  buyAmount?: string;
  minBuyAmount?: string;
  maxSellAmount?: string;
  allowanceTarget?: string;
  issues?: { allowance?: { spender?: string } };
  transaction?: { to?: string; data?: string; value?: string };
  reason?: string;
  message?: string;
};

function positiveInteger(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value)) return undefined;
  return value;
}

function validAddress(value: unknown): value is Address {
  return typeof value === "string" && isAddress(value);
}

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const apiKey = process.env.ZEROX_API_KEY?.trim();
  const adapter = robinhoodTestnetAddresses.zeroXSwapAdapter;
  const {
    swapTarget,
    allowanceTarget,
    settlementToken,
    apiVersion,
    approvalFlow,
  } = robinhoodZeroXVenue;
  if (!apiKey || !adapter || !swapTarget || !allowanceTarget || !settlementToken) {
    return error("0x firm quoting is not configured for this deployment.", 503);
  }
  if (apiVersion !== "v2" || approvalFlow !== "allowance-holder") {
    return error("The configured 0x venue is not Swap API v2 AllowanceHolder.", 503);
  }

  let body: QuoteBody;
  try {
    body = await request.json() as QuoteBody;
  } catch {
    return error("The quote request body must be valid JSON.", 400);
  }
  if (
    !validAddress(body.sellToken) || !validAddress(body.buyToken) || !validAddress(body.txOrigin)
      || isAddressEqual(body.sellToken, body.buyToken)
  ) {
    return error("sellToken, buyToken, and txOrigin must be valid distinct EVM addresses.", 400);
  }
  const sellAmount = positiveInteger(body.sellAmount);
  const buyAmount = positiveInteger(body.buyAmount);
  if ((sellAmount === undefined) === (buyAmount === undefined)) {
    return error("Provide exactly one positive sellAmount or buyAmount.", 400);
  }
  const slippageBps = Number(body.slippageBps);
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 2_000) {
    return error("slippageBps must be an integer from 0 through 2000.", 400);
  }

  const sellToken = getAddress(body.sellToken);
  const buyToken = getAddress(body.buyToken);
  const txOrigin = getAddress(body.txOrigin);
  if (buyAmount !== undefined && !isAddressEqual(sellToken, settlementToken)) {
    return error("Exact-output 0x quotes must sell the adapter's settlement token.", 400);
  }
  const params = new URLSearchParams({
    chainId: String(deployment.chainId),
    sellToken,
    buyToken,
    taker: adapter,
    recipient: adapter,
    txOrigin,
    slippageBps: String(slippageBps),
    ...(sellAmount !== undefined ? { sellAmount } : { buyAmount: buyAmount as string }),
  });

  let response: Response;
  try {
    response = await fetch(`https://api.0x.org/swap/allowance-holder/quote?${params}`, {
      headers: { "0x-api-key": apiKey, "0x-version": "v2" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return error("The 0x quote service did not respond in time.", 504);
  }
  const quote = await response.json().catch(() => undefined) as ZeroXResponse | undefined;
  if (!response.ok || !quote) {
    return error(quote?.reason ?? quote?.message ?? "0x rejected the firm quote request.", 502);
  }
  if (!quote.liquidityAvailable) return error("0x reported no executable liquidity.", 422);
  if (
    !quote.sellToken || !quote.buyToken || !isAddress(quote.sellToken) || !isAddress(quote.buyToken)
      || !isAddressEqual(quote.sellToken, sellToken) || !isAddressEqual(quote.buyToken, buyToken)
  ) {
    return error("0x returned different trade tokens than requested.", 502);
  }
  if (
    !quote.allowanceTarget || !isAddress(quote.allowanceTarget)
      || !isAddressEqual(quote.allowanceTarget, allowanceTarget)
  ) {
    return error("0x returned an unexpected allowance target.", 502);
  }
  const issueSpender = quote.issues?.allowance?.spender;
  if (issueSpender && (!isAddress(issueSpender) || !isAddressEqual(issueSpender, allowanceTarget))) {
    return error("0x returned an unexpected allowance spender.", 502);
  }
  if (
    !quote.transaction?.to || !isAddress(quote.transaction.to)
      || !isAddressEqual(quote.transaction.to, swapTarget)
  ) {
    return error("0x returned an unexpected swap entry point.", 502);
  }
  if (!quote.transaction.data || !isHex(quote.transaction.data) || quote.transaction.data === "0x") {
    return error("0x returned invalid transaction calldata.", 502);
  }
  const transactionValue = quote.transaction.value ?? "0";
  if (!/^[0-9]+$/u.test(transactionValue)) {
    return error("0x returned an invalid native transaction value.", 502);
  }
  if (BigInt(transactionValue) !== 0n) {
    return error("Native-value 0x swaps are not supported by this ERC-20 adapter.", 422);
  }

  const returnedSellAmount = positiveInteger(quote.sellAmount);
  const returnedBuyAmount = positiveInteger(quote.buyAmount);
  if (!returnedSellAmount || !returnedBuyAmount) {
    return error("0x returned invalid trade amounts.", 502);
  }
  if (sellAmount !== undefined) {
    const minimumBuyAmount = positiveInteger(quote.minBuyAmount);
    if (
      (quote.mode !== undefined && quote.mode !== "exact-in")
        || returnedSellAmount !== sellAmount || !minimumBuyAmount
        || BigInt(minimumBuyAmount) > BigInt(returnedBuyAmount)
    ) {
      return error("0x returned an invalid exact-input quote.", 502);
    }
  } else {
    const maximumSellAmount = positiveInteger(quote.maxSellAmount);
    if (
      (quote.mode !== undefined && quote.mode !== "exact-out")
        || returnedBuyAmount !== buyAmount || !maximumSellAmount
        || BigInt(maximumSellAmount) < BigInt(returnedSellAmount)
    ) {
      return error("0x returned an invalid exact-output quote.", 502);
    }
  }

  return NextResponse.json({
    venue: "0x",
    adapter,
    sellToken,
    buyToken,
    sellAmount: returnedSellAmount,
    buyAmount: returnedBuyAmount,
    ...(quote.minBuyAmount ? { minBuyAmount: quote.minBuyAmount } : {}),
    ...(quote.maxSellAmount ? { maxSellAmount: quote.maxSellAmount } : {}),
    transactionData: quote.transaction.data,
  }, { headers: { "cache-control": "no-store" } });
}
