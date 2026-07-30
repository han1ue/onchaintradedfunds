"use client";

import dynamic from "next/dynamic";

const CooldownExperience = dynamic(
  () => import("@/components/CooldownExperience").then((mod) => mod.CooldownExperience),
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

export default function Home() {
  return (
    <main>
      <CooldownExperience />
    </main>
  );
}
