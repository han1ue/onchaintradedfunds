import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Allocation } from "@/lib/types";
import { AllocationStrip, summarizeAllocations } from "./AllocationStrip";

function allocations(weights: Array<[string, number]>): Allocation[] {
  return weights.map(([symbol, weightBps], index) => ({
    assetId: `asset-${index}`,
    symbol,
    name: symbol,
    weightBps,
  }));
}

describe("compact allocation summaries", () => {
  it("shows a one-percent tail by name when the complete legend fits", () => {
    const items = allocations([["AAOI", 5000], ["AAPL", 4900], ["A", 100]]);
    expect(summarizeAllocations(items)).toEqual([
      { key: "asset-0", symbol: "AAOI", weightBps: 5000 },
      { key: "asset-1", symbol: "AAPL", weightBps: 4900 },
      { key: "asset-2", symbol: "A", weightBps: 100 },
    ]);
    const markup = renderToStaticMarkup(createElement(AllocationStrip, { allocations: items, showPercentages: true, compactSummary: true }));
    expect(markup).toContain('aria-label="AAOI 50%, AAPL 49%, A 1%"');
    expect(markup).toContain("width:1%");
    expect(markup.match(/background:var\(--chart-series-/g)).toHaveLength(3);
  });

  it("sums the small tail into Other when more than four labels would be required", () => {
    expect(summarizeAllocations(allocations([["A", 5000], ["B", 4200], ["C", 400], ["D", 300], ["E", 100]]))).toEqual([
      { key: "asset-0", symbol: "A", weightBps: 5000 },
      { key: "asset-1", symbol: "B", weightBps: 4200 },
      { key: "other", symbol: "Other", weightBps: 800 },
    ]);
  });

  it("keeps four allocations individual regardless of their size", () => {
    expect(summarizeAllocations(allocations([["A", 9400], ["B", 400], ["C", 100], ["D", 100]]))).toHaveLength(4);
  });

  it("groups majors beyond the four-item display limit and preserves visible portfolio order", () => {
    expect(summarizeAllocations(allocations([["A", 1500], ["B", 3000], ["C", 2000], ["D", 2500], ["E", 1000]]))).toEqual([
      { key: "asset-1", symbol: "B", weightBps: 3000 },
      { key: "asset-2", symbol: "C", weightBps: 2000 },
      { key: "asset-3", symbol: "D", weightBps: 2500 },
      { key: "other", symbol: "Other", weightBps: 2500 },
    ]);
  });
});
