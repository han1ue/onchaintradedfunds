"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { formatCountdown } from "@/lib/countdown";

export function CompetitionCountdown({ target, currentTime, compact = false, className = "" }: {
  target: string;
  currentTime: string;
  compact?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const targetMs = useMemo(() => new Date(target).getTime(), [target]);
  const initialNowMs = useMemo(() => new Date(currentTime).getTime(), [currentTime]);
  const [nowMs, setNowMs] = useState(initialNowMs);
  const remainingMs = Math.max(0, targetMs - nowMs);
  const pendingAtRender = initialNowMs < targetMs;

  useEffect(() => {
    if (!pendingAtRender) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [pendingAtRender]);

  useEffect(() => {
    if (pendingAtRender && remainingMs === 0) router.refresh();
  }, [pendingAtRender, remainingMs, router]);

  return <span
    className={`competitionCountdown ${compact ? "compact" : "full"} ${className}`}
    role={compact ? undefined : "timer"}
    aria-label={compact ? undefined : `Voting opens in ${formatCountdown(remainingMs)}`}
  >{formatCountdown(remainingMs, compact)}</span>;
}
