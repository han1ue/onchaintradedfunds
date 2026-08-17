"use client";

import { ChartNoAxesCombined } from "lucide-react";
import { useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { PortfolioReturns } from "@/lib/types";

const width = 720;
const height = 238;
const padding = { top: 18, right: 14, bottom: 30, left: 52 };

function formatReturn(value: number) {
  if (Math.abs(value) < 0.005) return "0.00%";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatDate(timestamp: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(timestamp));
}

function formatDateTime(timestamp: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short",
  }).format(new Date(timestamp));
}

export function PortfolioReturnsChart({ returns, preview = false }: { returns: PortfolioReturns; preview?: boolean }) {
  const { points } = returns;
  const [activeIndex, setActiveIndex] = useState(Math.max(0, points.length - 1));
  const layout = useMemo(() => {
    if (points.length < 2) return null;
    const timestamps = points.map((point) => new Date(point.timestamp).getTime());
    const start = timestamps[0];
    const end = timestamps[timestamps.length - 1];
    const observedMin = Math.min(0, ...points.map((point) => point.returnPct));
    const observedMax = Math.max(0, ...points.map((point) => point.returnPct));
    const yPadding = Math.max((observedMax - observedMin) * 0.18, 0.35);
    const min = observedMin - yPadding;
    const max = observedMax + yPadding;
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const x = (timestamp: number) => padding.left + ((timestamp - start) / Math.max(1, end - start)) * plotWidth;
    const y = (value: number) => padding.top + ((max - value) / (max - min)) * plotHeight;
    const plotted = points.map((point, index) => ({ ...point, x: x(timestamps[index]), y: y(point.returnPct) }));
    const linePath = plotted.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
    const zeroY = y(0);
    const areaPath = `${linePath} L${plotted[plotted.length - 1].x.toFixed(2)},${zeroY.toFixed(2)} L${plotted[0].x.toFixed(2)},${zeroY.toFixed(2)} Z`;
    const grid = Array.from({ length: 5 }, (_, index) => max - (index / 4) * (max - min));
    return { start, end, min, max, plotted, linePath, areaPath, zeroY, grid };
  }, [points]);

  const resolvedIndex = Math.min(activeIndex, Math.max(0, points.length - 1));
  const active = points[resolvedIndex];
  const current = points.at(-1)?.returnPct ?? 0;
  const tone = current > 0.005 ? "positive" : current < -0.005 ? "negative" : "neutral";

  function selectFromPointer(event: PointerEvent<HTMLDivElement>) {
    if (!layout) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    const target = layout.start + ratio * (layout.end - layout.start);
    let nearest = 0;
    let distance = Number.POSITIVE_INFINITY;
    points.forEach((point, index) => {
      const nextDistance = Math.abs(new Date(point.timestamp).getTime() - target);
      if (nextDistance < distance) { nearest = index; distance = nextDistance; }
    });
    setActiveIndex(nearest);
  }

  function moveSelection(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setActiveIndex((currentIndex) => Math.min(points.length - 1, Math.max(0, currentIndex + (event.key === "ArrowLeft" ? -1 : 1))));
  }

  return <div className="portfolioReturns">
    <div className="returnsHeading">
      <div><h2>Portgolio</h2></div>
      {points.length > 1 && <div className={`returnsCurrent ${tone}`}><span>Current return</span><strong>{formatReturn(current)}</strong></div>}
    </div>
    {points.length < 2 || !layout || !active ? <div className="returnsEmpty">
      <ChartNoAxesCombined size={22} aria-hidden="true" />
      <div><strong>{points.length === 1 ? "First price checkpoint recorded" : "Return history is starting"}</strong><p>{points.length === 1 ? "The line appears after the next 30-minute price checkpoint." : "The first complete price checkpoint will establish the 0% baseline."}</p></div>
    </div> : <>
      <div
        className="returnsPlot"
        tabIndex={0}
        role="group"
        aria-label={`Portfolio return chart. Selected ${formatDateTime(active.timestamp)}, ${formatReturn(active.returnPct)}. Use left and right arrow keys to inspect observations.`}
        onPointerMove={selectFromPointer}
        onPointerLeave={() => setActiveIndex(points.length - 1)}
        onKeyDown={moveSelection}
      >
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Portfolio return from ${formatDate(points[0].timestamp)} to ${formatDate(points[points.length - 1].timestamp)}`}>
          <defs><linearGradient id="returnsArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="var(--teal)" stopOpacity=".18" /><stop offset="1" stopColor="var(--teal)" stopOpacity="0" /></linearGradient></defs>
          {layout.grid.map((value) => <g className="returnsGrid" key={value}><line x1={padding.left} x2={width - padding.right} y1={padding.top + ((layout.max - value) / (layout.max - layout.min)) * (height - padding.top - padding.bottom)} y2={padding.top + ((layout.max - value) / (layout.max - layout.min)) * (height - padding.top - padding.bottom)} /><text x={padding.left - 9} y={padding.top + ((layout.max - value) / (layout.max - layout.min)) * (height - padding.top - padding.bottom) + 3}>{formatReturn(value)}</text></g>)}
          <line className="returnsZero" x1={padding.left} x2={width - padding.right} y1={layout.zeroY} y2={layout.zeroY} />
          <path className="returnsArea" d={layout.areaPath} />
          <path className="returnsLine" d={layout.linePath} />
          <line className="returnsCrosshair" x1={layout.plotted[resolvedIndex].x} x2={layout.plotted[resolvedIndex].x} y1={padding.top} y2={height - padding.bottom} />
          <circle className="returnsPointHalo" cx={layout.plotted[resolvedIndex].x} cy={layout.plotted[resolvedIndex].y} r="7" />
          <circle className="returnsPoint" cx={layout.plotted[resolvedIndex].x} cy={layout.plotted[resolvedIndex].y} r="3.5" />
          <text className="returnsDateLabel" x={padding.left} y={height - 6} textAnchor="start">{formatDate(points[0].timestamp)}</text>
          <text className="returnsDateLabel" x={(padding.left + width - padding.right) / 2} y={height - 6} textAnchor="middle">{formatDate(points[Math.floor((points.length - 1) / 2)].timestamp)}</text>
          <text className="returnsDateLabel" x={width - padding.right} y={height - 6} textAnchor="end">{formatDate(points[points.length - 1].timestamp)}</text>
        </svg>
        <div className={`returnsTooltip ${layout.plotted[resolvedIndex].x > width * .7 ? "alignRight" : ""}`} style={{ left: `${layout.plotted[resolvedIndex].x / width * 100}%` }} aria-hidden="true"><strong>{formatReturn(active.returnPct)}</strong><span>{formatDateTime(active.timestamp)}</span></div>
      </div>
      <div className="returnsFootnote"><span>{preview ? "Preview series" : "30-minute price checkpoints"}</span><span>Baseline {formatDateTime(returns.trackingStartedAt ?? points[0].timestamp)}</span></div>
    </>}
  </div>;
}
