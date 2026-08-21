import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Allocation } from "@/lib/types";
import { AllocationStrip, allocationColor, summarizeAllocations } from "./AllocationStrip";

function allocations(weights: Array<[string, number]>): Allocation[] {
  return weights.map(([symbol, weightBps], index) => ({
    assetId: `asset-${index}`,
    symbol,
    name: symbol,
    weightBps,
    color: `color-${index}`,
  }));
}

describe("compact allocation summaries", () => {
  it("uses the same indexed palette for bars, legends, and allocation-table dots", () => {
    const items = allocations([["A", 5000], ["B", 5000]]).map((item) => ({ ...item, color: undefined }));
    expect(allocationColor(items[0], 0)).toBe("var(--chart-series-1)");
    expect(allocationColor(items[1], 1)).toBe("var(--chart-series-2)");
    expect(allocationColor({ ...items[1], color: "#123456" }, 1)).toBe("#123456");
  });

  it("groups a one-percent tail into Other and preserves its color", () => {
    const items = allocations([["AAOI", 5000], ["AAPL", 4900], ["A", 100]]);
    expect(summarizeAllocations(items)).toEqual([
      { key: "asset-0", symbol: "AAOI", weightBps: 5000, color: "color-0" },
      { key: "asset-1", symbol: "AAPL", weightBps: 4900, color: "color-1" },
      { key: "other", symbol: "Other", weightBps: 100, color: "color-2" },
    ]);
    const markup = renderToStaticMarkup(createElement(AllocationStrip, { allocations: items, showPercentages: true, compactSummary: true }));
    expect(markup).toContain('aria-label="AAOI 50%, AAPL 49%, A 1%"');
    expect(markup).toContain("Other");
    expect(markup).toContain("background:color-2");
    expect(markup).toContain("width:50%");
    expect(markup).toContain("width:49%");
    expect(markup).toContain("width:1%");
  });

  it("sums the small tail into Other when more than four labels would be required", () => {
    expect(summarizeAllocations(allocations([["A", 5000], ["B", 4200], ["C", 400], ["D", 300], ["E", 100]]))).toEqual([
      { key: "asset-0", symbol: "A", weightBps: 5000, color: "color-0" },
      { key: "asset-1", symbol: "B", weightBps: 4200, color: "color-1" },
      { key: "other", symbol: "Other", weightBps: 800, color: "var(--text-muted)" },
    ]);
  });

  it("keeps three major allocations individual", () => {
    expect(summarizeAllocations(allocations([["A", 3400], ["B", 3300], ["C", 3300]]))).toEqual([
      { key: "asset-0", symbol: "A", weightBps: 3400, color: "color-0" },
      { key: "asset-1", symbol: "B", weightBps: 3300, color: "color-1" },
      { key: "asset-2", symbol: "C", weightBps: 3300, color: "color-2" },
    ]);
  });

  it("groups majors beyond the four-item display limit and preserves visible portfolio order", () => {
    expect(summarizeAllocations(allocations([["A", 1500], ["B", 3000], ["C", 2000], ["D", 2500], ["E", 1000]]))).toEqual([
      { key: "asset-1", symbol: "B", weightBps: 3000, color: "color-1" },
      { key: "asset-2", symbol: "C", weightBps: 2000, color: "color-2" },
      { key: "asset-3", symbol: "D", weightBps: 2500, color: "color-3" },
      { key: "other", symbol: "Other", weightBps: 2500, color: "var(--text-muted)" },
    ]);
  });
});
