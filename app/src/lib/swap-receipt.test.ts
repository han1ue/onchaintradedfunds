import { encodeAbiParameters, encodeEventTopics, parseUnits, zeroAddress, type Address, type Hex } from "viem";
import { otfEntryExitRouterAbi, otfLaunchRouterAbi } from "@onchaintradedfunds/generated";
import { describe, expect, it } from "vitest";
import {
  claimSwapCelebration,
  confirmedSwapReceipt,
  fundDetailHref,
  receiptRefundDisclosure,
  type ReceiptLog,
} from "./swap-receipt";
import type { SwapAsset } from "./swap-model";

const OWNER = "0x00000000000000000000000000000000000000a1" as Address;
const ROUTER = "0x00000000000000000000000000000000000000b1" as Address;
const USDC = asset("0x0000000000000000000000000000000000000001", "USDC", 6);
const TECH = asset("0x0000000000000000000000000000000000000002", "TECH", 18, true);
const NEXT = asset("0x0000000000000000000000000000000000000003", "NEXT", 18, true);
const AMZN = asset("0x0000000000000000000000000000000000000004", "AMZN", 18);
const NVDA = asset("0x0000000000000000000000000000000000000005", "NVDA", 18);
const HASH = `0x${"12".repeat(32)}` as Hex;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as Hex;

function asset(address: Address, symbol: string, decimals: number, otf = false): SwapAsset {
  return { address, symbol, name: symbol, decimals, kind: otf ? "otf" : "erc20", isFactoryVault: otf, metadataResolved: true };
}

function topic(address: Address): Hex {
  return `0x${address.slice(2).padStart(64, "0")}` as Hex;
}

function transfer(token: Address, from: Address, to: Address, value: bigint): ReceiptLog {
  return {
    address: token,
    topics: [TRANSFER_TOPIC, topic(from), topic(to)],
    data: `0x${value.toString(16).padStart(64, "0")}` as Hex,
  };
}

function receipt(pair: { input: SwapAsset; output: SwapAsset }, logs: ReceiptLog[], status: "pending" | "success" | "reverted" = "success", overrides: Partial<Parameters<typeof confirmedSwapReceipt>[0]> = {}) {
  return confirmedSwapReceipt({
    status,
    hash: HASH,
    chainId: 46630,
    gasUsed: 2_357_790n,
    effectiveGasPrice: 100_000_000n,
    owner: OWNER,
    pair,
    logs,
    knownAssets: [USDC, TECH, NEXT, AMZN, NVDA],
    refundSender: ROUTER,
    ...overrides,
  });
}

