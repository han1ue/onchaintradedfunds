import { createPublicClient, defineChain, getAddress, http, type Address } from "viem";
import { requireDb } from "./db";
import { assetEligibilitySnapshots, assetPools, eligibleAssets } from "./db/schema";
import { env } from "./env";

export const ROBINHOOD_CHAIN_ID = 4663;
export const USDG_ADDRESS = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
const FEE_TIERS = [100, 500, 3000, 10000] as const;

const robinhoodChain = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [env.ROBINHOOD_RPC_URL] } }
});
const client = createPublicClient({ chain: robinhoodChain, transport: http(env.ROBINHOOD_RPC_URL) });

const factoryAbi = [{ type: "function", name: "getPool", stateMutability: "view", inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }, { name: "fee", type: "uint24" }], outputs: [{ name: "pool", type: "address" }] }] as const;
const poolAbi = [
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "liquidity", stateMutability: "view", inputs: [], outputs: [{ type: "uint128" }] },
  { type: "function", name: "slot0", stateMutability: "view", inputs: [], outputs: [{ type: "uint160" }, { type: "int24" }, { type: "uint16" }, { type: "uint16" }, { type: "uint16" }, { type: "uint8" }, { type: "bool" }] }
] as const;
const erc20Abi = [{ type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] }] as const;
const quoterAbi = [{
  type: "function", name: "quoteExactInputSingle", stateMutability: "nonpayable",
  inputs: [{ name: "params", type: "tuple", components: [{ name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" }, { name: "amountIn", type: "uint256" }, { name: "fee", type: "uint24" }, { name: "sqrtPriceLimitX96", type: "uint160" }] }],
  outputs: [{ name: "amountOut", type: "uint256" }, { name: "sqrtPriceX96After", type: "uint160" }, { name: "initializedTicksCrossed", type: "uint32" }, { name: "gasEstimate", type: "uint256" }]
}] as const;

type RobinhoodAsset = { uid: string; symbol: string; name: string; status: string; multiplier?: string | number; logoUrl?: string; deployments?: { chainId: number; address: string }[] };
type RobinhoodRawAsset = {
  id?: string; uid?: string; tokenSymbol?: string; symbol?: string; tokenName?: string; name?: string;
  status?: string; currentMultiplier?: string; multiplier?: string | number; logoUrl?: string; logo_url?: string;
  deployments?: { chainId?: number; chain_id?: number; contractAddress?: string; address?: string }[];
};

export async function fetchRobinhoodAssets(): Promise<RobinhoodAsset[]> {
  const response = await fetch("https://api.robinhood.com/rhj/assets", { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error("ROBINHOOD_ASSETS_UNAVAILABLE");
  const json = await response.json() as RobinhoodRawAsset[] | { assets?: RobinhoodRawAsset[]; results?: RobinhoodRawAsset[]; data?: RobinhoodRawAsset[] | { assets?: RobinhoodRawAsset[] } };
  const raw = Array.isArray(json) ? json : json.assets ?? json.results ?? (Array.isArray(json.data) ? json.data : json.data?.assets) ?? [];
  return raw.flatMap((asset) => {
    const uid = asset.id ?? asset.uid; const symbol = asset.tokenSymbol ?? asset.symbol; const name = asset.tokenName ?? asset.name;
    if (!uid || !symbol || !name) return [];
    return [{ uid, symbol, name, status: asset.status === "ASSET_STATUS_ACTIVE" || asset.status === "active" ? "active" : asset.status ?? "unknown", multiplier: asset.currentMultiplier ?? asset.multiplier, logoUrl: asset.logoUrl ?? asset.logo_url, deployments: asset.deployments?.flatMap((deployment) => { const chainId = deployment.chainId ?? deployment.chain_id; const address = deployment.contractAddress ?? deployment.address; return chainId && address ? [{ chainId, address }] : []; }) }];
  });
}

function decimalToFixed(value: string | number, scale = 18) {
  const [whole = "0", fraction = ""] = String(value).split(".");
  return BigInt(whole || "0") * 10n ** BigInt(scale) + BigInt((fraction + "0".repeat(scale)).slice(0, scale));
}

export async function fetchRobinhoodPrice(symbol: string) {
  const response = await fetch(`https://api.robinhood.com/rhj/prices/${encodeURIComponent(symbol)}`, { headers: { Accept: "application/json" }, cache: "no-store" });
  if (!response.ok) throw new Error("ROBINHOOD_PRICE_UNAVAILABLE");
  const json = await response.json() as { quotes?: { bid: string; ask: string; isTradingHalt?: boolean; generatedAt?: string }[] };
  const quote = json.quotes?.[0];
  if (!quote || quote.isTradingHalt) throw new Error("ROBINHOOD_PRICE_UNAVAILABLE");
  return quote;
}

export async function inspectDirectPool(assetAddress: Address, reference?: { bid: string; ask: string; multiplier: string }) {
  if (!env.UNISWAP_V3_FACTORY_ADDRESS || !env.UNISWAP_V3_QUOTER_ADDRESS) throw new Error("UNISWAP_NOT_CONFIGURED");
  const factory = getAddress(env.UNISWAP_V3_FACTORY_ADDRESS);
  const quoter = getAddress(env.UNISWAP_V3_QUOTER_ADDRESS);
  for (const fee of FEE_TIERS) {
    const pool = await client.readContract({ address: factory, abi: factoryAbi, functionName: "getPool", args: [assetAddress, USDG_ADDRESS, fee] });
    if (/^0x0{40}$/i.test(pool)) continue;
    const address = getAddress(pool);
    const [bytecode, token0, token1, liquidity, slot0, blockNumber, assetDecimals, usdgDecimals] = await Promise.all([
      client.getBytecode({ address }),
      client.readContract({ address, abi: poolAbi, functionName: "token0" }),
      client.readContract({ address, abi: poolAbi, functionName: "token1" }),
      client.readContract({ address, abi: poolAbi, functionName: "liquidity" }),
      client.readContract({ address, abi: poolAbi, functionName: "slot0" }),
      client.getBlockNumber(),
      client.readContract({ address: assetAddress, abi: erc20Abi, functionName: "decimals" }),
      client.readContract({ address: USDG_ADDRESS, abi: erc20Abi, functionName: "decimals" })
    ]);
    const pair = new Set([token0.toLowerCase(), token1.toLowerCase()]);
    if (!bytecode || !pair.has(assetAddress.toLowerCase()) || !pair.has(USDG_ADDRESS.toLowerCase()) || liquidity === 0n || slot0[0] === 0n) continue;
    const notional = 1_000n * 10n ** BigInt(usdgDecimals);
    try {
      const buy = await client.simulateContract({ address: quoter, abi: quoterAbi, functionName: "quoteExactInputSingle", args: [{ tokenIn: USDG_ADDRESS, tokenOut: assetAddress, amountIn: notional, fee, sqrtPriceLimitX96: 0n }] });
      const assetOut = buy.result[0];
      const multiplierFixed = decimalToFixed(reference?.multiplier ?? "1");
      const askFixed = decimalToFixed(reference?.ask ?? "0") * multiplierFixed / 10n ** 18n;
      const bidFixed = decimalToFixed(reference?.bid ?? "0") * multiplierFixed / 10n ** 18n;
      if (askFixed <= 0n || bidFixed <= 0n) throw new Error("reference-price-missing");
      const expectedBuyOut = 1_000n * 10n ** BigInt(assetDecimals) * 10n ** 18n / askFixed;
      const sellInput = 1_000n * 10n ** BigInt(assetDecimals) * 10n ** 18n / bidFixed;
      const sell = await client.simulateContract({ address: quoter, abi: quoterAbi, functionName: "quoteExactInputSingle", args: [{ tokenIn: assetAddress, tokenOut: USDG_ADDRESS, amountIn: sellInput, fee, sqrtPriceLimitX96: 0n }] });
      const usdgOut = sell.result[0];
      const buyImpactBps = Number((assetOut > expectedBuyOut ? assetOut - expectedBuyOut : expectedBuyOut - assetOut) * 10_000n / expectedBuyOut);
      const sellImpactBps = Number((usdgOut > notional ? usdgOut - notional : notional - usdgOut) * 10_000n / notional);
      const eligible = buyImpactBps <= 200 && sellImpactBps <= 200;
      return { poolAddress: address, feeTier: fee, liquidity, blockNumber, buyQuoteOut: assetOut, sellQuoteOut: usdgOut, buyImpactBps, sellImpactBps, eligible, reason: eligible ? "two-way-quotes-pass" : "price-impact" };
    } catch {
      return { poolAddress: address, feeTier: fee, liquidity, blockNumber, eligible: false, reason: "quote-failed" };
    }
  }
  return { eligible: false, reason: "no-direct-v3-pool" } as const;
}

export async function reconcileEligibleAssets() {
  const database = requireDb();
  const remote = await fetchRobinhoodAssets();
  const results: { symbol: string; eligible: boolean; reason: string }[] = [];
  for (const asset of remote) {
    const deployment = asset.deployments?.find((item) => item.chainId === ROBINHOOD_CHAIN_ID);
    if (!deployment || asset.status !== "active") continue;
    const [record] = await database.insert(eligibleAssets).values({
      robinhoodUid: asset.uid, contractAddress: getAddress(deployment.address), symbol: asset.symbol, name: asset.name,
      logoUrl: asset.logoUrl, status: asset.status, multiplier: String(asset.multiplier ?? 1), lastSeenAt: new Date()
    }).onConflictDoUpdate({ target: eligibleAssets.robinhoodUid, set: { contractAddress: getAddress(deployment.address), symbol: asset.symbol, name: asset.name, logoUrl: asset.logoUrl, status: asset.status, multiplier: String(asset.multiplier ?? 1), lastSeenAt: new Date(), updatedAt: new Date() } }).returning();
    const price = await fetchRobinhoodPrice(asset.symbol);
    const inspection = await inspectDirectPool(getAddress(deployment.address), { bid: price.bid, ask: price.ask, multiplier: String(asset.multiplier ?? 1) });
    let poolId: string | undefined;
    if ("poolAddress" in inspection && inspection.poolAddress && inspection.feeTier !== undefined) {
      const [pool] = await database.insert(assetPools).values({ assetId: record.id, poolAddress: inspection.poolAddress, usdgAddress: USDG_ADDRESS, feeTier: inspection.feeTier })
        .onConflictDoUpdate({ target: assetPools.poolAddress, set: { feeTier: inspection.feeTier, updatedAt: new Date() } }).returning();
      poolId = pool.id;
    }
    await database.insert(assetEligibilitySnapshots).values({
      assetId: record.id, poolId, blockNumber: "blockNumber" in inspection ? inspection.blockNumber?.toString() : undefined,
      liquidity: "liquidity" in inspection ? inspection.liquidity?.toString() : undefined,
      buyQuoteOut: "buyQuoteOut" in inspection ? inspection.buyQuoteOut?.toString() : undefined,
      sellQuoteOut: "sellQuoteOut" in inspection ? inspection.sellQuoteOut?.toString() : undefined,
      buyPriceImpactBps: "buyImpactBps" in inspection ? inspection.buyImpactBps : undefined,
      sellPriceImpactBps: "sellImpactBps" in inspection ? inspection.sellImpactBps : undefined,
      eligible: inspection.eligible, reason: inspection.reason,
      rawEvidence: { chainId: ROBINHOOD_CHAIN_ID, usdg: USDG_ADDRESS }
    });
    results.push({ symbol: asset.symbol, eligible: inspection.eligible, reason: inspection.reason });
  }
  return results;
}
