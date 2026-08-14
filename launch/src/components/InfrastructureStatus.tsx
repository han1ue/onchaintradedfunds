"use client";

import { useEffect, useState } from "react";

type State = "checking" | "connected" | "unavailable";
type Health = { database: boolean; redis: boolean };
type CachedHealth = Health & { checkedAt: number };

const healthCacheKey = "otf-launch.infrastructure-health.v1";
const healthCacheTtlMs = 60_000;

function readCachedHealth(): CachedHealth | null {
  try {
    const value = window.localStorage.getItem(healthCacheKey);
    if (!value) return null;
    const cached = JSON.parse(value) as Partial<CachedHealth>;
    if (typeof cached.database !== "boolean" || typeof cached.redis !== "boolean" || typeof cached.checkedAt !== "number") return null;
    return cached as CachedHealth;
  } catch {
    return null;
  }
}

function displayHealth(result: Health) {
  return {
    database: result.database ? "connected" as const : "unavailable" as const,
    redis: result.redis ? "connected" as const : "unavailable" as const,
  };
}

export function InfrastructureStatus() {
  const [health, setHealth] = useState<{ database: State; redis: State }>({
    database: "checking",
    redis: "checking",
  });

  useEffect(() => {
    const cached = readCachedHealth();
    if (cached && Date.now() - cached.checkedAt < healthCacheTtlMs) {
      setHealth(displayHealth(cached));
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);

    fetch("/api/health", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("HEALTH_CHECK_FAILED");
        return response.json() as Promise<Health>;
      })
      .then((result) => {
        setHealth(displayHealth(result));
        try {
          window.localStorage.setItem(healthCacheKey, JSON.stringify({ ...result, checkedAt: Date.now() } satisfies CachedHealth));
        } catch {
          // Storage can be unavailable in private or restricted browsing contexts.
        }
      })
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