describe("confirmed swap receipt", () => {
  const ETH: SwapAsset = { ...USDC, address: zeroAddress, kind: "native", symbol: "ETH", decimals: 18 };

  it("shows native ETH paid separately from gas", () => {
    const result = receipt({ input: ETH, output: TECH }, [transfer(TECH.address, zeroAddress, OWNER, 1n)], "success", { transactionValue: parseUnits("0.01", 18) });
    expect(result?.sold?.displayAmount).toBe("0.01");
    expect(result?.sold?.symbol).toBe("ETH");
  });

  it("deducts confirmed native refunds from the payment and ignores unrelated emitters", () => {
    const log: ReceiptLog = {
      address: ROUTER,
      topics: encodeEventTopics({ abi: otfEntryExitRouterAbi, eventName: "NativeBasketMinted", args: { caller: OWNER, vault: TECH.address } }) as Hex[],
      data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], [parseUnits("0.01", 18), 1n, parseUnits("0.002", 18)]),
    };
    const logs = [transfer(TECH.address, zeroAddress, OWNER, 1n), log];
    const options = { transactionValue: parseUnits("0.01", 18), transactionTarget: ROUTER };
    expect(receipt({ input: ETH, output: TECH }, logs, "success", options)?.sold?.displayAmount).toBe("0.008");
    expect(receipt({ input: ETH, output: TECH }, logs, "success", { ...options, transactionTarget: OWNER })?.sold?.displayAmount).toBe("0.01");
  });

  it("uses the consumed native amount for a partially filled launch swap", () => {
    const token = { ...TECH, kind: "erc20" as const, isProtocolToken: true };
    const log: ReceiptLog = {
      address: ROUTER,
      topics: encodeEventTopics({ abi: otfLaunchRouterAbi, eventName: "BootstrapSwap", args: { payer: OWNER, recipient: OWNER, buyOtf: true } }) as Hex[],
      data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [parseUnits("0.007", 18), 1n]),
    };
    expect(receipt({ input: ETH, output: token }, [transfer(token.address, zeroAddress, OWNER, 1n), log], "success", { transactionValue: parseUnits("0.01", 18), transactionTarget: ROUTER })?.sold?.displayAmount).toBe("0.007");
  });

  it("shows the ERC-20 payment net of returned input", () => {
    const result = receipt({ input: USDC, output: TECH }, [transfer(USDC.address, OWNER, ROUTER, 10_000_000n), transfer(USDC.address, ROUTER, OWNER, 1_000_000n), transfer(TECH.address, zeroAddress, OWNER, 1n)]);
    expect(result?.sold?.displayAmount).toBe("9");
  });

  it("calculates the paid gas fee from confirmed gas usage and effective price", () => {
    const result = receipt({ input: USDC, output: TECH }, [transfer(TECH.address, zeroAddress, OWNER, 1n)]);
    expect(result).toMatchObject({ chainId: 46630, gasUsed: 2_357_790n, gasFee: 235_779_000_000_000n });
  });

  it("shows actual Asset to OTF output with multiple constituent returns", () => {
    const result = receipt({ input: USDC, output: TECH }, [
      transfer(TECH.address, zeroAddress, OWNER, parseUnits("12.42", 18)),
      transfer(AMZN.address, ROUTER, OWNER, parseUnits("10", 18)),
      transfer(NVDA.address, ROUTER, OWNER, parseUnits("5", 18)),
      transfer(USDC.address, ROUTER, OWNER, parseUnits("1", 6)),
    ]);
    expect(result).toMatchObject({ direction: "asset-to-otf", fundHref: `/funds/${TECH.address}` });
    expect(result?.received.displayAmount).toBe("12.42");
    expect(result?.refunds.map((item) => `${item.displayAmount} ${item.symbol}`)).toEqual(["10 AMZN", "5 NVDA"]);
  });

  it("omits the return section data when Asset to OTF has no extras", () => {
    const result = receipt({ input: USDC, output: TECH }, [
      transfer(TECH.address, zeroAddress, OWNER, parseUnits("12.42", 18)),
    ]);
    expect(result?.refunds).toEqual([]);
  });

  it("shows actual OTF sold and asset received amounts", () => {
    const result = receipt({ input: TECH, output: USDC }, [
      transfer(TECH.address, OWNER, zeroAddress, parseUnits("12.42", 18)),
      transfer(USDC.address, ROUTER, OWNER, parseUnits("504.81", 6)),
    ]);
    expect(result).toMatchObject({ direction: "otf-to-asset", fundHref: `/funds/${TECH.address}` });
    expect(result?.sold?.displayAmount).toBe("12.42");
    expect(result?.received.displayAmount).toBe("504.81");
  });

  it("shows both confirmed OTF amounts and links to the destination OTF", () => {
    const result = receipt({ input: TECH, output: NEXT }, [
      transfer(TECH.address, OWNER, zeroAddress, parseUnits("12.42", 18)),
      transfer(NEXT.address, zeroAddress, OWNER, parseUnits("9.75", 18)),
    ]);
    expect(result).toMatchObject({ direction: "otf-to-otf", fundHref: `/funds/${NEXT.address}` });
    expect(result?.sold?.displayAmount).toBe("12.42");
    expect(result?.received.displayAmount).toBe("9.75");
  });

  it("uses the protocol-token detail route and does not create a receipt before confirmation", () => {
    expect(fundDetailHref({ ...TECH, kind: "erc20", isFactoryVault: false, isProtocolToken: true })).toBe("/token");
    expect(receipt({ input: USDC, output: TECH }, [transfer(TECH.address, zeroAddress, OWNER, 1n)], "pending")).toBeUndefined();
  });

  it("caps the initial return list and reveals the remainder compactly", () => {
    const refunds = Array.from({ length: 20 }, (_, index) => ({
      address: AMZN.address,
      symbol: `T${index}`,
      decimals: 18,
      amount: BigInt(index + 1),
      displayAmount: String(index + 1),
    }));
    expect(receiptRefundDisclosure(refunds, false)).toMatchObject({ hiddenCount: 16, visible: refunds.slice(0, 4) });
    expect(receiptRefundDisclosure(refunds, true)).toEqual({ hiddenCount: 0, visible: refunds });
  });

  it("claims confetti once and never claims it with reduced motion", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const seen = new Set<string>();
    expect(claimSwapCelebration(HASH, false, seen, storage)).toBe(true);
    expect(claimSwapCelebration(HASH, false, seen, storage)).toBe(false);
    expect(claimSwapCelebration(`0x${"34".repeat(32)}` as Hex, true, seen, storage)).toBe(false);
  });
});
