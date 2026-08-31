import { getAddress, isAddress, type Address, type Hex } from "viem";

export const PERCENT_DECIMALS = 18;
export const PERCENT_SCALE = 10n ** BigInt(PERCENT_DECIMALS);
export const TOTAL_PERCENT_UNITS = 100n * PERCENT_SCALE;
export const USD_DECIMALS = 18;
export const FIXED_TARGET_USD_WAD = 10n ** BigInt(USD_DECIMALS);

export function annualExpenseRatioBpsFromPercentage(value: string): number {
  if (!/^\d+(?:\.\d{0,2})?$/u.test(value)) return Number.NaN;
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export function formatAnnualExpenseRatioPercentage(bps: number): string {
  if (!Number.isInteger(bps)) return "Invalid";
  const whole = Math.floor(bps / 100);
  const fraction = String(bps % 100).padStart(2, "0").replace(/0+$/u, "");
  return `${whole}${fraction ? `.${fraction}` : ""}%`;
}

export type BasketCalculationAsset = {
  symbol: string;
  decimals: number;
  percentageUnits: bigint;
  priceUsd: string;
};

export type BasketCalculationRow = {
  rawQuantity: bigint;
  tokenQuantity: string;
  realizedPercentage: string;
  realizedPercentageUnits: bigint;
  realizedValueUsd: string;
  realizedValueUsdWad: bigint;
  allocatedUsdWad: bigint;
  minimumPercentageUnits: bigint;
  minimumPercentage: string;
};

export type BasketCalculation = {
  bootstrapBasketUnitsPerOTF: bigint[];
  rows: BasketCalculationRow[];
  targetValueUsd: string;
  realizedValueUsd: string;
};

export type CreationAssetData = {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  priceUsd: string;
  marketCapUsd: string;
  priceUpdatedAt?: string;
  verified: boolean;
};

export type PercentageSelectionCurrent = {
  key: string;
  percentageUnits: bigint;
};

export type PercentageSelectionNext = {
  key: string;
  marketCapUsd: string;
};

export type CreationSubmissionOutcome =
  | { status: "success"; hash: Hex }
  | { status: "failure"; phase: "write"; message: string }
  | { status: "failure"; phase: "receipt"; hash: Hex }
  | { status: "unknown"; hash: Hex };

export async function submitAndConfirmCreation(input: {
  write: () => Promise<Hex>;
  waitForReceipt: (hash: Hex) => Promise<"success" | "reverted">;
  onBroadcast?: (hash: Hex) => void;
}): Promise<CreationSubmissionOutcome> {
  let hash: Hex;
  try {
    hash = await input.write();
  } catch (error) {
    return {
      status: "failure",
      phase: "write",
      message: error instanceof Error ? error.message : "OTF creation was not submitted.",
    };
  }
  input.onBroadcast?.(hash);
  try {
    const receiptStatus = await input.waitForReceipt(hash);
    return receiptStatus === "success"
      ? { status: "success", hash }
      : { status: "failure", phase: "receipt", hash };
  } catch {
    return { status: "unknown", hash };
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function creationAssetsFromApi(payload: unknown, chainId: number): CreationAssetData[] {
  const envelope = record(payload);
  const rows = Array.isArray(envelope?.data) ? envelope.data : Array.isArray(payload) ? payload : [];
  return rows.flatMap((value): CreationAssetData[] => {
    const asset = record(value);
    if (
      !asset || asset.chainId !== chainId || typeof asset.contractAddress !== "string"
      || !isAddress(asset.contractAddress)
    ) return [];
    const decimals = Number(asset.decimals);
    const priceUsd = typeof asset.latestPriceUsdExact === "string"
      ? asset.latestPriceUsdExact
      : typeof asset.latestPriceUsd === "string"
        ? asset.latestPriceUsd
        : undefined;
    const marketCapUsd = typeof asset.marketCapUsd === "string" ? asset.marketCapUsd : undefined;
    if (!priceUsd || !marketCapUsd) return [];
    const parsedPrice = parseFixedDecimal(priceUsd, USD_DECIMALS);
    const parsedMarketCap = parseFixedDecimal(marketCapUsd, USD_DECIMALS);
    if (
      !Number.isInteger(decimals) || decimals < 0 || decimals > 36
      || !parsedPrice || parsedPrice <= 0n
      || !parsedMarketCap || parsedMarketCap <= 0n
    ) return [];
    return [{
      address: getAddress(asset.contractAddress),
      symbol: typeof asset.symbol === "string" && asset.symbol.trim()
        ? asset.symbol.trim().slice(0, 16)
        : "TOKEN",
      name: typeof asset.name === "string" && asset.name.trim()
        ? asset.name.trim().slice(0, 80)
        : "Unlabelled token",
      decimals,
      priceUsd,
      marketCapUsd,
      priceUpdatedAt: typeof asset.latestPriceAt === "string" ? asset.latestPriceAt : undefined,
      verified: asset.verified === true,
    }];
  });
}

export function parseFixedDecimal(value: string, decimals: number): bigint | undefined {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d*)?$/u.test(normalized)) return undefined;
  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > decimals && /[1-9]/u.test(fraction.slice(decimals))) return undefined;
  const retainedFraction = fraction.slice(0, decimals).padEnd(decimals, "0");
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(retainedFraction || "0");
}

