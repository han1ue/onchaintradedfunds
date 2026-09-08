import "server-only";
import { managedOtfVaultAbi, otfFactoryAbi } from "@onchaintradedfunds/generated";
import { getAddress, type Address } from "viem";
import testnetDeployment from "../config/robinhood-testnet.json";
import mainnetDeployment from "../config/robinhood-mainnet.json";
import { protocolDeploymentForChain } from "../lib/deployment";
import { navValues } from "../lib/price-policy";
import { database } from "./database";
import { chainClient, readPrices } from "./pricing";
import { withCollectorLease } from "./collector-lock";

const SLOT_MS = 5 * 60_000;
const CONFIRMATIONS = 12n;
const LOG_RANGE = 10_000n;
const MAX_LOG_RANGES = 20;

export async function collectFundSnapshots(chainId: number) {
  return withCollectorLease(`funds:${chainId}`, async (leaseToken) => {
    const { sql, schema } = database();
    const started=Date.now();
    const fence=()=>sql.query(`SELECT ${schema}.require_collector_lease($1,$2)`,[`funds:${chainId}`,leaseToken]);
    const factory = protocolDeploymentForChain(chainId)?.addresses.factory;
    if (!factory) return { discovered: 0, snapshots: 0, unavailable: "FACTORY_NOT_DEPLOYED" };
    const client = chainClient(chainId);
    if (await client.getChainId() !== chainId) throw new Error("WRONG_CHAIN");
    const latest = await client.getBlockNumber();
    const block = await client.getBlock({ blockNumber: latest > CONFIRMATIONS ? latest-CONFIRMATIONS : 0n });
    const slot = new Date(Math.floor(Date.now()/SLOT_MS)*SLOT_MS).toISOString();
    const blockAt = new Date(Number(block.timestamp)*1000).toISOString();
    const checkpoints = await sql.query(`SELECT block_number::text,block_hash FROM ${schema}.collector_blocks WHERE chain_id=$1 AND canonical ORDER BY block_number DESC LIMIT 100`,[chainId]);
    let ancestor: bigint | undefined, reorg = false;
    for (const checkpoint of checkpoints) {
      const height = BigInt(checkpoint.block_number);
      const actual = height <= latest ? await client.getBlock({ blockNumber: height }) : undefined;
      if (actual?.hash === checkpoint.block_hash) { ancestor=height; break; }
      reorg = true;
    }
    if (reorg) {
      if (ancestor === undefined) throw new Error("REORG_REQUIRES_MANUAL_REWIND");
      await sql.transaction([fence(),
        sql.query(`UPDATE ${schema}.fund_snapshots SET canonical=false WHERE chain_id=$1 AND block_number>$2`,[chainId,ancestor.toString()]),
        sql.query(`UPDATE ${schema}.collector_blocks SET canonical=false WHERE chain_id=$1 AND block_number>$2`,[chainId,ancestor.toString()]),
        sql.query(`UPDATE ${schema}.funds SET canonical=false WHERE chain_id=$1 AND creation_block>$2`,[chainId,ancestor.toString()]),
        sql.query(`UPDATE ${schema}.asset_prices p SET quality='invalid' FROM ${schema}.asset_price_sources s WHERE p.source_id=s.id AND s.chain_id=$1 AND p.block_number>$2`,[chainId,ancestor.toString()]),
        sql.query(`UPDATE ${schema}.collector_progress SET block_number=least(block_number,$2::numeric) WHERE job=$1`,[`funds:${chainId}`,ancestor.toString()]),
      ]);
    }
    const [progress] = await sql.query(`SELECT block_number::text FROM ${schema}.collector_progress WHERE job=$1`,[`funds:${chainId}`]);
    const manifest = chainId === 46630 ? testnetDeployment : mainnetDeployment;
    const contracts = ("contracts" in manifest ? manifest.contracts : manifest.protocolContracts) as Record<string,{blockNumber?: string}>;
    const deploymentBlock = contracts.factory?.blockNumber;
    if (!deploymentBlock) throw new Error("FACTORY_CREATION_BLOCK_REQUIRED");
    let from = progress?.block_number ? BigInt(progress.block_number)+1n : BigInt(deploymentBlock);
    let discovered = 0;
    for (let range=0; range<MAX_LOG_RANGES && from<=block.number && Date.now()-started<45_000; range++) {
      const to = from+LOG_RANGE-1n < block.number ? from+LOG_RANGE-1n : block.number;
      const events = await client.getContractEvents({address:factory,abi:otfFactoryAbi,eventName:"VaultCreated",fromBlock:from,toBlock:to,strict:true});
      const writes = [fence()];
      for (const event of events) {
        const vault = event.args.vault;
        if (!vault || !await client.readContract({address:factory,abi:otfFactoryAbi,functionName:"isVault",args:[vault],blockNumber:block.number})) throw new Error("INVALID_FACTORY_EVENT");
        writes.push(sql.query(`INSERT INTO ${schema}.funds(chain_id,address,factory,creation_block,creation_block_hash,discovery_metadata) VALUES ($1,$2,$3,$4,$5,$6::jsonb)
          ON CONFLICT (chain_id,address) DO UPDATE SET canonical=true,creation_block=$4,creation_block_hash=$5,discovery_metadata=$6::jsonb WHERE ${schema}.funds.factory=$3`,
        [chainId,vault.toLowerCase(),factory.toLowerCase(),event.blockNumber.toString(),event.blockHash,JSON.stringify({transactionHash:event.transactionHash,logIndex:event.logIndex,creator:event.args.creator})]));
        discovered++;
      }
      const endBlock = await client.getBlock({blockNumber:to});
      writes.push(sql.query(`UPDATE ${schema}.collector_progress SET block_number=$2,block_hash=$3 WHERE job=$1 AND lease_token=$4 AND lease_until>clock_timestamp()`,[`funds:${chainId}`,to.toString(),endBlock.hash,leaseToken]));
      writes.push(sql.query(`INSERT INTO ${schema}.collector_blocks(chain_id,block_number,block_hash) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,[chainId,to.toString(),endBlock.hash]));
      await sql.transaction(writes);
      from=to+1n;
    }
    const prices = await readPrices(chainId,new Date(blockAt));
    const funds = await sql.query(`SELECT address FROM ${schema}.funds f WHERE chain_id=$1 AND canonical
      AND NOT EXISTS (SELECT 1 FROM ${schema}.fund_snapshots s WHERE s.chain_id=f.chain_id AND s.fund_address=f.address AND s.slot_at=$2 AND s.canonical) ORDER BY address LIMIT 100`,[chainId,slot]);
    let snapshots=0, unpriced=0;
    for (const fund of funds) {
      if(Date.now()-started>75_000)break;
      const address = getAddress(fund.address);
      const [assets, amounts, supply, bootstrap] = await Promise.all([
        client.readContract({address,abi:managedOtfVaultAbi,functionName:"assets",blockNumber:block.number}),
        client.readContract({address,abi:managedOtfVaultAbi,functionName:"accountedBalances",blockNumber:block.number}),
        client.readContract({address,abi:managedOtfVaultAbi,functionName:"totalSupply",blockNumber:block.number}),
        client.readContract({address,abi:managedOtfVaultAbi,functionName:"bootstrapBasketUnits",blockNumber:block.number}),
      ]);
      if (assets.length!==amounts.length || assets.length!==bootstrap.length) throw new Error("INVALID_HOLDINGS");
      const holdings=assets.map((asset,i)=>({ address:asset,amount:amounts[i]!,bootstrapAmount:bootstrap[i]!,price:prices.find(price=>price.address.toLowerCase()===asset.toLowerCase() && price.usable) }));
      const complete=holdings.every(holding=>holding.price);
      const values=complete ? navValues(holdings.map(holding=>({...holding,decimals:holding.price!.decimals,priceUsd:holding.price!.priceUsd})),supply) : undefined;
      // Recheck the selected block after all state reads; a changed hash invalidates this run.
      if ((await client.getBlock({blockNumber:block.number})).hash!==block.hash) throw new Error("BLOCK_REORGANIZED");
      const decimals=await Promise.all(holdings.map(holding=>holding.price?.decimals ?? client.readContract({address:holding.address,abi:managedOtfVaultAbi,functionName:"decimals",blockNumber:block.number})));
      const holdingsJson=holdings.map((holding,i)=>({address:holding.address.toLowerCase(),amount:holding.amount.toString(),bootstrap:holding.bootstrapAmount.toString(),decimals:decimals[i],priceId:holding.price?.priceId??null}));
      await sql.transaction([fence(),
        sql.query(`WITH inserted AS (
          INSERT INTO ${schema}.fund_snapshots(chain_id,fund_address,slot_at,block_number,block_hash,block_at,total_supply,total_nav_usd,nav_per_share_usd,bootstrap_nav_usd,status)
          SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11 WHERE EXISTS
            (SELECT 1 FROM ${schema}.collector_progress WHERE job=$13 AND lease_token=$14 AND lease_until>clock_timestamp())
          ON CONFLICT DO NOTHING RETURNING id)
          INSERT INTO ${schema}.snapshot_holdings(snapshot_id,asset_address,accounted_amount,bootstrap_amount,decimals,price_id)
          SELECT i.id,h.address,h.amount::numeric,h.bootstrap::numeric,h.decimals,h."priceId"::bigint FROM inserted i,
          jsonb_to_recordset($12::jsonb) AS h(address text,amount text,bootstrap text,decimals smallint,"priceId" text)`,
        [chainId,address.toLowerCase(),slot,block.number.toString(),block.hash,blockAt,supply.toString(),values?.totalNavUsd??null,values?.navPerShareUsd??null,values?.bootstrapNavUsd??null,complete?supply===0n?"bootstrap":"ready":"unpriced",JSON.stringify(holdingsJson),`funds:${chainId}`,leaseToken]),
        sql.query(`INSERT INTO ${schema}.collector_blocks(chain_id,block_number,block_hash) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,[chainId,block.number.toString(),block.hash]),
      ]);
      snapshots++; if (!complete) unpriced++;
    }
    return {discovered,snapshots,unpriced,discoveryCaughtUp:from>block.number,blockNumber:block.number.toString()};
  });
}

