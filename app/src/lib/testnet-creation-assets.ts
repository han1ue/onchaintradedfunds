import legacyLiquidity from "../config/legacy-liquidity-testnet.json";
import { robinhoodChainTestnet } from "./chains";
import { creationAssetsFromApi, type CreationAssetData } from "./creation-model";

const SOURCE_CHAIN_ID = 4_663;

const assetNames: Record<string, string> = {
  AMD: "Advanced Micro Devices",
  AMZN: "Amazon",
  NFLX: "Netflix",
  PLTR: "Palantir Technologies",
  TSLA: "Tesla",
};

export const testnetCreationAssetConfigs = legacyLiquidity.testMarkets.map((market) => ({
  address: market.token,
  symbol: market.symbol,
  name: assetNames[market.symbol] ?? market.symbol,
  decimals: 18,
}));

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function assetRows(payload: unknown): Record<string, unknown>[] {
  const envelope = record(payload);
  const rows = Array.isArray(envelope?.data) ? envelope.data : Array.isArray(payload) ? payload : [];
  return rows.flatMap((value) => {
    const row = record(value);
    return row ? [row] : [];
  });
}

export function configuredTestnetCreationAssets(
  payload: unknown,
  marketCapsUsd: Readonly<Record<string, string | undefined>>,
): CreationAssetData[] {
  const rows = assetRows(payload);
  const aliasedRows = testnetCreationAssetConfigs.map((config) => {
    const direct = rows.find((row) => (
      row.chainId === robinhoodChainTestnet.id
      && typeof row.contractAddress === "string"
      && row.contractAddress.toLowerCase() === config.address.toLowerCase()
    ));
    const source = direct ?? rows.find((row) => (
      row.chainId === SOURCE_CHAIN_ID && row.symbol === config.symbol
    ));
    return {
      ...source,
      chainId: robinhoodChainTestnet.id,
      contractAddress: config.address,
      decimals: config.decimals,
      symbol: config.symbol,
      name: config.name,
      verified: true,
      marketCapUsd: typeof source?.marketCapUsd === "string"
        ? source.marketCapUsd
        : marketCapsUsd[config.symbol],
    };
  });
  return creationAssetsFromApi({ data: aliasedRows }, robinhoodChainTestnet.id);
}

function latestReportedValue(rows: unknown): string | undefined {
  if (!Array.isArray(rows)) return undefined;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = record(rows[index]);
    const reported = record(row?.reportedValue);
    const raw = reported?.raw;
    if (typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0) return raw.toString();
    if (typeof raw === "string" && /^\d+(?:\.\d+)?$/u.test(raw) && Number(raw) > 0) return raw;
  }
  return undefined;
}

export function marketCapUsdFromYahoo(payload: unknown): string | undefined {
  const result = record(payload)?.timeseries;
  const rows = Array.isArray(record(result)?.result) ? record(result)?.result as unknown[] : [];
  for (const type of ["trailingMarketCap", "quarterlyMarketCap"] as const) {
    const series = rows.map(record).find((row) => {
      const types = record(row?.meta)?.type;
      return Array.isArray(types) && types.includes(type);
    });
    const value = latestReportedValue(series?.[type]);
    if (value) return value;
  }
  return undefined;
}
