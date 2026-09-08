import "server-only";
import { createPublicClient, erc20Abi, formatUnits, getAddress, http, parseAbi } from "viem";
import { otfLaunchManagerAbi } from "@onchaintradedfunds/generated";
import { database } from "./database";
import { readRegistry } from "./registry";
import { withCollectorLease } from "./collector-lock";
import { priceQuality } from "../lib/price-policy";
import { stockPriceUsdFromYahoo, marketCapObservationFromYahoo } from "../lib/yahoo-market-data";
import { mainnetStockAssetsFromRobinhood } from "../lib/mainnet-creation-assets";
import { protocolDeploymentForChain } from "../lib/deployment";
import { robinhoodChain, robinhoodChainTestnet } from "../lib/chains";
import { parseFixedDecimal, formatFixedDecimal } from "../lib/creation-model";

export function chainClient(chainId: number) {
  if (![4663,46630].includes(chainId)) throw new Error("Unsupported collector chain.");
  const chain = chainId === 46630 ? robinhoodChainTestnet : robinhoodChain;
  return createPublicClient({ chain, transport: http((chainId === 46630 ? process.env.RH_TESTNET_RPC_URL : process.env.RH_MAINNET_RPC_URL) || chain.rpcUrls.default.http[0], { timeout: 10_000, retryCount: 0 }) });
}
async function fetchJson(url: string) {
  const response = await fetch(url, { cache: "no-store", headers: { accept: "application/json", "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("PRICE_PROVIDER_UNAVAILABLE");
  return response.json();
}
const oracleAbi = parseAbi(["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)","function decimals() view returns (uint8)","function description() view returns (string)"]);

export async function collectPrices() {
  return withCollectorLease("prices", async (leaseToken) => {
    const started=Date.now();
    const { sql, schema } = database();
    const registry = await readRegistry();
    const sources = await sql.query(`SELECT s.* FROM ${schema}.asset_price_sources s JOIN ${schema}.assets a ON a.chain_id=s.chain_id AND a.address=s.asset_address LEFT JOIN ${schema}.price_source_status status ON status.source_id=s.id WHERE s.approved AND a.enabled AND s.valuation_kind <> 'executable_quote' ORDER BY coalesce(status.attempted_at,'epoch'::timestamptz),s.chain_id,s.asset_address,s.priority,s.id LIMIT 200`);
    const upstream = new Map<string, Promise<unknown>>();
    const once = (url: string) => { if (!upstream.has(url)) upstream.set(url, fetchJson(url)); return upstream.get(url)!; };
    const valued = new Set<string>();
    let collected = 0, failed = 0;
    for (const source of sources) {
      if(Date.now()-started>60_000)break;
      const key = `${source.chain_id}:${source.asset_address}`;
      if (valued.has(key)) continue;
      try {
        const asset = registry.assets.find(asset => asset.chainId === source.chain_id && asset.address.toLowerCase() === source.asset_address)!;
        let price: string, sourceAt: string, marketClosed = false;
        let blockNumber: string | null = null, blockHash: string | null = null;
        let metadata: Record<string, unknown> = {};
        if (source.source_type === "yahoo") {
          if (asset.assetType !== "stock_token" || source.provider_id !== asset.symbol || source.validation_metadata.expectedSymbol !== asset.symbol) throw new Error("INVALID_STOCK_MAPPING");
          if (source.validation_metadata.requireRobinhoodIdentity) {
            const endpoint = protocolDeploymentForChain(asset.chainId)?.assetDataEndpoint;
            if (!endpoint || !mainnetStockAssetsFromRobinhood(await once(endpoint), [asset]).length) throw new Error("INVALID_STOCK_IDENTITY");
          }
          const payload = await once(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(source.provider_id)}?range=1d&interval=1m`);
          const observation = stockPriceUsdFromYahoo(payload);
          if (!observation?.priceUpdatedAt) throw new Error("MISSING_SOURCE_TIMESTAMP");
          price = observation.priceUsd; sourceAt = observation.priceUpdatedAt;
          const meta = (payload as { chart?: { result?: { meta?: { currentTradingPeriod?: { regular?: { start?: number; end?: number } } } }[] } }).chart?.result?.[0]?.meta;
          const end = meta?.currentTradingPeriod?.regular?.end;
          const start = meta?.currentTradingPeriod?.regular?.start;
          marketClosed = typeof end === "number" && Date.now() >= end * 1000 || typeof start === "number" && Date.now() < start * 1000;
          metadata = { marketClosed, valuationKind: "stock_reference", providerId: source.provider_id };
        } else {
          const client = chainClient(asset.chainId);
          if (await client.getChainId() !== asset.chainId) throw new Error("WRONG_CHAIN");
          const block = await client.getBlock({ blockTag: "latest" });
          blockNumber = block.number.toString(); blockHash = block.hash;
          if (await client.readContract({ address: asset.address, abi: erc20Abi, functionName: "decimals", blockNumber: block.number }) !== asset.decimals) throw new Error("INVALID_TOKEN_DECIMALS");
          if (source.source_type === "chainlink") {
            const address = getAddress(source.oracle_address);
            const [round, decimals, description] = await Promise.all([
              client.readContract({ address, abi: oracleAbi, functionName: "latestRoundData", blockNumber: block.number }),
              client.readContract({ address, abi: oracleAbi, functionName: "decimals", blockNumber: block.number }),
              client.readContract({ address, abi: oracleAbi, functionName: "description", blockNumber: block.number }),
            ]);
            if (description !== source.validation_metadata.expectedDescription || decimals > 36 || round[1] <= 0n || round[3] === 0n || round[4] < round[0]) throw new Error("INVALID_ORACLE_MAPPING");
            price = formatUnits(round[1], decimals); sourceAt = new Date(Number(round[3]) * 1000).toISOString();
            metadata = { roundId: round[0].toString(), description };
          } else if (source.source_type === "otf_launch") {
            const deployment = protocolDeploymentForChain(asset.chainId)?.addresses;
            if (!deployment || !deployment.launchManager || deployment.otfToken?.toLowerCase() !== source.asset_address || deployment.launchManager.toLowerCase() !== source.oracle_address || !deployment.ethUsdOracle) throw new Error("INVALID_LAUNCH_MAPPING");
            const [wethPrice, round, decimals] = await Promise.all([
              client.readContract({ address: deployment.launchManager, abi: otfLaunchManagerAbi, functionName: "currentOtfPriceWethWad", blockNumber: block.number }),
              client.readContract({ address: deployment.ethUsdOracle, abi: oracleAbi, functionName: "latestRoundData", blockNumber: block.number }),
              client.readContract({ address: deployment.ethUsdOracle, abi: oracleAbi, functionName: "decimals", blockNumber: block.number }),
            ]);
            if (wethPrice <= 0n || round[1] <= 0n || round[3] === 0n || decimals > 36 || round[4] < round[0]) throw new Error("INVALID_LAUNCH_PRICE");
            price = formatFixedDecimal(wethPrice * round[1] * 10n ** 18n / 10n ** BigInt(decimals),36);
            sourceAt = new Date(Number(round[3] < block.timestamp ? round[3] : block.timestamp) * 1000).toISOString();
            metadata = { indicative: true, syntheticEthReference: asset.chainId === 46630 };
          } else throw new Error("UNSUPPORTED_PRICE_SOURCE");
        }
        const collectedAt = new Date().toISOString();
        const quality = priceQuality(sourceAt, collectedAt, source.max_age_seconds, marketClosed,Date.now(),source.validation_metadata.marketClosedMaxAgeSeconds);
        if (quality === "invalid") throw new Error("INVALID_OBSERVATION");
        await sql.transaction([
          sql.query(`SELECT ${schema}.require_collector_lease($1,$2)`,["prices",leaseToken]),
          sql.query(`INSERT INTO ${schema}.asset_prices(source_id,price_usd,source_at,collected_at,block_number,block_hash,quality,metadata)
            SELECT $1,$2,$3,$4,$5,$6,$7,$8::jsonb WHERE NOT EXISTS
            (SELECT 1 FROM ${schema}.asset_prices WHERE source_id=$1 AND source_at=$3 AND block_hash IS NOT DISTINCT FROM $6 AND price_usd=$2)
            ON CONFLICT DO NOTHING`, [source.id,price,sourceAt,collectedAt,blockNumber,blockHash,quality,JSON.stringify(metadata)]),
          sql.query(`UPDATE ${schema}.asset_price_sources SET validated_at=$2 WHERE id=$1 AND validated_at IS NULL`, [source.id,collectedAt]),
          sql.query(`INSERT INTO ${schema}.price_source_status(source_id,last_error) VALUES ($1,NULL) ON CONFLICT(source_id) DO UPDATE SET attempted_at=clock_timestamp(),last_error=NULL`,[source.id]),
        ]);
        if (quality !== "stale") valued.add(key);
        collected++;
      } catch(error) {
        failed++;
        const code=error instanceof Error && /^[A-Z_]{3,50}$/.test(error.message)?error.message:"SOURCE_UNAVAILABLE";
        await sql.transaction([sql.query(`SELECT ${schema}.require_collector_lease($1,$2)`,["prices",leaseToken]),sql.query(`INSERT INTO ${schema}.price_source_status(source_id,last_error) VALUES ($1,$2) ON CONFLICT(source_id) DO UPDATE SET attempted_at=clock_timestamp(),last_error=$2`,[source.id,code])]);
      }
    }
    return { collected, failed };
  });
}

export async function collectMarketCaps() {
  return withCollectorLease("market-caps", async (leaseToken) => {
    const started=Date.now();
    const { sql, schema } = database();
    const registry = await readRegistry();
    let collected = 0, failed = 0;
    const responses = new Map<string, Promise<unknown>>();
    const policies=await sql.query(`SELECT * FROM ${schema}.asset_price_sources WHERE approved AND source_type='yahoo'`);
    for (const asset of registry.assets.filter(asset => asset.enabled && ["stock_token","protocol_token"].includes(asset.assetType))) {
      if(Date.now()-started>60_000)break;
      try {
        let marketCap: string | undefined, sourceAt: string;
        if (asset.assetType === "protocol_token") {
          const [observation] = (await readPrices(asset.chainId)).filter(price => price.address.toLowerCase() === asset.address.toLowerCase() && price.usable);
          if (!observation) continue;
          const supply = await chainClient(asset.chainId).readContract({ address: asset.address, abi: erc20Abi, functionName: "totalSupply" });
          marketCap = formatFixedDecimal(supply * parseFixedDecimal(observation.priceUsd,36)! / 10n ** 18n,36);
          sourceAt = observation.priceUpdatedAt;
        } else {
          const policy=policies.find(source=>source.chain_id===asset.chainId && source.asset_address===asset.address.toLowerCase() && source.provider_id===asset.symbol && source.validation_metadata.expectedSymbol===asset.symbol);
          if(!policy)throw new Error("INVALID_STOCK_MAPPING");
          if(policy.validation_metadata.requireRobinhoodIdentity) {
            const endpoint=protocolDeploymentForChain(asset.chainId)?.assetDataEndpoint;
            if(!endpoint)throw new Error("INVALID_STOCK_IDENTITY");
            if(!responses.has(endpoint))responses.set(endpoint,fetchJson(endpoint));
            if(!mainnetStockAssetsFromRobinhood(await responses.get(endpoint),[asset]).length)throw new Error("INVALID_STOCK_IDENTITY");
          }
          const now = Math.floor(Date.now()/1000);
          if (!responses.has(asset.symbol)) responses.set(asset.symbol,fetchJson(`https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(asset.symbol)}?type=quarterlyMarketCap,trailingMarketCap&period1=${now-400*86400}&period2=${now+86400}`));
          const payload = await responses.get(asset.symbol)!;
          const observation=marketCapObservationFromYahoo(payload);
          if(!observation)throw new Error("MISSING_MARKET_CAP_TIMESTAMP");
          marketCap=observation.marketCapUsd;sourceAt=observation.sourceAt;
        }
        if (!marketCap) throw new Error("MARKET_CAP_UNAVAILABLE");
        await sql.transaction([sql.query(`SELECT ${schema}.require_collector_lease($1,$2)`,["market-caps",leaseToken]),sql.query(`INSERT INTO ${schema}.asset_market_caps(chain_id,asset_address,market_cap_usd,source_at,provider_id) VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT (chain_id,asset_address) DO UPDATE SET market_cap_usd=$3,source_at=$4,collected_at=clock_timestamp(),provider_id=$5`, [asset.chainId,asset.address.toLowerCase(),marketCap,sourceAt,asset.assetType === "protocol_token" ? "onchain-supply" : asset.symbol])]);
        collected++;
      } catch { failed++; }
    }
    return { collected, failed };
  });
}

export async function readPrices(chainId: number, asOf = new Date()) {
  const { sql, schema } = database();
  const rows = await sql.query(`SELECT a.*,s.id AS source_id,s.valuation_kind,s.max_age_seconds,s.priority,s.validation_metadata AS source_metadata,
    p.id AS price_id,p.price_usd::text,p.source_at,p.collected_at,p.metadata AS price_metadata,
    m.market_cap_usd::text,m.source_at AS market_cap_at
    FROM ${schema}.assets a JOIN ${schema}.asset_price_sources s ON s.chain_id=a.chain_id AND s.asset_address=a.address AND s.approved AND s.validated_at IS NOT NULL
    JOIN LATERAL (SELECT * FROM ${schema}.asset_prices p WHERE p.source_id=s.id AND p.source_at <= $2 AND p.collected_at <= $2 AND p.quality <> 'invalid' ORDER BY p.source_at DESC,p.collected_at DESC LIMIT 1) p ON true
    LEFT JOIN ${schema}.asset_market_caps m ON m.chain_id=a.chain_id AND m.asset_address=a.address
    WHERE a.chain_id=$1 AND a.enabled AND s.valuation_kind <> 'executable_quote' ORDER BY a.address,s.priority,s.id`, [chainId,asOf.toISOString()]);
  const best = new Map<string, ReturnType<typeof mapped>>();
  function mapped(row: typeof rows[number]) {
    const quality = priceQuality(row.source_at,row.collected_at,row.max_age_seconds,row.price_metadata.marketClosed===true,asOf.getTime(),row.source_metadata.marketClosedMaxAgeSeconds);
    return {
      address: getAddress(row.address), symbol: row.symbol, name: row.name, decimals: row.decimals as number,
      priceUsd: row.price_usd as string, priceUpdatedAt: row.source_at as string, collectedAt: row.collected_at as string,
      priceId: String(row.price_id), sourceId: row.source_id as string, valuationKind: row.valuation_kind as string,
      sourceMetadata: row.price_metadata as Record<string,unknown>,
      quality, usable: quality === "fresh" || quality === "market_closed", verified: row.verified as boolean,
      marketCapUsd: row.market_cap_at && Date.parse(row.market_cap_at)<=asOf.getTime() && asOf.getTime()-Date.parse(row.market_cap_at)<=120*86400_000 ? row.market_cap_usd as string : undefined, marketCapUpdatedAt: row.market_cap_at as string | undefined,
    };
  }
  for (const row of rows) { const value = mapped(row), previous = best.get(row.address); if (!previous || !previous.usable && value.usable) best.set(row.address,value); }
  return [...best.values()];
}
