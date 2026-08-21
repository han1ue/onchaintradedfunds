import React from "react";
import type { Allocation } from "@/lib/types";

const fallback = [
  "var(--chart-series-1)",
  "var(--chart-series-2)",
  "var(--chart-series-3)",
  "var(--chart-series-4)",
  "var(--chart-series-5)",
  "var(--chart-series-6)",
];

const COMPACT_MAJOR_MIN_WEIGHT_BPS = 500;
const COMPACT_ITEM_LIMIT = 4;

export type AllocationSummaryItem = { key: string; symbol: string; weightBps: number };

export function summarizeAllocations(allocations: Allocation[]): AllocationSummaryItem[] {
  if (allocations.length <= COMPACT_ITEM_LIMIT) return allocations.map((allocation) => ({ key: allocation.assetId, symbol: allocation.symbol, weightBps: allocation.weightBps }));
  const visibleIndexes = new Set(allocations
    .map((allocation, index) => ({ index, weightBps: allocation.weightBps }))
    .filter((allocation) => allocation.weightBps >= COMPACT_MAJOR_MIN_WEIGHT_BPS)
    .sort((left, right) => right.weightBps - left.weightBps || left.index - right.index)
    .slice(0, COMPACT_ITEM_LIMIT - 1)
    .map((allocation) => allocation.index));
  const visible = allocations.flatMap((allocation, index) => visibleIndexes.has(index)
    ? [{ key: allocation.assetId, symbol: allocation.symbol, weightBps: allocation.weightBps }]
    : []);
  const otherWeightBps = allocations.reduce((total, allocation, index) => visibleIndexes.has(index) ? total : total + allocation.weightBps, 0);
  return otherWeightBps > 0 ? [...visible, { key: "other", symbol: "Other", weightBps: otherWeightBps }] : visible;
}

export function AllocationStrip({ allocations, showLabels = true, showPercentages = false, compactSummary = false }: { allocations: Allocation[]; showLabels?: boolean; showPercentages?: boolean; compactSummary?: boolean }) {
  const summary = compactSummary ? summarizeAllocations(allocations) : allocations.map((allocation) => ({ key: allocation.assetId, symbol: allocation.symbol, weightBps: allocation.weightBps }));
  return <div className={`allocationVisual${compactSummary ? " allocationVisualCompact" : ""}`} role="img" aria-label={allocations.map((item) => `${item.symbol} ${item.weightBps / 100}%`).join(", ")}>
    {showLabels && !compactSummary && <div className="allocationLabels">{summary.map((item) => <span key={item.key} style={{ width: `${item.weightBps / 100}%` }}>{item.symbol}</span>)}</div>}
    <div className="allocationStrip" aria-hidden="true">{allocations.map((item, index) => <span key={item.assetId} style={{ width: `${item.weightBps / 100}%`, background: item.color ?? fallback[index % fallback.length] }} />)}</div>
    {compactSummary && showLabels && <div className="allocationCompactLegend">{summary.map((item) => <span key={item.key}><strong>{item.symbol}</strong>{showPercentages && <small>{item.weightBps / 100}%</small>}</span>)}</div>}
    {showPercentages && !compactSummary && <div className="allocationLabels percentages">{summary.map((item) => <span key={item.key} style={{ width: `${item.weightBps / 100}%` }}>{item.weightBps / 100}%</span>)}</div>}
  </div>;
}
