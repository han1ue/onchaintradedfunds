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

export type AllocationSummaryItem = { key: string; symbol: string; weightBps: number; color: string };

export function allocationColor(allocation: Allocation, index: number): string {
  return allocation.color ?? fallback[index % fallback.length];
}

export function summarizeAllocations(allocations: Allocation[]): AllocationSummaryItem[] {
  const normalized = allocations.map((allocation, index) => ({
    key: allocation.assetId,
    symbol: allocation.symbol,
    weightBps: allocation.weightBps,
    color: allocationColor(allocation, index),
    index,
  }));
  const visibleIndexes = new Set(normalized
    .filter((allocation) => allocation.weightBps >= COMPACT_MAJOR_MIN_WEIGHT_BPS)
    .sort((left, right) => right.weightBps - left.weightBps || left.index - right.index)
    .slice(0, COMPACT_ITEM_LIMIT - 1)
    .map((allocation) => allocation.index));
  const visible = normalized.flatMap((allocation) => visibleIndexes.has(allocation.index)
    ? [{ key: allocation.key, symbol: allocation.symbol, weightBps: allocation.weightBps, color: allocation.color }]
    : []);
  const hidden = normalized.filter((allocation) => !visibleIndexes.has(allocation.index));
  const otherWeightBps = hidden.reduce((total, allocation) => total + allocation.weightBps, 0);
  return otherWeightBps > 0
    ? [...visible, {
      key: "other",
      symbol: "Other",
      weightBps: otherWeightBps,
      color: hidden.length === 1 ? hidden[0].color : "var(--text-muted)",
    }]
    : visible;
}

export function AllocationStrip({ allocations, showLabels = true, showPercentages = false, compactSummary = false }: { allocations: Allocation[]; showLabels?: boolean; showPercentages?: boolean; compactSummary?: boolean }) {
  const summary = compactSummary ? summarizeAllocations(allocations) : allocations.map((allocation, index) => ({ key: allocation.assetId, symbol: allocation.symbol, weightBps: allocation.weightBps, color: allocationColor(allocation, index) }));
  return <div className={`allocationVisual${compactSummary ? " allocationVisualCompact" : ""}`} role="img" aria-label={allocations.map((item) => `${item.symbol} ${item.weightBps / 100}%`).join(", ")}>
    {showLabels && !compactSummary && <div className="allocationLabels">{summary.map((item) => <span key={item.key} style={{ width: `${item.weightBps / 100}%` }}>{item.symbol}</span>)}</div>}
    <div className="allocationStrip" aria-hidden="true">{allocations.map((item, index) => <span key={item.assetId} style={{ width: `${item.weightBps / 100}%`, background: allocationColor(item, index) }} />)}</div>
    {compactSummary && showLabels && <div className="allocationCompactLegend">{summary.map((item) => <span key={item.key}><i aria-hidden="true" style={{ background: item.color }} /><strong>{item.symbol}</strong>{showPercentages && <small>{item.weightBps / 100}%</small>}</span>)}</div>}
    {showPercentages && !compactSummary && <div className="allocationLabels percentages">{summary.map((item) => <span key={item.key} style={{ width: `${item.weightBps / 100}%` }}>{item.weightBps / 100}%</span>)}</div>}
  </div>;
}
