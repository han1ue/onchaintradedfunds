"use client";

import { Providers } from "@/app/providers";
import { RebalanceCooldownPanel } from "./RebalanceCooldownPanel";

export function CooldownExperience() {
  return (
    <Providers>
      <RebalanceCooldownPanel />
    </Providers>
  );
}

