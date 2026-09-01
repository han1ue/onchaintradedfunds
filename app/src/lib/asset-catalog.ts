import productionCatalog from "../config/assets.json";
import testnetCatalog from "../config/robinhood-testnet-assets.json";
import { getAddress, isAddress, type Address } from "viem";

export type CatalogAsset = {
  id: string;
  symbol: string;
  name: string;
  address: Address;
  decimals: number;
};

export type TestnetAssetRole = "quote" | "fund";

export type TestnetPool = {
  id: string;
  assetA: CatalogAsset;
  assetB: CatalogAsset;
  address: Address;
  fee: number;
};

type ObjectRecord = Record<string, unknown>;

function record(value: unknown, label: string): ObjectRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as ObjectRecord;
}

function nonempty(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function address(value: unknown, label: string): Address {
  const candidate = nonempty(value, label);
  if (!isAddress(candidate)) throw new Error(`${label} must be an address.`);
  return getAddress(candidate);
}

function positiveInteger(value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0 || Number(value) > maximum) throw new Error(`${label} must be a positive integer.`);
  return Number(value);
}

function parseAsset(value: unknown, label: string): CatalogAsset {
  const source = record(value, label);
  return {
    id: nonempty(source.id, `${label}.id`),
    symbol: nonempty(source.symbol, `${label}.symbol`),
    name: nonempty(source.name, `${label}.name`),
    address: address(source.address, `${label}.address`),
    decimals: positiveInteger(source.decimals, `${label}.decimals`, 36),
  };
}

const testnet = record(testnetCatalog, "testnet asset catalog");
if (testnet.chainId !== 46630) throw new Error("The testnet asset catalog has the wrong chain ID.");

const quoteSources = Array.isArray(testnet.quoteAssets) ? testnet.quoteAssets : [];
const fundSources = Array.isArray(testnet.fundAssets) ? testnet.fundAssets : [];
if (quoteSources.length < 1 || fundSources.length < 1) throw new Error("The testnet asset catalog must define quote and fund assets.");

export const testnetQuoteAssets = Object.freeze(quoteSources.map((value, index) => parseAsset(value, `quoteAssets[${index}]`)));
export const testnetFundAssets = Object.freeze(fundSources.map((value, index) => parseAsset(value, `fundAssets[${index}]`)));
export const testnetAssets = Object.freeze([...testnetQuoteAssets, ...testnetFundAssets]);

const assetById = new Map<string, CatalogAsset>();
const roleByAddress = new Map<string, TestnetAssetRole>();
for (const [role, assets] of [["quote", testnetQuoteAssets], ["fund", testnetFundAssets]] as const) {
  for (const asset of assets) {
    if (assetById.has(asset.id) || roleByAddress.has(asset.address.toLowerCase())) throw new Error("The testnet asset catalog contains a duplicate asset.");
    assetById.set(asset.id, asset);
    roleByAddress.set(asset.address.toLowerCase(), role);
  }
}

const venue = record(testnet.venue, "testnet asset catalog venue");
const venueId = nonempty(venue.id, "venue.id");
if (venueId !== "synthra-v3") throw new Error("The testnet venue must be Synthra V3.");
const venueBaseUrl = nonempty(venue.baseUrl, "venue.baseUrl");
if (new URL(venueBaseUrl).protocol !== "https:") throw new Error("venue.baseUrl must be HTTPS.");

export const testnetVenue = Object.freeze({
  id: venueId,
  name: nonempty(venue.name, "venue.name"),
  baseUrl: venueBaseUrl,
  factory: address(venue.factory, "venue.factory"),
  swapRouter02: address(venue.swapRouter02, "venue.swapRouter02"),
  quoter: address(venue.quoter, "venue.quoter"),
  positionManager: address(venue.positionManager, "venue.positionManager"),
});

