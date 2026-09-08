import { formatFixedDecimal, parseFixedDecimal } from "./creation-model";

export type PriceQuality = "fresh" | "stale" | "market_closed" | "invalid";
export function priceQuality(sourceAt: string, collectedAt: string, maxAgeSeconds: number, marketClosed = false, now = Date.now(), marketClosedMaxAgeSeconds?: number): PriceQuality {
  const source = Date.parse(sourceAt), collected = Date.parse(collectedAt);
  if (!Number.isFinite(source) || !Number.isFinite(collected) || source > collected + 30_000 || source > now + 30_000 || maxAgeSeconds <= 0) return "invalid";
  const maximum=marketClosed && marketClosedMaxAgeSeconds!==undefined?marketClosedMaxAgeSeconds:maxAgeSeconds;
  if(!Number.isFinite(maximum) || maximum<=0)return "invalid";
  if (now - source > maximum * 1000) return "stale";
  return marketClosed ? "market_closed" : "fresh";
}

export function valueHoldings(holdings: readonly { amount: bigint; decimals: number; priceUsd: string }[]): string {
  let total = 0n;
  for (const holding of holdings) {
    const price = parseFixedDecimal(holding.priceUsd, 36);
    if (!price || holding.amount < 0n || !Number.isInteger(holding.decimals) || holding.decimals < 0 || holding.decimals > 36) throw new Error("Invalid valuation input.");
    total += holding.amount * price / 10n ** BigInt(holding.decimals);
  }
  return formatFixedDecimal(total, 36);
}

export function navValues(holdings: readonly { amount: bigint; bootstrapAmount: bigint; decimals: number; priceUsd: string }[], totalSupply: bigint) {
  if (totalSupply < 0n) throw new Error("Invalid total supply.");
  const totalNavUsd = valueHoldings(holdings);
  return {
    totalNavUsd,
    navPerShareUsd: totalSupply === 0n ? null : formatFixedDecimal(parseFixedDecimal(totalNavUsd, 36)! * 10n ** 18n / totalSupply, 36),
    bootstrapNavUsd: totalSupply === 0n ? valueHoldings(holdings.map(holding => ({ ...holding, amount: holding.bootstrapAmount }))) : null,
  };
}
