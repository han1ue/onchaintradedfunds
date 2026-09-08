import type { Address, Hex } from "viem";

export type CatalogAsset = {
  id: string; chainId: number; address: Address; symbol: string; name: string; decimals: number;
  assetType: "stock_token" | "stablecoin" | "wrapped_native" | "protocol_token" | "fund_share" | "other";
  verified: boolean; enabled: boolean; featured: boolean; role?: "quote" | "fund";
  verifiedAt?: string; verificationRevokedAt?: string;
};
export type RegisteredPool = {
  id: string; chainId: number; venue: string; protocolVersion: 3 | 4;
  assetA: CatalogAsset; assetB: CatalogAsset;
  address?: Address; poolManager?: Address; poolId?: Hex;
  fee: number; tickSpacing?: number; hooks?: Address; hookData: Hex;
  approved: boolean; enabled: boolean; validatedAt?: string;
  runtimeCodehash?: Hex; validationMetadata: Record<string, unknown>;
};
export type TestnetPool = RegisteredPool & { address: Address; runtimeCodehash: Hex };
export type AssetRegistry = { assets: CatalogAsset[]; pools: RegisteredPool[] };
export const emptyRegistry: AssetRegistry = { assets: [], pools: [] };

export function assetCatalog(registry: AssetRegistry, chainId: number) {
  const assets = registry.assets.filter(asset => asset.chainId === chainId && asset.enabled);
  const pools = registry.pools.filter(pool => pool.chainId === chainId && pool.approved && pool.enabled
    && assets.some(asset => asset.address.toLowerCase() === pool.assetA.address.toLowerCase())
    && assets.some(asset => asset.address.toLowerCase() === pool.assetB.address.toLowerCase()));
  const byAddress = (address: Address) => assets.find(asset => asset.address.toLowerCase() === address.toLowerCase());
  return {
    assets, pools,
    testnetAssets: chainId === 46630 ? assets : [],
    testnetFundAssets: assets.filter(asset => asset.role === "fund" && asset.assetType !== "protocol_token"),
    testnetQuoteAssets: assets.filter(asset => asset.role === "quote"),
    testnetPools: pools.filter((pool): pool is TestnetPool => pool.protocolVersion === 3 && Boolean(pool.address && pool.runtimeCodehash)),
    testnetAssetById: (id: string) => assets.find(asset => asset.id === id),
    testnetAssetByAddress: byAddress,
    testnetAssetRole: (address: Address) => byAddress(address)?.role,
    testnetPoolForPair: (left: Address, right: Address) => pools.find(pool => poolMatches(pool, left, right)),
  };
}

export function poolMatches(pool: RegisteredPool, left: Address, right: Address): boolean {
  return [pool.assetA.address.toLowerCase(), pool.assetB.address.toLowerCase()].sort().join(":") === [left.toLowerCase(), right.toLowerCase()].sort().join(":");
}

export function fundAssetsVerified(registry: AssetRegistry, chainId: number, addresses: readonly Address[]): boolean {
  return addresses.length > 0 && addresses.every(address => registry.assets.some(asset =>
    asset.chainId === chainId && asset.address.toLowerCase() === address.toLowerCase() && asset.enabled && asset.verified));
}

/** Endpoint policy only; metadata, provenance and pool authentication remain server checks. */
export function testnetSwapPairAllowed(input: { address: Address; kind: string }, output: { address: Address; kind: string }): boolean {
  return input.address.toLowerCase() !== output.address.toLowerCase() && (input.kind === "otf" || output.kind === "otf");
}