export function formatFixedDecimal(
  value: bigint,
  decimals: number,
  options: { trim?: boolean; minimumFractionDigits?: number } = {},
): string {
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  let fraction = (value % scale).toString().padStart(decimals, "0");
  if (options.trim !== false) {
    const minimum = options.minimumFractionDigits ?? 0;
    while (fraction.length > minimum && fraction.endsWith("0")) fraction = fraction.slice(0, -1);
  }
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function normalizedWeights(values: readonly bigint[], totalUnits: bigint): bigint[] {
  if (values.length === 0 || values.some((value) => value <= 0n)) {
    throw new Error("Every normalization input must be positive.");
  }
  const total = values.reduce((sum, value) => sum + value, 0n);
  const rows = values.map((value, index) => {
    const scaled = value * totalUnits;
    return { index, units: scaled / total, remainder: scaled % total };
  });
  let missing = totalUnits - rows.reduce((sum, row) => sum + row.units, 0n);
  const priority = [...rows].sort((left, right) => {
    if (left.remainder === right.remainder) return left.index - right.index;
    return left.remainder > right.remainder ? -1 : 1;
  });
  for (let index = 0; missing > 0n; index++, missing--) {
    rows[priority[index].index].units++;
  }
  const normalized = rows.map((row) => row.units);
  for (let index = 0; index < normalized.length; index++) {
    if (normalized[index] !== 0n) continue;
    let donor = -1;
    for (let candidate = 0; candidate < normalized.length; candidate++) {
      if (candidate === index || normalized[candidate] <= 1n) continue;
      if (donor === -1 || normalized[candidate] > normalized[donor]) donor = candidate;
    }
    if (donor === -1) throw new Error("The normalized total is too small for positive weights.");
    normalized[donor]--;
    normalized[index] = 1n;
  }
  return normalized;
}

function normalizedNonzeroWeights(values: readonly bigint[], totalUnits: bigint): bigint[] {
  const positiveIndexes = values.flatMap((value, index) => value > 0n ? [index] : []);
  if (!positiveIndexes.length) return values.map(() => 0n);
  const positive = normalizedWeights(positiveIndexes.map((index) => values[index]), totalUnits);
  const result = values.map(() => 0n);
  positiveIndexes.forEach((sourceIndex, index) => {
    result[sourceIndex] = positive[index];
  });
  return result;
}

export function normalizeMarketCapPercentageUnits(marketCapsUsd: readonly string[]): bigint[] {
  const marketCaps = marketCapsUsd.map((value, index) => {
    const parsed = parseFixedDecimal(value, USD_DECIMALS);
    if (!parsed || parsed <= 0n) throw new Error(`Market cap ${index + 1} must be positive.`);
    return parsed;
  });
  return normalizedWeights(marketCaps, TOTAL_PERCENT_UNITS);
}

export function normalizeMarketCapPercentages(marketCapsUsd: readonly string[]): string[] {
  return normalizeMarketCapPercentageUnits(marketCapsUsd).map(formatPercentageExact);
}

export function resetToMarketCapPercentageUnits(marketCapsUsd: readonly string[]): bigint[] {
  return normalizeMarketCapPercentageUnits(marketCapsUsd);
}

export function percentageUnits(value: string): bigint | undefined {
  return parseFixedDecimal(value, PERCENT_DECIMALS);
}

export function percentageTotal(values: readonly string[]): bigint | undefined {
  let total = 0n;
  for (const value of values) {
    const parsed = percentageUnits(value);
    if (parsed === undefined) return undefined;
    total += parsed;
  }
  return total;
}

function roundedFixedDecimal(value: bigint, decimals: number, displayedDecimals: number): string {
  if (displayedDecimals >= decimals) return formatFixedDecimal(value, decimals);
  const divisor = 10n ** BigInt(decimals - displayedDecimals);
  return formatFixedDecimal((value + divisor / 2n) / divisor, displayedDecimals);
}

export function formatPercentageExact(units: bigint): string {
  return formatFixedDecimal(units, PERCENT_DECIMALS);
}

export function formatPercentageInput(units: bigint): string {
  if (units >= 10n ** 16n) return roundedFixedDecimal(units, PERCENT_DECIMALS, 4);
  if (units >= 10n ** 10n) return roundedFixedDecimal(units, PERCENT_DECIMALS, 10);
  return formatPercentageExact(units);
}

export function formatPercentageDisplay(units: bigint): string {
  if (units === 0n) return "0%";
  if (units < 10n ** 10n) return "<0.00000001%";
  return `${formatPercentageInput(units)}%`;
}

export function percentageUnitsForSelectionChange(
  current: readonly PercentageSelectionCurrent[],
  next: readonly PercentageSelectionNext[],
): bigint[] {
  const defaults = normalizeMarketCapPercentageUnits(next.map((item) => item.marketCapUsd));
  if (!current.length) return defaults;
  const existing = new Map(current.map((item) => [item.key.toLowerCase(), item.percentageUnits]));
  return next.map((item, index) => existing.get(item.key.toLowerCase()) ?? defaults[index]);
}

function ceilingDivide(value: bigint, denominator: bigint): bigint {
  return value / denominator + (value % denominator === 0n ? 0n : 1n);
}

export function minimumPercentageUnitsForOneRaw(priceUsd: string, tokenDecimals: number): bigint {
  if (!Number.isInteger(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 36) {
    throw new Error("Token decimals are unsupported.");
  }
  const priceUsdWad = parseFixedDecimal(priceUsd, USD_DECIMALS);
  if (!priceUsdWad || priceUsdWad <= 0n) throw new Error("Price must be positive.");
  const tokenScale = 10n ** BigInt(tokenDecimals);
  const minimumAllocatedUsdWad = ceilingDivide(priceUsdWad, tokenScale);
  return ceilingDivide(
    minimumAllocatedUsdWad * TOTAL_PERCENT_UNITS,
    FIXED_TARGET_USD_WAD,
  );
}

export function previewBootstrapBasketUnits(
  assets: readonly BasketCalculationAsset[],
): BasketCalculationRow[] {
  const calculated = assets.map((asset, index) => {
    if (!Number.isInteger(asset.decimals) || asset.decimals < 0 || asset.decimals > 36) {
      throw new Error(`Token decimals ${index + 1} are unsupported.`);
    }
    const price = parseFixedDecimal(asset.priceUsd, USD_DECIMALS);
    if (!price || price <= 0n) throw new Error(`Price ${index + 1} must be positive.`);
    const allocatedUsdWad = FIXED_TARGET_USD_WAD * asset.percentageUnits / TOTAL_PERCENT_UNITS;
    const tokenScale = 10n ** BigInt(asset.decimals);
    const rawQuantity = allocatedUsdWad * tokenScale / price;
    const realizedValue = rawQuantity * price / tokenScale;
    return {
      allocatedUsdWad,
      minimumPercentageUnits: minimumPercentageUnitsForOneRaw(asset.priceUsd, asset.decimals),
      price,
      rawQuantity,
      realizedValue,
      tokenScale,
    };
  });

  const realizedValues = calculated.map((row) => row.realizedValue);
  const realizedPercentages = normalizedNonzeroWeights(realizedValues, TOTAL_PERCENT_UNITS);
  return calculated.map((row, index) => ({
    allocatedUsdWad: row.allocatedUsdWad,
    minimumPercentage: formatPercentageDisplay(row.minimumPercentageUnits),
    minimumPercentageUnits: row.minimumPercentageUnits,
    rawQuantity: row.rawQuantity,
    tokenQuantity: formatFixedDecimal(row.rawQuantity, assets[index].decimals),
    realizedPercentageUnits: realizedPercentages[index],
    realizedPercentage: formatPercentageDisplay(realizedPercentages[index]),
    realizedValueUsd: formatFixedDecimal(row.realizedValue, USD_DECIMALS),
    realizedValueUsdWad: row.realizedValue,
  }));
}

export function zeroRawUnitError(
  asset: BasketCalculationAsset,
  row: Pick<BasketCalculationRow, "minimumPercentageUnits" | "rawQuantity">,
): string | undefined {
  if (asset.percentageUnits === 0n || row.rawQuantity !== 0n) return undefined;
  if (row.minimumPercentageUnits > TOTAL_PERCENT_UNITS) {
    return `${asset.symbol} cannot be included in a $1 OTF because its token precision requires at least ${formatPercentageDisplay(row.minimumPercentageUnits)} to produce one raw token unit, which exceeds 100%.`;
  }
  return `At the fixed $1 target, ${asset.symbol}’s ${formatPercentageExact(asset.percentageUnits)}% allocation is less than one raw token unit. Increase its percentage or remove it.`;
}

export function calculateBootstrapBasketUnits(
  assets: readonly BasketCalculationAsset[],
): BasketCalculation {
  if (assets.length === 0) throw new Error("Select at least one asset.");
  if (assets.some((asset) => asset.percentageUnits <= 0n)) {
    throw new Error("Every selected constituent must have a positive percentage.");
  }
  const totalPercentage = assets.reduce((sum, asset) => sum + asset.percentageUnits, 0n);
  if (totalPercentage !== TOTAL_PERCENT_UNITS) {
    throw new Error("Percentages must total exactly 100%.");
  }
  const rows = previewBootstrapBasketUnits(assets);
  const zeroIndex = rows.findIndex((row) => row.rawQuantity === 0n);
  if (zeroIndex !== -1) {
    throw new Error(zeroRawUnitError(assets[zeroIndex], rows[zeroIndex]));
  }
  const realizedTotal = rows.reduce((sum, row) => sum + row.realizedValueUsdWad, 0n);
  return {
    bootstrapBasketUnitsPerOTF: rows.map((row) => row.rawQuantity),
    targetValueUsd: "1",
    realizedValueUsd: formatFixedDecimal(realizedTotal, USD_DECIMALS),
    rows,
  };
}
