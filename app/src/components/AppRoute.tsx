"use client";

import dynamic from "next/dynamic";
import type { OperateView } from "./OperateExperience";

const OperateExperience = dynamic(
  () => import("./OperateExperience").then((mod) => mod.OperateExperience),
  {
    ssr: false,
    loading: () => (
      <div className="landingLoading" role="status" aria-label="Loading Onchain Traded Funds">
        <span>OTF</span>
        <strong>Onchain Traded Funds</strong>
      </div>
    ),
  },
);

export function AppRoute({ initialView }: { initialView: OperateView }) {
  return <OperateExperience initialView={initialView} />;
}
