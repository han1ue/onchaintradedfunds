import { testnetFundAssets } from "./asset-catalog";
import { robinhoodChainTestnet } from "./chains";
import {
  creationAssetsFromApi,
  formatFixedDecimal,
  type CreationAssetData,
} from "./creation-model";
import type { Address } from "viem";

const SOURCE_CHAIN_ID = 4_663;

const assetNames: Record<string, string> = {
  AMD: "Advanced Micro Devices",
  AMZN: "Amazon",
  NFLX: "Netflix",
  PLTR: "Palantir Technologies",
  TSLA: "Tesla",
};

export const testnetCreationAssetConfigs = testnetFundAssets.map((asset) => ({
  address: asset.address,
  symbol: asset.symbol,
  name: assetNames[asset.symbol] ?? asset.name,
  decimals: asset.decimals,
}));

const WAD = 10n ** 18n;
const TESTNET_ORACLE_DECIMALS = 8;

export type YahooStockPrice = {
  priceUsd: string;
  priceUpdatedAt?: string;
};

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

export function protocolOtfCreationAsset(input: {
  address: Address;
  priceWethWad: bigint;
  ethUsdAnswer: bigint;
  totalSupply: bigint;
}): CreationAssetData | undefined {
  if (input.priceWethWad <= 0n || input.ethUsdAnswer <= 0n || input.totalSupply <= 0n) {
    return undefined;
  }
  const ethUsdWad = input.ethUsdAnswer * 10n ** BigInt(18 - TESTNET_ORACLE_DECIMALS);
  const priceUsdWad = input.priceWethWad * ethUsdWad / WAD;
  const marketCapUsdWad = input.totalSupply * priceUsdWad / WAD;
  if (priceUsdWad <= 0n || marketCapUsdWad <= 0n) return undefined;
  return {
    address: input.address,
    symbol: "OTF",
    name: "Onchain Traded Funds",
    decimals: 18,
    priceUsd: formatFixedDecimal(priceUsdWad, 18),
    marketCapUsd: formatFixedDecimal(marketCapUsdWad, 18),
    verified: true,
  };
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

export function stockPriceUsdFromYahoo(payload: unknown): YahooStockPrice | undefined {
  const chart = record(payload)?.chart;
  const results = Array.isArray(record(chart)?.result) ? record(chart)?.result as unknown[] : [];
  const meta = record(record(results[0])?.meta);
  const rawPrice = meta?.regularMarketPrice;
  const priceUsd = typeof rawPrice === "number" && Number.isFinite(rawPrice) && rawPrice > 0
    ? rawPrice.toString()
    : typeof rawPrice === "string" && /^\d+(?:\.\d+)?$/u.test(rawPrice) && Number(rawPrice) > 0
      ? rawPrice
      : undefined;
  if (!priceUsd) return undefined;
  const marketTime = meta?.regularMarketTime;
  return {
    priceUsd,
    priceUpdatedAt: Number.isSafeInteger(marketTime) && Number(marketTime) > 0
      ? new Date(Number(marketTime) * 1_000).toISOString()
      : undefined,
  };
}
