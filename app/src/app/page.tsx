"use client";

import dynamic from "next/dynamic";

const CooldownExperience = dynamic(
  () => import("@/components/CooldownExperience").then((mod) => mod.CooldownExperience),
  {
    ssr: false,
    loading: () => (
      <section className="cooldownPanel">
        <p className="eyebrow">Vault Controls</p>
        <h1>Onchain Traded Funds</h1>
        <dl className="cooldownGrid">
          <div>
            <dt>Rebalance cooldown:</dt>
            <dd>7 days</dd>
          </div>
          <div>
            <dt>Last portfolio change:</dt>
            <dd>Loading</dd>
          </div>
          <div>
            <dt>Next portfolio change available:</dt>
            <dd>Loading</dd>
          </div>
        </dl>
      </section>
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
