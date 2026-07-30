"use client";

import { Providers } from "@/app/providers";
import { type AppView, RebalanceCooldownPanel } from "./RebalanceCooldownPanel";

export function CooldownExperience({ initialView = "landing" }: { initialView?: AppView }) {
  return (
    <Providers>
      <RebalanceCooldownPanel initialView={initialView} />
    </Providers>
  );
}
