"use client";

import { useEffect, useState } from "react";

type State = "checking" | "connected" | "unavailable";
type Health = { database: boolean; redis: boolean };

export function InfrastructureStatus() {
  const [health, setHealth] = useState<{ database: State; redis: State }>({
    database: "checking",
    redis: "checking",
  });

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);

    fetch("/api/health", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("HEALTH_CHECK_FAILED");
        return response.json() as Promise<Health>;
      })
      .then((result) => setHealth({
        database: result.database ? "connected" : "unavailable",
        redis: result.redis ? "connected" : "unavailable",
      }))
      .catch(() => setHealth({ database: "unavailable", redis: "unavailable" }))
      .finally(() => clearTimeout(timeout));

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  return (
    <div className="infrastructureStatus" aria-label="Service status">
      <ServiceState label="Database" state={health.database} />
      <ServiceState label="Rate limiting" state={health.redis} />
    </div>
  );
}

function ServiceState({ label, state }: { label: string; state: State }) {
  return (
    <span className="serviceState" data-state={state} title={`${label}: ${state}`}>
      <span className="serviceDot" aria-hidden="true" />
      <span>{label}</span>
      <span className="srOnly"> {state}</span>
    </span>
  );
}
