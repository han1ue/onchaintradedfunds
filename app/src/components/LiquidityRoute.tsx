"use client";

import dynamic from "next/dynamic";

const LiquidityExperience = dynamic(
  () => import("./LiquidityManager").then((module) => module.LiquidityManager),
  {
    ssr: false,
    loading: () => (
      <div className="landingLoading" role="status" aria-label="Loading liquidity manager">
        <span>OTF</span>
        <strong>Loading liquidity manager</strong>
      </div>
    ),
  },
);

export function LiquidityRoute() {
  return <LiquidityExperience />;
}
