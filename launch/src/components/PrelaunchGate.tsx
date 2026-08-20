"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const MAX_TIMEOUT_MS = 2_147_483_647;

const competitionStartFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

export function PrelaunchGate({ startsAt }: { startsAt: string | Date }) {
  const startTime = new Date(startsAt).getTime();
  const start = new Date(startTime);
  const router = useRouter();

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;

    function refreshAtStart() {
      const remainingMs = startTime - Date.now();
      if (remainingMs <= 0) {
        router.refresh();
        return;
      }
      timeout = setTimeout(refreshAtStart, Math.min(remainingMs, MAX_TIMEOUT_MS));
    }

    refreshAtStart();
    return () => clearTimeout(timeout);
  }, [router, startTime]);

  return <main className="prelaunchGate">
    <h1>The competition starts <time dateTime={start.toISOString()}>{competitionStartFormatter.format(start)}</time>.</h1>
  </main>;
}
