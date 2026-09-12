import { randomUUID,createHash } from 'node:crypto';
import { beforeAll,afterAll,describe,expect,it,vi } from 'vitest';
import { migrate,seed } from '../../scripts/database.mjs';
import { database } from './database.ts';
import { readRegistry } from './registry.ts';
import { readPrices } from './pricing.ts';
import { withCollectorLease } from './collector-lock.ts';
import { collectFundSnapshots,readFundHistory } from './nav.ts';
import { navValues } from '../lib/price-policy.ts';
import { parseFixedDecimal } from '../lib/creation-model.ts';
import { GET as registryGet } from '../app/api/asset-registry/route.ts';
import manifest from '../config/robinhood-testnet.json';

const chain=vi.hoisted(()=>({client:undefined}));
vi.mock('./pricing.ts',async original=>({...await original(),chainClient:()=>chain.client}));
const run=process.env.RUN_DATABASE_TESTS==='true';
const addr=i=>'0x'+i.toString(16).padStart(40,'0');
const hash=i=>'0x'+i.toString(16).padStart(64,'0');
describe.skipIf(!run)('Neon isolated registry and NAV integration',()=>{
  let sql,schema,originalEnv,source,token,blockNumber,blockAt,currentHash=hash(1);
  const vault=addr(700),bootstrap=addr(701),unpriced=addr(702);
  const rateKey=createHash('sha256').update(randomUUID()).digest('hex');
  beforeAll(async()=>{
    originalEnv={VERCEL_ENV:process.env.VERCEL_ENV,REGISTRY_TEST_SCHEMA:process.env.REGISTRY_TEST_SCHEMA};
    process.env.VERCEL_ENV='development';
    process.env.REGISTRY_TEST_SCHEMA='otf_test_'+randomUUID().replaceAll('-','');
    ({sql,schema}=database());
    await migrate();await migrate();await seed();await seed();
    const registry=await readRegistry(46630);
    token=registry.assets.find(a=>a.id==='tsla');
    [source]=await sql.query(`SELECT id FROM ${schema}.asset_price_sources WHERE chain_id=46630 AND asset_address=$1 AND approved ORDER BY priority LIMIT 1`,[token.address.toLowerCase()]);
    blockNumber=BigInt(manifest.contracts.factory.blockNumber)+100n;
    blockAt=Math.floor(Date.now()/1000)-2;
    chain.client={
      getChainId:async()=>46630,getBlockNumber:async()=>blockNumber+12n,
      getBlock:async({blockNumber:n})=>({number:n,timestamp:BigInt(blockAt),hash:n===blockNumber?currentHash:hash(Number(n%10000n)+100)}),
      getContractEvents:vi.fn(async()=>[]),
      readContract:vi.fn(async({address,functionName,blockNumber:n})=>{
        expect(n).toBe(blockNumber);
        if(functionName==='assets')return [address===unpriced?addr(999):token.address];
        if(functionName==='accountedBalances')return [address===bootstrap?0n:3n*10n**18n];
        if(functionName==='bootstrapBasketUnits')return [2n*10n**18n];
        if(functionName==='totalSupply')return address===bootstrap?0n:2n*10n**18n;
        if(functionName==='decimals')return 18;
        throw new Error('Unexpected chain read');
      }),
    };
  },60000);
  afterAll(async()=>{
    try {
      if(sql && /^otf_test_[a-z0-9_]{1,40}$/.test(schema))await sql.query(`DROP SCHEMA ${schema} CASCADE`);
      if(sql)await sql.query('DELETE FROM otf_shared.provider_limits WHERE key_hash=$1',[rateKey]);
    } finally {
      for(const [key,value] of Object.entries(originalEnv??{}))if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  },30000);
  it('repeats migrations/seeds and preserves independent approvals and audits',async()=>{
    expect((await readRegistry()).assets).toHaveLength(15);
    expect((await readRegistry()).pools).toHaveLength(6);
    const response=await registryGet(new Request('http://localhost/api/asset-registry?chainId=46630'));
    const filtered=await response.json();expect(filtered.assets).toHaveLength(8);expect(filtered.assets.every(a=>a.verified)).toBe(true);
    const all=await (await registryGet(new Request('http://localhost/api/asset-registry?chainId=46630&includeUnverified=true'))).json();
    expect(all.assets).toHaveLength(8);
    await sql.transaction([sql.query(`SELECT set_config('otf.actor','integration-test',true)`),sql.query(`UPDATE ${schema}.assets SET verified=false WHERE chain_id=46630 AND address=$1`,[token.address.toLowerCase()])]);
    expect((await readRegistry(46630)).pools).toHaveLength(6);
    expect((await sql.query(`SELECT actor FROM ${schema}.registry_audit ORDER BY id DESC LIMIT 1`))[0].actor).toBe('integration-test');
    await seed();expect((await readRegistry(46630)).assets.find(a=>a.id==='tsla').verified).toBe(false);
    await sql.query(`INSERT INTO ${schema}.pools SELECT 'competing',chain_id,venue,protocol_version,token0,token1,$1,pool_manager,pool_id,500,tick_spacing,hooks,hook_data,enabled,approved,validated_at,validation_metadata FROM ${schema}.pools LIMIT 1`,[addr(900)]);
    expect((await readRegistry()).pools).toHaveLength(7);
  },30000);
  it('shares one rate-limit row across independent database clients',async()=>{
    const other=database().sql;
    const calls=await Promise.all(Array.from({length:16},(_,i)=>(i%2?sql:other).query('SELECT otf_shared.provider_slot($1,0) AS wait_ms,extract(epoch from clock_timestamp())*1000 AS at',[rateKey])));
    const admitted=calls.map(rows=>rows[0]).filter(row=>Number(row.wait_ms)===0).sort((a,b)=>Number(a.at)-Number(b.at));
    expect(admitted.length).toBeGreaterThan(0);expect(calls.some(rows=>Number(rows[0].wait_ms)>0)).toBe(true);
    for(const row of admitted)expect(admitted.filter(other=>Number(other.at)>=Number(row.at) && Number(other.at)<Number(row.at)+1000).length).toBeLessThanOrEqual(6);
    await sql.query('SELECT otf_shared.provider_slot($1,(extract(epoch from clock_timestamp())*1000+3000)::bigint)',[rateKey]);
    expect(Number((await other.query('SELECT otf_shared.provider_slot($1,0) AS wait_ms',[rateKey]))[0].wait_ms)).toBeGreaterThan(1000);
  },30000);
  it('excludes overlap and fences a replaced lease inside a transaction',async()=>{
    await withCollectorLease('test-lease',async token=>{
      expect(await withCollectorLease('test-lease',async()=>true)).toBeUndefined();
      await sql.query(`UPDATE ${schema}.collector_progress SET lease_token='replacement' WHERE job='test-lease'`);
      await expect(sql.transaction([sql.query(`SELECT ${schema}.require_collector_lease($1,$2)`,['test-lease',token]),sql.query(`DELETE FROM ${schema}.assets`)])).rejects.toThrow();
    });
    expect((await readRegistry()).assets).toHaveLength(15);
  },30000);
  it('persists reproducible snapshots, bootstrap and missing-price states exactly once',async()=>{
    const sourceAt=new Date((blockAt-60)*1000).toISOString(),collectedAt=new Date((blockAt-30)*1000).toISOString();
    await sql.query(`UPDATE ${schema}.asset_price_sources SET validated_at=$2 WHERE id=$1`,[source.id,collectedAt]);
    await sql.query(`INSERT INTO ${schema}.asset_prices(source_id,price_usd,source_at,collected_at,quality) VALUES($1,'2.123456789012345678901234567890123456',$2,$3,'fresh')`,[source.id,sourceAt,collectedAt]);
    const prices=await readPrices(46630,new Date(blockAt*1000));expect(prices).toHaveLength(1);expect(prices[0].usable).toBe(true);expect(prices[0].marketCapUsd).toBeUndefined();
    for(const address of [vault,bootstrap,unpriced])await sql.query(`INSERT INTO ${schema}.funds(chain_id,address,factory,creation_block,creation_block_hash) VALUES(46630,$1,$2,$3,$4)`,[address,manifest.contracts.factory.address.toLowerCase(),(blockNumber-50n).toString(),hash(55)]);
    await sql.query(`INSERT INTO ${schema}.collector_progress(job,block_number) VALUES ($1,$2)`,["funds:46630",(blockNumber+1000n).toString()]);
    const first=await collectFundSnapshots(46630);expect(first.snapshots).toBe(3);expect(first.unpriced).toBe(1);
    expect(chain.client.getContractEvents).toHaveBeenCalledWith(expect.objectContaining({address:manifest.contracts.factory.address,fromBlock:BigInt(manifest.contracts.factory.blockNumber)}));
    const second=await collectFundSnapshots(46630);expect(second.snapshots).toBe(0);
    const history=await readFundHistory(46630,vault);expect(history.history).toHaveLength(1);
    const recomputed=navValues(history.holdings.map(h=>({amount:BigInt(h.amount),bootstrapAmount:BigInt(h.bootstrap_amount),decimals:h.decimals,priceUsd:h.price_usd})),BigInt(history.latest.total_supply));
    expect(parseFixedDecimal(history.latest.total_nav_usd,36)).toBe(parseFixedDecimal(recomputed.totalNavUsd,36));
    expect(parseFixedDecimal(history.latest.nav_per_share_usd,36)).toBe(parseFixedDecimal(recomputed.navPerShareUsd,36));
    expect(BigInt(history.latest.total_supply)).toBe(2n*10n**18n);
    expect(history.holdings[0].price_id).toBe(prices[0].priceId);
    expect((await readFundHistory(46630,bootstrap)).latest.status).toBe('bootstrap');
    expect((await readFundHistory(46630,unpriced)).latest.status).toBe('unpriced');
    // Changing the current price must not rewrite existing historical observations.
    await sql.query(`INSERT INTO ${schema}.asset_prices(source_id,price_usd,source_at,quality) VALUES($1,'99',clock_timestamp(),'fresh')`,[source.id]);
    expect((await readFundHistory(46630,vault)).latest).toEqual(history.latest);
    expect(chain.client.readContract.mock.calls.every(([call])=>call.blockNumber===blockNumber)).toBe(true);
  },60000);
  it('invalidates an orphaned snapshot and rebuilds the current slot without inventing older history',async()=>{
    await sql.query(`INSERT INTO ${schema}.collector_blocks(chain_id,block_number,block_hash) VALUES(46630,$1,$2) ON CONFLICT DO NOTHING`,[(blockNumber-1n).toString(),hash(Number((blockNumber-1n)%10000n)+100)]);
    currentHash=hash(2);
    const result=await collectFundSnapshots(46630);expect(result.snapshots).toBe(3);
    const history=await readFundHistory(46630,vault);expect(history.history).toHaveLength(1);expect(history.latest.block_hash).toBe(hash(2));
    const rows=await sql.query(`SELECT canonical,count(*)::int AS count FROM ${schema}.fund_snapshots WHERE fund_address=$1 GROUP BY canonical`,[vault]);
    expect(rows).toEqual(expect.arrayContaining([{canonical:false,count:1},{canonical:true,count:1}]));
  },60000);
});
