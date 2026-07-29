"use client";

import dynamic from "next/dynamic";

const CooldownExperience = dynamic(
  () => import("@/components/CooldownExperience").then((mod) => mod.CooldownExperience),
  {
    ssr: false,
    loading: () => (
      <div className="vaultShell">
        <section className="topBar">
          <div className="brandBlock">
            <div className="brandMark">OT</div>
            <div>
              <p className="eyebrow">Onchain Traded Funds</p>
              <h1>Loading vault console</h1>
              <div className="metaRow">
                <span>Direct RPC reads</span>
                <span>Wallet loading</span>
              </div>
            </div>
          </div>
        </section>
        <section className="overviewGrid">
          <article className="metricCard primaryMetric">
            <div className="metricLabel">Rebalance status</div>
            <strong>Loading</strong>
            <span>Checking vault cooldown</span>
          </article>
          <article className="metricCard">
            <div className="metricLabel">Rebalance cooldown</div>
            <strong>7 days</strong>
            <span>Minimum delay between portfolio changes</span>
          </article>
        </section>
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
