import type { Allocation } from "@/lib/types";

const fallback = ["#37b7aa", "#56acd3", "#9c8be5", "#f1b93d", "#e9717e", "#2ed09a"];

export function AllocationStrip({ allocations, showPercentages = false }: { allocations: Allocation[]; showPercentages?: boolean }) {
  return <div className="allocationVisual" aria-label={allocations.map((item) => `${item.symbol} ${item.weightBps / 100}%`).join(", ")}>
    <div className="allocationLabels">{allocations.map((item) => <span key={item.assetId} style={{ width: `${item.weightBps / 100}%` }}>{item.symbol}</span>)}</div>
    <div className="allocationStrip">{allocations.map((item, index) => <span key={item.assetId} style={{ width: `${item.weightBps / 100}%`, background: item.color ?? fallback[index % fallback.length] }} />)}</div>
    {showPercentages && <div className="allocationLabels percentages">{allocations.map((item) => <span key={item.assetId} style={{ width: `${item.weightBps / 100}%` }}>{item.weightBps / 100}%</span>)}</div>}
  </div>;
}
