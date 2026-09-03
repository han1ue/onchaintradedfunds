"use client";

import { SwapReceiptPanel } from "@/components/OperateExperience";
import type { SwapReceipt } from "@/lib/swap-receipt";

const receipt = {
  hash: `0x${"12".repeat(32)}`,
  direction: "otf-to-otf",
  input: { address: "0x0000000000000000000000000000000000000001", symbol: "GROW", name: "Growth OTF", kind: "otf", decimals: 18, metadataResolved: true, isFactoryVault: true },
  output: { address: "0x0000000000000000000000000000000000000002", symbol: "TECH", name: "Technology OTF", kind: "otf", decimals: 18, metadataResolved: true, isFactoryVault: true },
  sold: { address: "0x0000000000000000000000000000000000000001", symbol: "GROW", decimals: 18, amount: 12420000000000000000n, displayAmount: "12.42" },
  received: { address: "0x0000000000000000000000000000000000000002", symbol: "TECH", decimals: 18, amount: 9750000000000000000n, displayAmount: "9.75" },
  refunds: [
    { address: "0x0000000000000000000000000000000000000010", symbol: "AMZN", decimals: 18, amount: 10000000000000000000n, displayAmount: "10" },
    { address: "0x0000000000000000000000000000000000000011", symbol: "NVDA", decimals: 18, amount: 5000000000000000000n, displayAmount: "5" },
    { address: "0x0000000000000000000000000000000000000012", symbol: "MSFT", decimals: 18, amount: 3250000000000000000n, displayAmount: "3.25" },
    { address: "0x0000000000000000000000000000000000000013", symbol: "AAPL", decimals: 18, amount: 2000000000000000000n, displayAmount: "2" },
    { address: "0x0000000000000000000000000000000000000014", symbol: "META", decimals: 18, amount: 1500000000000000000n, displayAmount: "1.5" },
  ],
  fund: { address: "0x0000000000000000000000000000000000000002", symbol: "TECH", name: "Technology OTF", kind: "otf", decimals: 18, metadataResolved: true, isFactoryVault: true },
  fundHref: "/funds/0x0000000000000000000000000000000000000002",
} satisfies SwapReceipt;

export default function ReceiptPreview() {
  return <main className="swapMain"><section className="swapCard showReceipt"><div className="swapCardStage"><div className="swapCardPane swapReceiptPane"><SwapReceiptPanel receipt={receipt} onBack={() => undefined} /></div></div></section></main>;
}
