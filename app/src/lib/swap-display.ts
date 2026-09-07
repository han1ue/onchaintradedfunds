import { QUOTE_MAX_AGE_MS } from "./swap-model";

export function formatSwapDisplay(value: string | undefined, digits = 8): string {
  if (value === undefined) return "—";
  return value.replace(/(-?\d+)\.(\d+)/gu, (_, whole: string, fraction: string) => {
    const truncated = fraction.slice(0, digits).replace(/0+$/u, "");
    if (whole === "0" && !truncated && /[1-9]/u.test(fraction)) return `<0.${"0".repeat(digits - 1)}1`;
    return truncated ? `${whole}.${truncated}` : whole;
  });
}

export function quoteRefreshDelay(startedAt: number | undefined, now: number): number | undefined {
  return startedAt === undefined ? undefined : Math.max(0, startedAt + QUOTE_MAX_AGE_MS - now);
}