export async function readFundHistory(chainId:number,address:Address) {
  const {sql,schema}=database();
  const rows=await sql.query(`SELECT id::text,block_number::text,block_hash,block_at,slot_at,total_supply::text,total_nav_usd::text,nav_per_share_usd::text,bootstrap_nav_usd::text,status
    FROM ${schema}.fund_snapshots WHERE chain_id=$1 AND fund_address=$2 AND canonical ORDER BY slot_at DESC LIMIT 2016`,[chainId,address.toLowerCase()]);
  const latest=rows[0];
  const holdings=latest ? await sql.query(`SELECT h.asset_address AS address,h.accounted_amount::text AS amount,h.bootstrap_amount::text,h.decimals,p.id::text AS price_id,p.price_usd::text,p.source_at,p.source_id,m.market_cap_usd::text,m.source_at AS market_cap_at
    FROM ${schema}.snapshot_holdings h LEFT JOIN ${schema}.asset_prices p ON p.id=h.price_id LEFT JOIN ${schema}.asset_market_caps m ON m.chain_id=$2 AND m.asset_address=h.asset_address AND m.source_at>clock_timestamp()-interval '120 days' WHERE h.snapshot_id=$1 ORDER BY h.asset_address`,[latest.id,chainId]) : [];
  return {latest:latest??null,holdings,history:rows.reverse(),intervalSeconds:300};
}
