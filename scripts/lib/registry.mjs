import { database, assertDatabaseWrites } from '../../app/src/server/database.ts';

export async function readDeploymentAssetCatalog(chainId) {
  const {sql,schema}=database();
  const [assets,pools,settings]=await sql.transaction([
    sql.query(`SELECT * FROM ${schema}.assets WHERE chain_id=$1 AND enabled ORDER BY slug`,[chainId]),
    sql.query(`SELECT * FROM ${schema}.pools WHERE chain_id=$1 AND approved AND enabled AND protocol_version=3 ORDER BY id`,[chainId]),
    sql.query(`SELECT value FROM ${schema}.registry_settings WHERE key='testnet:venue'`),
  ],{isolationLevel:'RepeatableRead',readOnly:true});
  const rows=assets.map(row=>({id:row.slug,symbol:row.symbol,name:row.name,address:row.address,decimals:row.decimals,verified:row.verified,role:row.role,assetType:row.asset_type,...(row.metadata.original?.primary===undefined?{}:{primary:row.metadata.original.primary})}));
  const assetId=address=>rows.find(row=>row.address===address)?.id;
  return {chainId,venue:settings[0]?.value,quoteAssets:rows.filter(row=>row.role==='quote'),fundAssets:rows.filter(row=>row.role==='fund'&&row.assetType!=='protocol_token'),
    pools:pools.map(row=>({...row.validation_metadata,id:row.id.replace(`${chainId}:`,''),assetA:assetId(row.token0),assetB:assetId(row.token1),address:row.pool_address,fee:row.fee})),
  };
}

export async function registerProtocolDeployment({chainId,otfToken,launchManager,pools}) {
  assertDatabaseWrites();
  const {sql,schema}=database();
  // Deployment does not confer verification or valuation approval.
  await sql.transaction([
    sql.query(`SELECT set_config('otf.actor','deployment-tool',true)`),
    sql.query(`INSERT INTO ${schema}.assets(chain_id,address,slug,symbol,name,decimals,asset_type,role,featured) VALUES ($1,$2,'otf','OTF','Onchain Traded Funds',18,'protocol_token','fund',true) ON CONFLICT DO NOTHING`,[chainId,otfToken.toLowerCase()]),
    sql.query(`INSERT INTO ${schema}.asset_price_sources(id,chain_id,asset_address,source_type,valuation_kind,oracle_address,priority,max_age_seconds,approved)
      VALUES ($1,$2,$3,'otf_launch','token_market',$4,10,90000,false) ON CONFLICT DO NOTHING`,[`${chainId}:${otfToken.toLowerCase()}:oracle:0`,chainId,otfToken.toLowerCase(),launchManager.toLowerCase()]),
    ...pools.map(pool=>sql.query(`UPDATE ${schema}.pools SET validation_metadata=validation_metadata || $3::jsonb WHERE chain_id=$1 AND pool_address=$2`,[chainId,pool.address.toLowerCase(),JSON.stringify({status:pool.status,positionTokenId:pool.positionTokenId,mintTransactionHash:pool.mintTransactionHash})])),
  ]);
}