const poolSources = Array.isArray(testnet.pools) ? testnet.pools : [];
const seenPoolIds = new Set<string>();
const seenPoolAddresses = new Set<string>();
const seenPoolPairs = new Set<string>();
export const testnetPools = Object.freeze(poolSources.map((value, index): TestnetPool => {
  const source = record(value, `pools[${index}]`);
  const id = nonempty(source.id, `pools[${index}].id`);
  const assetA = assetById.get(nonempty(source.assetA, `pools[${index}].assetA`));
  const assetB = assetById.get(nonempty(source.assetB, `pools[${index}].assetB`));
  if (!assetA || !assetB || assetA.id === assetB.id) throw new Error(`pools[${index}] has invalid assets.`);
  const poolAddress = address(source.address, `pools[${index}].address`);
  const pair = [assetA.address.toLowerCase(), assetB.address.toLowerCase()].sort().join(":");
  if (seenPoolIds.has(id) || seenPoolAddresses.has(poolAddress.toLowerCase()) || seenPoolPairs.has(pair)) throw new Error("The testnet asset catalog contains a duplicate pool.");
  seenPoolIds.add(id);
  seenPoolAddresses.add(poolAddress.toLowerCase());
  seenPoolPairs.add(pair);
  return { id, assetA, assetB, address: poolAddress, fee: positiveInteger(source.fee, `pools[${index}].fee`, 1_000_000) };
}));

const discovery = record(testnet.otfPoolDiscovery, "otfPoolDiscovery");
const discoveryQuoteAsset = assetById.get(nonempty(discovery.quoteAsset, "otfPoolDiscovery.quoteAsset"));
if (!discoveryQuoteAsset || testnetAssetRole(discoveryQuoteAsset.address) !== "quote") throw new Error("otfPoolDiscovery.quoteAsset must name a quote asset.");
export const otfPoolDiscovery = Object.freeze({
  quoteAsset: discoveryQuoteAsset,
  fee: positiveInteger(discovery.fee, "otfPoolDiscovery.fee", 1_000_000),
});

if (testnetAssets.some((asset) => (
  asset.id !== discoveryQuoteAsset.id
  && !testnetPoolForPair(asset.address, discoveryQuoteAsset.address)
))) throw new Error("Every configured testnet asset must have a pool against the OTF discovery quote asset.");

export function testnetAssetRole(value: Address): TestnetAssetRole | undefined {
  return roleByAddress.get(value.toLowerCase());
}

export function testnetAssetById(id: string): CatalogAsset | undefined {
  return assetById.get(id);
}

export function testnetAssetByAddress(value: Address): CatalogAsset | undefined {
  return testnetAssets.find((asset) => asset.address.toLowerCase() === value.toLowerCase());
}

export function testnetPoolForPair(left: Address, right: Address): TestnetPool | undefined {
  return testnetPools.find((pool) => {
    const a = pool.assetA.address.toLowerCase();
    const b = pool.assetB.address.toLowerCase();
    return (a === left.toLowerCase() && b === right.toLowerCase())
      || (a === right.toLowerCase() && b === left.toLowerCase());
  });
}

export function testnetPoolRouteAllowed(
  input: { address: Address; kind: "erc20" | "otf" },
  output: { address: Address; kind: "erc20" | "otf" },
): boolean {
  if (input.address.toLowerCase() === output.address.toLowerCase()) return false;
  if (input.kind === "otf" && output.kind === "otf") return true;
  if (input.kind === "otf" || output.kind === "otf") {
    const token = input.kind === "erc20" ? input : output;
    return testnetAssetRole(token.address) === "quote";
  }
  const inputRole = testnetAssetRole(input.address);
  const outputRole = testnetAssetRole(output.address);
  return Boolean(inputRole && outputRole && (inputRole === "quote" || outputRole === "quote"));
}

export function testnetSwapPairAllowed(
  input: { address: Address; kind: "erc20" | "otf" },
  output: { address: Address; kind: "erc20" | "otf" },
): boolean {
  return (input.kind === "otf" || output.kind === "otf")
    && testnetPoolRouteAllowed(input, output);
}

const production = record(productionCatalog, "production asset catalog");
const productionSources = Array.isArray(production.assets) ? production.assets : [];

export function productionAssetsForChain(chainId: number): readonly CatalogAsset[] {
  const chainKey = chainId.toString();
  return productionSources.flatMap((value, index) => {
    const source = record(value, `assets[${index}]`);
    const deployments = record(source.deployments, `assets[${index}].deployments`);
    const deploymentValue = deployments[chainKey];
    if (deploymentValue === undefined) return [];
    const deployment = record(deploymentValue, `assets[${index}].deployments.${chainKey}`);
    if (deployment.featured !== true) return [];
    return [{
      id: nonempty(source.id, `assets[${index}].id`),
      symbol: nonempty(source.symbol, `assets[${index}].symbol`),
      name: nonempty(source.name, `assets[${index}].name`),
      address: address(deployment.address, `assets[${index}].deployments.${chainKey}.address`),
      decimals: positiveInteger(deployment.decimals, `assets[${index}].deployments.${chainKey}.decimals`, 36),
    }];
  });
}
