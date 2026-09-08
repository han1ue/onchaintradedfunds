import "server-only";
import { getAddress, type Hex } from "viem";
import { database } from "./database";
import type { AssetRegistry, CatalogAsset, RegisteredPool } from "../lib/asset-catalog";

export async function readRegistry(chainId?: number): Promise<AssetRegistry> {
  const { sql, schema } = database();
  const [assetRows, poolRows] = await sql.transaction([
    sql.query(`SELECT * FROM ${schema}.assets WHERE ($1::int IS NULL OR chain_id=$1) ORDER BY chain_id,featured DESC,slug,address`, [chainId ?? null]),
    sql.query(`SELECT * FROM ${schema}.pools WHERE ($1::int IS NULL OR chain_id=$1) ORDER BY id`, [chainId ?? null]),
  ], { isolationLevel: "RepeatableRead", readOnly: true });
  const assets: CatalogAsset[] = assetRows.map(row => ({
    id: row.slug, chainId: row.chain_id, address: getAddress(row.address), symbol: row.symbol, name: row.name,
    decimals: row.decimals, assetType: row.asset_type, role: row.role ?? undefined,
    verified: row.verified, enabled: row.enabled, featured: row.featured,
    verifiedAt: row.verified_at ?? undefined, verificationRevokedAt: row.verification_revoked_at ?? undefined,
  }));
  const pools: RegisteredPool[] = poolRows.map(row => {
    const asset = (address: string) => assets.find(asset => asset.chainId === row.chain_id && asset.address.toLowerCase() === address)!;
    return {
      id: row.id, chainId: row.chain_id, venue: row.venue, protocolVersion: row.protocol_version,
      assetA: asset(row.token0), assetB: asset(row.token1),
      address: row.pool_address ? getAddress(row.pool_address) : undefined,
      poolManager: row.pool_manager ? getAddress(row.pool_manager) : undefined, poolId: row.pool_id ?? undefined,
      fee: row.fee, tickSpacing: row.tick_spacing ?? undefined, hooks: row.hooks ? getAddress(row.hooks) : undefined,
      hookData: row.hook_data, approved: row.approved, enabled: row.enabled, validatedAt: row.validated_at ?? undefined,
      runtimeCodehash: row.validation_metadata.runtimeCodehash as Hex | undefined, validationMetadata: row.validation_metadata,
    };
  });
  return { assets, pools };
}
