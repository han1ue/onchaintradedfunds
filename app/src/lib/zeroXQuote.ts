import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";

export type ZeroXQuoteRequest = {
  sellToken: Address;
  buyToken: Address;
  sellAmount?: bigint;
  buyAmount?: bigint;
  txOrigin: Address;
  slippageBps: number;
};

export type ZeroXFirmQuote = {
  venue: "0x";
  adapter: Address;
  sellToken: Address;
  buyToken: Address;
  sellAmount: bigint;
  buyAmount: bigint;
  minBuyAmount?: bigint;
  maxSellAmount?: bigint;
  transactionData: Hex;
};

type SerializedZeroXFirmQuote = Omit<
  ZeroXFirmQuote,
  "sellAmount" | "buyAmount" | "minBuyAmount" | "maxSellAmount"
> & {
  sellAmount: string;
  buyAmount: string;
  minBuyAmount?: string;
  maxSellAmount?: string;
};

export async function fetchZeroXFirmQuote(
  request: ZeroXQuoteRequest,
  signal?: AbortSignal,
): Promise<ZeroXFirmQuote> {
  const response = await fetch("/api/quotes/zerox", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sellToken: request.sellToken,
      buyToken: request.buyToken,
      ...(request.sellAmount !== undefined ? { sellAmount: request.sellAmount.toString() } : {}),
      ...(request.buyAmount !== undefined ? { buyAmount: request.buyAmount.toString() } : {}),
      txOrigin: request.txOrigin,
      slippageBps: request.slippageBps,
    }),
    cache: "no-store",
    signal,
  });
  const payload = await response.json().catch(() => undefined) as
    | (SerializedZeroXFirmQuote & { error?: string })
    | undefined;
  if (!response.ok) {
    throw new Error(payload?.error ?? `0x quote request failed with HTTP ${response.status}.`);
  }
  if (
    !payload || payload.venue !== "0x" || !isAddress(payload.adapter)
      || !isAddress(payload.sellToken) || !isAddress(payload.buyToken)
      || !isHex(payload.transactionData)
  ) {
    throw new Error("The 0x quote service returned an invalid response.");
  }
  return {
    venue: "0x",
    adapter: getAddress(payload.adapter),
    sellToken: getAddress(payload.sellToken),
    buyToken: getAddress(payload.buyToken),
    sellAmount: BigInt(payload.sellAmount),
    buyAmount: BigInt(payload.buyAmount),
    ...(payload.minBuyAmount !== undefined ? { minBuyAmount: BigInt(payload.minBuyAmount) } : {}),
    ...(payload.maxSellAmount !== undefined
      ? { maxSellAmount: BigInt(payload.maxSellAmount) }
      : {}),
    transactionData: payload.transactionData,
  };
}
