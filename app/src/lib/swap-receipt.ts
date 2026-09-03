import { formatUnits, getAddress, type Address, type Hex } from "viem";
import type { SwapAsset } from "./swap-model";

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const SWAP_RECEIPT_REFUND_PREVIEW_COUNT = 4;

export type SwapReceiptDirection = "asset-to-otf" | "otf-to-asset" | "otf-to-otf";

export type SwapReceiptTokenAmount = {
  address: Address;
  symbol: string;
  decimals: number;
  amount: bigint;
  displayAmount: string;
};

export type SwapReceipt = {
  hash: Hex;
  direction: SwapReceiptDirection;
  input: SwapAsset;
  output: SwapAsset;
  sold?: SwapReceiptTokenAmount;
  received: SwapReceiptTokenAmount;
  refunds: SwapReceiptTokenAmount[];
  fund: SwapAsset;
  fundHref: string;
};

export type ReceiptLog = {
  address: Address;
  data: Hex;
  topics: readonly Hex[];
};

type TokenFlow = {
  sent: bigint;
  received: bigint;
  receivedFromRefundSender: bigint;
};

type CelebrationStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

function isOtf(asset: SwapAsset): boolean {
  return asset.kind === "otf" || asset.isProtocolToken === true;
}

function receiptDirection(input: SwapAsset, output: SwapAsset): SwapReceiptDirection | undefined {
  const inputIsOtf = isOtf(input);
  const outputIsOtf = isOtf(output);
  if (inputIsOtf && outputIsOtf) return "otf-to-otf";
  if (inputIsOtf) return "otf-to-asset";
  if (outputIsOtf) return "asset-to-otf";
  return undefined;
}

function addressFromTopic(topic: Hex | undefined): Address | undefined {
  if (!topic || !/^0x[0-9a-f]{64}$/iu.test(topic)) return undefined;
  return getAddress(`0x${topic.slice(-40)}`);
}

function amountFromData(data: Hex): bigint | undefined {
  if (!/^0x[0-9a-f]{64}$/iu.test(data)) return undefined;
  return BigInt(data);
}

function transferFlows(logs: readonly ReceiptLog[], owner: Address, refundSender?: Address): Map<string, TokenFlow> {
  const ownerKey = owner.toLowerCase();
  const refundSenderKey = refundSender?.toLowerCase();
  const flows = new Map<string, TokenFlow>();
  for (const log of logs) {
    if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) continue;
    const from = addressFromTopic(log.topics[1]);
    const to = addressFromTopic(log.topics[2]);
    const amount = amountFromData(log.data);
    if (!from || !to || amount === undefined) continue;
    const sent = from.toLowerCase() === ownerKey;
    const received = to.toLowerCase() === ownerKey;
    if (!sent && !received) continue;
    const key = log.address.toLowerCase();
    const flow = flows.get(key) ?? { sent: 0n, received: 0n, receivedFromRefundSender: 0n };
    if (sent) flow.sent += amount;
    if (received) flow.received += amount;
    if (received && refundSenderKey && from.toLowerCase() === refundSenderKey) flow.receivedFromRefundSender += amount;
    flows.set(key, flow);
  }
  return flows;
}

function amount(asset: SwapAsset, value: bigint): SwapReceiptTokenAmount {
  return {
    address: asset.address,
    symbol: asset.symbol,
    decimals: asset.decimals,
    amount: value,
    displayAmount: formatUnits(value, asset.decimals),
  };
}

function reliableMetadata(assets: readonly SwapAsset[], address: string): SwapAsset | undefined {
  return assets.find((asset) => (
    asset.kind !== "native"
    && asset.address.toLowerCase() === address
    && asset.metadataResolved === true
    && asset.symbol.trim().length > 0
    && Number.isInteger(asset.decimals)
    && asset.decimals >= 0
    && asset.decimals <= 36
  ));
}

export function fundDetailHref(asset: SwapAsset): string {
  return asset.isProtocolToken ? "/token" : `/funds/${asset.address}`;
}

export function confirmedSwapReceipt(input: {
  status: "pending" | "success" | "reverted";
  hash: Hex;
  owner: Address;
  pair: { input: SwapAsset; output: SwapAsset };
  logs: readonly ReceiptLog[];
  knownAssets: readonly SwapAsset[];
  refundSender?: Address;
  confirmedOutputAmount?: bigint;
}): SwapReceipt | undefined {
  if (input.status !== "success") return undefined;
  const direction = receiptDirection(input.pair.input, input.pair.output);
  if (!direction) return undefined;

  const flows = transferFlows(input.logs, input.owner, input.refundSender);
  const inputFlow = flows.get(input.pair.input.address.toLowerCase());
  const outputFlow = flows.get(input.pair.output.address.toLowerCase());
  const transferredOutput = outputFlow && outputFlow.received > outputFlow.sent
    ? outputFlow.received - outputFlow.sent
    : undefined;
  const receivedValue = transferredOutput ?? (
    input.confirmedOutputAmount !== undefined && input.confirmedOutputAmount > 0n
      ? input.confirmedOutputAmount
      : undefined
  );
  if (receivedValue === undefined) return undefined;

  const soldValue = inputFlow && inputFlow.sent > inputFlow.received
    ? inputFlow.sent - inputFlow.received
    : undefined;
  if (direction !== "asset-to-otf" && soldValue === undefined) return undefined;

  const excluded = new Set([
    input.pair.input.address.toLowerCase(),
    input.pair.output.address.toLowerCase(),
  ]);
  const refunds = input.refundSender
    ? [...flows.entries()].flatMap(([tokenAddress, flow]) => {
      if (excluded.has(tokenAddress) || flow.receivedFromRefundSender <= 0n) return [];
      const asset = reliableMetadata(input.knownAssets, tokenAddress);
      return asset ? [amount(asset, flow.receivedFromRefundSender)] : [];
    })
    : [];
  const fund = direction === "otf-to-asset" ? input.pair.input : input.pair.output;

  return {
    hash: input.hash,
    direction,
    input: input.pair.input,
    output: input.pair.output,
    sold: soldValue === undefined ? undefined : amount(input.pair.input, soldValue),
    received: amount(input.pair.output, receivedValue),
    refunds,
    fund,
    fundHref: fundDetailHref(fund),
  };
}

export function receiptRefundDisclosure(refunds: readonly SwapReceiptTokenAmount[], expanded: boolean): {
  visible: readonly SwapReceiptTokenAmount[];
  hiddenCount: number;
} {
  if (expanded || refunds.length <= SWAP_RECEIPT_REFUND_PREVIEW_COUNT) return { visible: refunds, hiddenCount: 0 };
  return {
    visible: refunds.slice(0, SWAP_RECEIPT_REFUND_PREVIEW_COUNT),
    hiddenCount: refunds.length - SWAP_RECEIPT_REFUND_PREVIEW_COUNT,
  };
}

export function claimSwapCelebration(
  hash: Hex,
  reducedMotion: boolean,
  seen: Set<string>,
  storage?: CelebrationStorage,
): boolean {
  const key = `otf:swap-celebrated:${hash.toLowerCase()}`;
  if (reducedMotion || seen.has(key)) return false;
  try {
    if (storage?.getItem(key) === "1") {
      seen.add(key);
      return false;
    }
  } catch {
    // The in-memory guard still prevents repeats when storage is unavailable.
  }
  seen.add(key);
  try {
    storage?.setItem(key, "1");
  } catch {
    // Celebration must not depend on storage access.
  }
  return true;
}
