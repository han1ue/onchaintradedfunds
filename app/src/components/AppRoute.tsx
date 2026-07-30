"use client";

import dynamic from "next/dynamic";
import type { AppView } from "./RebalanceCooldownPanel";

const CooldownExperience = dynamic(
  () => import("./CooldownExperience").then((mod) => mod.CooldownExperience),
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

export function AppRoute({ initialView }: { initialView: AppView }) {
  return (
    <main>
      <CooldownExperience initialView={initialView} />
    </main>
  );
}
