import { QUOTE_MAX_AGE_MS, type SwapQuote } from "./swap-model";

export function formatSwapDisplay(value: string | undefined, digits = 8): string {
  if (value === undefined) return "—";
  return value.replace(/(-?\d+)\.(\d+)/gu, (_, whole: string, fraction: string) => {
    const truncated = fraction.slice(0, digits).replace(/0+$/u, "");
    if (whole === "0" && !truncated && /[1-9]/u.test(fraction)) return `<0.${"0".repeat(digits - 1)}1`;
    return truncated ? `${whole}.${truncated}` : whole;
  });
}

export function quoteRefreshDelay(quotes: readonly SwapQuote[], now: number): number | undefined {
  if (!quotes.length || quotes.some((quote) => quote.state === "loading")) return undefined;
  const deadlines = quotes.filter((quote) => quote.state === "available").map((quote) => (
    Math.min(quote.queriedAt + QUOTE_MAX_AGE_MS, quote.expiresAt ?? Infinity)
  ));
  return deadlines.length ? Math.max(1_000, Math.min(...deadlines) - now - 5_000) : 30_000;
}
