"use client";

import dynamic from "next/dynamic";

const CooldownExperience = dynamic(
  () => import("@/components/CooldownExperience").then((mod) => mod.CooldownExperience),
  {
    ssr: false,
    loading: () => (
      <div className="otfAppShell">
        <main className="dashboardMain">
          <section className="vaultHeader">
            <div className="vaultTitleRow">
              <div>
                <div className="titleLine">
                  <h1>Loading vault console</h1>
                  <span className="symbolBadge">OTF</span>
                </div>
                <div className="addressLine">
                  <span className="addressPill">Direct RPC reads</span>
                  <span className="addressPill">Wallet loading</span>
                </div>
              </div>
            </div>
            <div className="metricGrid">
              <article className="metricCard warning">
                <div className="metricLabel">Rebalance</div>
                <strong>Loading</strong>
                <span>Checking vault cooldown</span>
              </article>
              <article className="metricCard">
                <div className="metricLabel">Cooldown</div>
                <strong>7 days</strong>
                <span>Minimum delay between portfolio changes</span>
              </article>
            </div>
          </section>
        </main>
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
