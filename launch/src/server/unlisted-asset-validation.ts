import { z } from "zod";
import type {
  AssetMarketRequirement,
  AssetMarketRequirementStatus,
  AssetMarketValidationResponse,
} from "@/lib/asset-market-validation";
import { evaluateCompetitionPoolAge, MARKET_EVIDENCE_THRESHOLDS } from "@/lib/market-evidence-policy";
import { getCoinGeckoClient } from "./coingecko";
import { env } from "./env";
import { cachedAssetValidation } from "./validation-cache";

const rpcResponseSchema = z.object({
  result: z.string().optional(),
  error: z.unknown().optional(),
}).passthrough();

const selectors = {
  name: "0x06fdde03",
  symbol: "0x95d89b41",
  decimals: "0x313ce567",
  totalSupply: "0x18160ddd",
  factory: "0xc45a0155",
  token0: "0x0dfe1681",
  token1: "0xd21220a7",
  fee: "0xddca3f43",
  slot0: "0x3850c7bd",
  liquidity: "0x1a686502",
  getPool: "0x1698ee82",
  feeAmountTickSpacing: "0x22afcccb",
  observe: "0x883bdbfd",
} as const;

const addressPattern = /^0x[0-9a-f]{40}$/;
const rpcTimeoutMs = 8_000;
const minimumObservationCardinality = 64;

type RpcRead<T> = { value: T | null; error: Error | null };
type PoolBasics = {
  factory: string;
  token0: string;
  token1: string;
  fee: number;
  sqrtPriceX96: bigint;
  observationCardinality: number;
  liquidity: bigint;
};

function normalizeAddress(value: string) {
  return value.toLowerCase();
}

function decodeWord(result: string, index = 0) {
  const hex = result.replace(/^0x/, "");
  const word = hex.slice(index * 64, index * 64 + 64);
  if (word.length !== 64) throw new Error("RPC_INVALID_RESULT");
  return word;
}

function decodeAddress(result: string) {
  const address = `0x${decodeWord(result).slice(-40)}`.toLowerCase();
  if (!addressPattern.test(address)) throw new Error("RPC_INVALID_RESULT");
  return address;
}

function decodeUint(result: string, index = 0) {
  return BigInt(`0x${decodeWord(result, index)}`);
}

function decodeInt(result: string) {
  const value = decodeUint(result);
  const sign = 1n << 255n;
  return Number(value >= sign ? value - (1n << 256n) : value);
}

function decodeText(result: string) {
  const hex = result.replace(/^0x/, "");
  if (hex.length < 64) throw new Error("RPC_INVALID_RESULT");
  const firstWord = BigInt(`0x${hex.slice(0, 64)}`);
  const dynamicOffset = Number(firstWord) * 2;
  if (dynamicOffset >= 64 && hex.length >= dynamicOffset + 64) {
    const length = Number(BigInt(`0x${hex.slice(dynamicOffset, dynamicOffset + 64)}`));
    const encoded = hex.slice(dynamicOffset + 64, dynamicOffset + 64 + length * 2);
    if (encoded.length === length * 2) return Buffer.from(encoded, "hex").toString("utf8").replace(/\0+$/g, "").trim();
  }
  return Buffer.from(hex.slice(-Math.floor(hex.length / 2) * 2), "hex").toString("utf8").replace(/\0+$/g, "").trim();
}

function encodeAddress(address: string) {
  return address.replace(/^0x/, "").padStart(64, "0");
}

function encodeUint(value: number) {
  return BigInt(value).toString(16).padStart(64, "0");
}

async function rpcCall(to: string, data: string) {
  const response = await fetch(env.ROBINHOOD_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
    cache: "no-store",
    signal: AbortSignal.timeout(rpcTimeoutMs),
  });
  if (!response.ok) throw new Error(`ROBINHOOD_RPC_${response.status}`);
  const payload = rpcResponseSchema.parse(await response.json());
  if (payload.error || !payload.result) throw new Error("ROBINHOOD_RPC_CALL_FAILED");
  return payload.result;
}

async function safeRead<T>(load: () => Promise<T>): Promise<RpcRead<T>> {
  try {
    return { value: await load(), error: null };
  } catch (error) {
    return { value: null, error: error instanceof Error ? error : new Error("ROBINHOOD_RPC_CALL_FAILED") };
  }
}

function requirement(
  key: string,
  label: string,
  required: string,
  observed: string | number | boolean | null,
  status: AssetMarketRequirementStatus,
  source: AssetMarketRequirement["source"],
): AssetMarketRequirement {
  return { key, label, required, observed, status, source };
}

function statusForValue<T>(value: T | null, passes: (value: T) => boolean, unavailable = false): AssetMarketRequirementStatus {
  if (unavailable) return "unavailable";
  if (value === null) return "pending";
  return passes(value) ? "pass" : "fail";
}

function overallStatus(requirements: AssetMarketRequirement[]): AssetMarketRequirementStatus {
  if (requirements.some((item) => item.status === "fail")) return "fail";
  if (requirements.some((item) => item.status === "unavailable")) return "unavailable";
  if (requirements.some((item) => item.status === "pending")) return "pending";
  return "pass";
}

function configuredCanonicalAddresses() {
  const factory = env.ROBINHOOD_V3_FACTORY_ADDRESS?.toLowerCase() ?? null;
  const weth = env.ROBINHOOD_WETH_ADDRESS?.toLowerCase() ?? null;
  const usdg = env.ROBINHOOD_USDG_ADDRESS?.toLowerCase() ?? null;
  const supportedFees = env.ROBINHOOD_V3_SUPPORTED_FEES.split(",")
    .map((fee) => Number(fee.trim()))
    .filter((fee) => Number.isInteger(fee) && fee > 0);
  return { factory, weth, usdg, supportedFees };
}

function providerUnavailableRequirements(): AssetMarketRequirement[] {
  return [
    requirement("pool-age", "Pool age", "At least 7 days before competition start", null, "unavailable", "geckoterminal"),
    requirement("liquidity-usd", "USD liquidity", `At least $${MARKET_EVIDENCE_THRESHOLDS.liquidityUsd.toLocaleString()}`, null, "unavailable", "geckoterminal"),
    requirement("verified-market-cap", "Verified market cap", `At least $${MARKET_EVIDENCE_THRESHOLDS.marketCapUsd.toLocaleString()} (market cap only)`, null, "unavailable", "geckoterminal"),
    requirement("gt-verified", "GT verification", "Verified", null, "unavailable", "geckoterminal"),
    requirement("gt-score", "GT score", `At least ${MARKET_EVIDENCE_THRESHOLDS.gtScore}`, null, "unavailable", "geckoterminal"),
    requirement("honeypot", "Honeypot status", "Not a honeypot", null, "unavailable", "geckoterminal"),
    requirement("locked-liquidity", "Locked liquidity", `At least ${MARKET_EVIDENCE_THRESHOLDS.lockedLiquidityPct}%`, null, "unavailable", "geckoterminal"),
  ];
}

function poolPendingRequirements(): AssetMarketRequirement[] {
  return [
    requirement("canonical-pool", "Canonical pool", "Uniswap V3 pool from the configured factory", null, "pending", "robinhood-rpc"),
    requirement("asset-in-pool", "Asset in pool", "Submitted contract is token0 or token1", null, "pending", "robinhood-rpc"),
    requirement("quote-token", "Quote token", "Exactly canonical WETH or USDG", null, "pending", "robinhood-rpc"),
    requirement("factory", "Pool factory", "Configured canonical factory", null, "pending", "robinhood-rpc"),
    requirement("factory-pool", "Factory lookup", "factory.getPool() equals submitted pool", null, "pending", "robinhood-rpc"),
    requirement("fee", "Pool fee", "One of the configured supported fees", null, "pending", "robinhood-rpc"),
    requirement("initialized", "Pool initialized", "Initialized sqrt price", null, "pending", "robinhood-rpc"),
    requirement("observation-cardinality", "Observation cardinality", `At least ${minimumObservationCardinality}`, null, "pending", "robinhood-rpc"),
    requirement("one-hour-observe", "One-hour observation", "observe([3600, 0]) succeeds", null, "pending", "robinhood-rpc"),
    requirement("pool-age", "Pool age", "At least 7 days before competition start", null, "pending", "geckoterminal"),
    requirement("liquidity-usd", "USD liquidity", `At least $${MARKET_EVIDENCE_THRESHOLDS.liquidityUsd.toLocaleString()}`, null, "pending", "geckoterminal"),
    requirement("locked-liquidity", "Locked liquidity", `At least ${MARKET_EVIDENCE_THRESHOLDS.lockedLiquidityPct}%`, null, "pending", "geckoterminal"),
  ];
}

type ValidationResult = AssetMarketValidationResponse & { marketDetails: {
  factoryAddress: string;
  quoteTokenAddress: string;
  feeTier: number;
  poolCreatedAt: Date | null;
} | null };

async function validateTokenOnly(assetAddress: string): Promise<ValidationResult> {
  return cachedAssetValidation(`token:${assetAddress}`, async () => {
    const [name, symbol, decimals, totalSupply] = await Promise.all([
      safeRead(() => rpcCall(assetAddress, selectors.name).then(decodeText)),
      safeRead(() => rpcCall(assetAddress, selectors.symbol).then(decodeText)),
      safeRead(() => rpcCall(assetAddress, selectors.decimals).then(decodeUint).then(Number)),
      safeRead(() => rpcCall(assetAddress, selectors.totalSupply).then(decodeUint)),
    ]);
    const tokenRpcReady = name.value !== null && symbol.value !== null && decimals.value === 18 && totalSupply.value !== null;
    const tokenRequirements: AssetMarketRequirement[] = [
      requirement("erc20-contract", "ERC-20 contract", "Readable name, symbol, decimals, and total supply", Boolean(name.value && symbol.value && decimals.value !== null && totalSupply.value !== null), name.error !== null || symbol.error !== null || decimals.error !== null || totalSupply.error !== null ? "unavailable" : tokenRpcReady ? "pass" : "fail", "robinhood-rpc"),
      requirement("token-decimals", "Token decimals", "Exactly 18", decimals.value, statusForValue(decimals.value, (value) => value === 18, Boolean(decimals.error)), "robinhood-rpc"),
    ];
    const asset = name.value !== null && symbol.value !== null && decimals.value !== null && totalSupply.value !== null
      ? { address: assetAddress, name: name.value, symbol: symbol.value.toUpperCase(), decimals: decimals.value }
      : null;
    const providerRequirements: AssetMarketRequirement[] = tokenRpcReady && env.COINGECKO_NETWORK_ID
      ? await (async () => {
        const client = getCoinGeckoClient();
        const [tokenProvider, infoProvider] = await Promise.all([
          safeRead(() => client.getToken(env.COINGECKO_NETWORK_ID!, assetAddress)),
          safeRead(() => client.getTokenInfo(env.COINGECKO_NETWORK_ID!, assetAddress)),
        ]);
        const marketCap = tokenProvider.value?.data.attributes.market_cap_usd === null || tokenProvider.value?.data.attributes.market_cap_usd === undefined ? null : Number(tokenProvider.value.data.attributes.market_cap_usd);
        const gtScore = infoProvider.value?.data.attributes.gt_score === null || infoProvider.value?.data.attributes.gt_score === undefined ? null : Number(infoProvider.value.data.attributes.gt_score);
        return [
          requirement("verified-market-cap", "Verified market cap", `At least $${MARKET_EVIDENCE_THRESHOLDS.marketCapUsd.toLocaleString()} (market cap only)`, marketCap, tokenProvider.error !== null ? "unavailable" : statusForValue(marketCap, (value) => Number.isFinite(value) && value >= MARKET_EVIDENCE_THRESHOLDS.marketCapUsd), "geckoterminal"),
          requirement("gt-verified", "GT verification", "Verified", infoProvider.value?.data.attributes.gt_verified ?? null, infoProvider.error !== null ? "unavailable" : statusForValue(infoProvider.value?.data.attributes.gt_verified ?? null, (value) => value === true), "geckoterminal"),
          requirement("gt-score", "GT score", `At least ${MARKET_EVIDENCE_THRESHOLDS.gtScore}`, gtScore, infoProvider.error !== null ? "unavailable" : statusForValue(gtScore, (value) => Number.isFinite(value) && value >= MARKET_EVIDENCE_THRESHOLDS.gtScore), "geckoterminal"),
          requirement("honeypot", "Honeypot status", "Not a honeypot", infoProvider.value?.data.attributes.is_honeypot ?? null, infoProvider.error !== null ? "unavailable" : statusForValue(infoProvider.value?.data.attributes.is_honeypot ?? null, (value) => value === false), "geckoterminal"),
        ];
      })()
      : [
        requirement("verified-market-cap", "Verified market cap", `At least $${MARKET_EVIDENCE_THRESHOLDS.marketCapUsd.toLocaleString()} (market cap only)`, null, "unavailable", "geckoterminal"),
        requirement("gt-verified", "GT verification", "Verified", null, "unavailable", "geckoterminal"),
        requirement("gt-score", "GT score", `At least ${MARKET_EVIDENCE_THRESHOLDS.gtScore}`, null, "unavailable", "geckoterminal"),
        requirement("honeypot", "Honeypot status", "Not a honeypot", null, "unavailable", "geckoterminal"),
      ];
    const requirements = [...tokenRequirements, ...providerRequirements, ...poolPendingRequirements()];
    return {
      status: overallStatus(requirements),
      asset,
      market: { poolAddress: null, factoryAddress: null, quoteTokenAddress: null, feeTier: null, poolCreatedAt: null },
      requirements,
      marketDetails: null,
    };
  });
}

async function validateFullUnlistedAsset(input: {
  assetAddress: string;
  poolAddress: string;
  competitionStartsAt: Date | null;
}): Promise<ValidationResult> {
  const assetAddress = normalizeAddress(input.assetAddress);
  const poolAddress = normalizeAddress(input.poolAddress);
  const canonical = configuredCanonicalAddresses();
  const rpcRequirements: AssetMarketRequirement[] = [];
  const emptyMarket = { poolAddress, factoryAddress: null, quoteTokenAddress: null, feeTier: null, poolCreatedAt: null };

  if (!canonical.factory || !canonical.weth || !canonical.usdg) {
    const requirements = [
      requirement("erc20-contract", "ERC-20 contract", "Readable name, symbol, decimals, and total supply", null, "unavailable", "robinhood-rpc"),
      requirement("token-decimals", "Token decimals", "Exactly 18", null, "unavailable", "robinhood-rpc"),
      requirement("canonical-pool", "Canonical pool", "Uniswap V3 pool from the configured factory", null, "unavailable", "robinhood-rpc"),
      requirement("asset-in-pool", "Asset in pool", "Submitted contract is token0 or token1", null, "unavailable", "robinhood-rpc"),
      requirement("quote-token", "Quote token", "Exactly canonical WETH or USDG", null, "unavailable", "robinhood-rpc"),
      requirement("factory", "Pool factory", "Configured canonical factory", null, "unavailable", "robinhood-rpc"),
      requirement("factory-pool", "Factory lookup", "factory.getPool() equals submitted pool", null, "unavailable", "robinhood-rpc"),
      requirement("fee", "Pool fee", `One of ${canonical.supportedFees.join(", ")}`, null, "unavailable", "robinhood-rpc"),
      requirement("initialized", "Pool initialized", "Initialized sqrt price", null, "unavailable", "robinhood-rpc"),
      requirement("observation-cardinality", "Observation cardinality", `At least ${minimumObservationCardinality}`, null, "unavailable", "robinhood-rpc"),
      requirement("one-hour-observe", "One-hour observation", "observe([3600, 0]) succeeds", null, "unavailable", "robinhood-rpc"),
      ...providerUnavailableRequirements(),
    ];
    return { status: overallStatus(requirements), asset: null, market: emptyMarket, requirements, marketDetails: null };
  }

  const [name, symbol, decimals, totalSupply, factory, token0, token1, fee, slot0, liquidity] = await Promise.all([
    safeRead(() => rpcCall(assetAddress, selectors.name).then(decodeText)),
    safeRead(() => rpcCall(assetAddress, selectors.symbol).then(decodeText)),
    safeRead(() => rpcCall(assetAddress, selectors.decimals).then(decodeUint).then(Number)),
    safeRead(() => rpcCall(assetAddress, selectors.totalSupply).then(decodeUint)),
    safeRead(() => rpcCall(poolAddress, selectors.factory).then(decodeAddress)),
    safeRead(() => rpcCall(poolAddress, selectors.token0).then(decodeAddress)),
    safeRead(() => rpcCall(poolAddress, selectors.token1).then(decodeAddress)),
    safeRead(() => rpcCall(poolAddress, selectors.fee).then(decodeUint).then(Number)),
    safeRead(() => rpcCall(poolAddress, selectors.slot0).then((result) => ({
      sqrtPriceX96: decodeUint(result, 0),
      observationCardinality: Number(decodeUint(result, 3)),
    }))),
    safeRead(() => rpcCall(poolAddress, selectors.liquidity).then(decodeUint)),
  ]);

  const hasPoolTokens = token0.value !== null && token1.value !== null;
  const quoteToken = token0.value === assetAddress ? token1.value : token1.value === assetAddress ? token0.value : null;
  const quoteIsCanonical = quoteToken === canonical.weth || quoteToken === canonical.usdg;
  const feeSupportedByConfig = fee.value !== null && canonical.supportedFees.includes(fee.value);
  const factoryLookup = hasPoolTokens && fee.value !== null
    ? await safeRead(() => rpcCall(canonical.factory!, `${selectors.getPool}${encodeAddress(token0.value!)}${encodeAddress(token1.value!)}${encodeUint(fee.value!)}`).then(decodeAddress))
    : { value: null, error: new Error("ROBINHOOD_RPC_PREREQUISITE_FAILED") };
  const feeSpacing = feeSupportedByConfig
    ? await safeRead(() => rpcCall(canonical.factory!, `${selectors.feeAmountTickSpacing}${encodeUint(fee.value!)}`).then(decodeInt))
    : { value: null, error: fee.value === null ? new Error("ROBINHOOD_RPC_PREREQUISITE_FAILED") : null };

  const poolBasics: PoolBasics | null = factory.value !== null && token0.value !== null && token1.value !== null
    && fee.value !== null && slot0.value !== null && liquidity.value !== null
    ? { factory: factory.value, token0: token0.value, token1: token1.value, fee: fee.value, ...slot0.value, liquidity: liquidity.value }
    : null;
  const rpcChecksReady = poolBasics !== null
    && name.value !== null
    && symbol.value !== null
    && decimals.value === 18
    && totalSupply.value !== null
    && factoryLookup.value !== null
    && feeSpacing.value !== null
    && factory.value === canonical.factory
    && hasPoolTokens
    && quoteIsCanonical
    && quoteToken !== null
    && fee.value !== null
    && feeSpacing.value > 0
    && slot0.value?.sqrtPriceX96 !== 0n
    && (slot0.value?.observationCardinality ?? 0) >= minimumObservationCardinality;
  const observe = rpcChecksReady
    ? await safeRead(() => rpcCall(poolAddress, `${selectors.observe}${encodeUint(32)}${encodeUint(2)}${encodeUint(3_600)}${encodeUint(0)}`).then((result) => {
      if (decodeUint(result, 0) < 0n) throw new Error("ROBINHOOD_RPC_INVALID_RESULT");
      return true;
    }))
    : { value: null, error: new Error("ROBINHOOD_RPC_PREREQUISITE_FAILED") };

  rpcRequirements.push(
    requirement("erc20-contract", "ERC-20 contract", "Readable name, symbol, decimals, and total supply", Boolean(name.value && symbol.value && decimals.value !== null && totalSupply.value !== null), name.error !== null || symbol.error !== null || decimals.error !== null || totalSupply.error !== null ? "unavailable" : name.value && symbol.value && decimals.value !== null && totalSupply.value !== null ? "pass" : "fail", "robinhood-rpc"),
    requirement("token-decimals", "Token decimals", "Exactly 18", decimals.value, statusForValue(decimals.value, (value) => value === 18, Boolean(decimals.error)), "robinhood-rpc"),
    requirement("canonical-pool", "Canonical pool", "Uniswap V3 pool from the configured factory", factory.value === canonical.factory && factoryLookup.value === poolAddress, factory.error !== null || factoryLookup.error !== null ? "unavailable" : factory.value === canonical.factory && factoryLookup.value === poolAddress ? "pass" : "fail", "robinhood-rpc"),
    requirement("asset-in-pool", "Asset in pool", "Submitted contract is token0 or token1", hasPoolTokens ? token0.value === assetAddress || token1.value === assetAddress : null, token0.error !== null || token1.error !== null ? "unavailable" : hasPoolTokens ? token0.value === assetAddress || token1.value === assetAddress ? "pass" : "fail" : "pending", "robinhood-rpc"),
    requirement("quote-token", "Quote token", "Exactly canonical WETH or USDG", quoteToken, hasPoolTokens ? (quoteIsCanonical ? "pass" : "fail") as AssetMarketRequirementStatus : "unavailable", "robinhood-rpc"),
    requirement("factory", "Pool factory", "Configured canonical factory", factory.value, factory.error !== null ? "unavailable" : factory.value === canonical.factory ? "pass" : "fail", "robinhood-rpc"),
    requirement("factory-pool", "Factory lookup", "factory.getPool() equals submitted pool", factoryLookup.value, factoryLookup.error !== null ? "unavailable" : factoryLookup.value === poolAddress ? "pass" : "fail", "robinhood-rpc"),
    requirement("fee", "Pool fee", `One of ${canonical.supportedFees.join(", ")}`, fee.value, fee.error !== null || feeSpacing.error !== null ? "unavailable" : feeSupportedByConfig && feeSpacing.value !== null && feeSpacing.value > 0 ? "pass" : "fail", "robinhood-rpc"),
    requirement("initialized", "Pool initialized", "Initialized sqrt price", slot0.value?.sqrtPriceX96.toString() ?? null, slot0.error !== null ? "unavailable" : slot0.value?.sqrtPriceX96 !== 0n ? "pass" : "fail", "robinhood-rpc"),
    requirement("observation-cardinality", "Observation cardinality", `At least ${minimumObservationCardinality}`, slot0.value?.observationCardinality ?? null, slot0.error !== null ? "unavailable" : statusForValue(slot0.value?.observationCardinality ?? null, (value) => value >= minimumObservationCardinality), "robinhood-rpc"),
    requirement("one-hour-observe", "One-hour observation", "observe([3600, 0]) succeeds", observe.value, observe.error !== null ? (rpcChecksReady ? "fail" : "unavailable") : "pass", "robinhood-rpc"),
  );

  const asset = name.value !== null && symbol.value !== null && decimals.value !== null && totalSupply.value !== null
    ? { address: assetAddress, name: name.value, symbol: symbol.value.toUpperCase(), decimals: decimals.value }
    : null;
  const market = {
    poolAddress,
    factoryAddress: factory.value,
    quoteTokenAddress: quoteToken,
    feeTier: fee.value,
    poolCreatedAt: null,
  };
  if (rpcRequirements.some((item) => item.status !== "pass")) {
    const requirements = [...rpcRequirements, ...providerUnavailableRequirements()];
    return { status: overallStatus(requirements), asset, market, requirements, marketDetails: null };
  }

  if (!env.COINGECKO_NETWORK_ID) {
    const requirements = [...rpcRequirements, ...providerUnavailableRequirements()];
    return { status: overallStatus(requirements), asset, market, requirements, marketDetails: null };
  }

  const client = getCoinGeckoClient();
  const providerResults = await Promise.all([
    safeRead(() => client.getPool(env.COINGECKO_NETWORK_ID!, poolAddress)),
    safeRead(() => client.getToken(env.COINGECKO_NETWORK_ID!, assetAddress)),
    safeRead(() => client.getTokenInfo(env.COINGECKO_NETWORK_ID!, assetAddress)),
  ]);
  const poolProvider = providerResults[0].value;
  const tokenProvider = providerResults[1].value;
  const infoProvider = providerResults[2].value;
  const providerErrors = providerResults.map((result) => result.error !== null);
  const poolAttributes = poolProvider?.data.attributes;
  const tokenAttributes = tokenProvider?.data.attributes;
  const infoAttributes = infoProvider?.data.attributes;
  const poolCreatedAt = poolAttributes?.pool_created_at && !Number.isNaN(new Date(poolAttributes.pool_created_at).getTime())
    ? new Date(poolAttributes.pool_created_at)
    : null;
  const liquidityUsd = poolAttributes?.reserve_in_usd === null || poolAttributes?.reserve_in_usd === undefined ? null : Number(poolAttributes.reserve_in_usd);
  const lockedLiquidityPct = poolAttributes?.locked_liquidity_percentage === null || poolAttributes?.locked_liquidity_percentage === undefined ? null : Number(poolAttributes.locked_liquidity_percentage);
  const marketCapUsd = tokenAttributes?.market_cap_usd === null || tokenAttributes?.market_cap_usd === undefined ? null : Number(tokenAttributes.market_cap_usd);
  const gtScore = infoAttributes?.gt_score === null || infoAttributes?.gt_score === undefined ? null : Number(infoAttributes.gt_score);
  const providerRequirements = [
    requirement("pool-age", "Pool age", "At least 7 days before competition start", poolCreatedAt?.toISOString() ?? null, providerErrors[0] ? "unavailable" : evaluateCompetitionPoolAge(poolCreatedAt, input.competitionStartsAt).status.toLowerCase() as AssetMarketRequirementStatus, "geckoterminal"),
    requirement("liquidity-usd", "USD liquidity", `At least $${MARKET_EVIDENCE_THRESHOLDS.liquidityUsd.toLocaleString()}`, liquidityUsd, providerErrors[0] ? "unavailable" : statusForValue(liquidityUsd, (value) => Number.isFinite(value) && value >= MARKET_EVIDENCE_THRESHOLDS.liquidityUsd), "geckoterminal"),
    requirement("verified-market-cap", "Verified market cap", `At least $${MARKET_EVIDENCE_THRESHOLDS.marketCapUsd.toLocaleString()} (market cap only)`, marketCapUsd, providerErrors[1] ? "unavailable" : statusForValue(marketCapUsd, (value) => Number.isFinite(value) && value >= MARKET_EVIDENCE_THRESHOLDS.marketCapUsd), "geckoterminal"),
    requirement("gt-verified", "GT verification", "Verified", infoAttributes?.gt_verified ?? null, providerErrors[2] ? "unavailable" : statusForValue(infoAttributes?.gt_verified ?? null, (value) => value === true), "geckoterminal"),
    requirement("gt-score", "GT score", `At least ${MARKET_EVIDENCE_THRESHOLDS.gtScore}`, gtScore, providerErrors[2] ? "unavailable" : statusForValue(gtScore, (value) => Number.isFinite(value) && value >= MARKET_EVIDENCE_THRESHOLDS.gtScore), "geckoterminal"),
    requirement("honeypot", "Honeypot status", "Not a honeypot", infoAttributes?.is_honeypot ?? null, providerErrors[2] ? "unavailable" : statusForValue(infoAttributes?.is_honeypot ?? null, (value) => value === false), "geckoterminal"),
    requirement("locked-liquidity", "Locked liquidity", `At least ${MARKET_EVIDENCE_THRESHOLDS.lockedLiquidityPct}%`, lockedLiquidityPct, providerErrors[0] ? "unavailable" : statusForValue(lockedLiquidityPct, (value) => Number.isFinite(value) && value >= MARKET_EVIDENCE_THRESHOLDS.lockedLiquidityPct), "geckoterminal"),
  ];
  const requirements = [...rpcRequirements, ...providerRequirements];
  const finalMarket = { ...market, poolCreatedAt: poolCreatedAt?.toISOString() ?? null };
  return {
    status: overallStatus(requirements),
    asset,
    market: finalMarket,
    requirements,
    marketDetails: { factoryAddress: factory.value!, quoteTokenAddress: quoteToken!, feeTier: fee.value!, poolCreatedAt },
  };
}

function normalizeCachedResult(result: ValidationResult): ValidationResult {
  if (!result.marketDetails || result.marketDetails.poolCreatedAt instanceof Date || result.marketDetails.poolCreatedAt === null) return result;
  return {
    ...result,
    marketDetails: { ...result.marketDetails, poolCreatedAt: new Date(result.marketDetails.poolCreatedAt as unknown as string) },
  };
}

function tokenValidationPassed(result: ValidationResult) {
  const tokenKeys = new Set(["erc20-contract", "token-decimals", "verified-market-cap", "gt-verified", "gt-score", "honeypot"]);
  return result.requirements.filter((item) => tokenKeys.has(item.key)).every((item) => item.status === "pass");
}

export async function validateUnlistedAsset(input: {
  assetAddress: string;
  poolAddress?: string | null;
  competitionStartsAt: Date | null;
}): Promise<ValidationResult> {
  const assetAddress = normalizeAddress(input.assetAddress);
  const poolAddress = input.poolAddress ? normalizeAddress(input.poolAddress) : null;
  if (!poolAddress) return normalizeCachedResult(await validateTokenOnly(assetAddress));
  const competitionKey = input.competitionStartsAt?.toISOString() ?? "unknown";
  const result = await cachedAssetValidation(
    `market:${assetAddress}:${poolAddress}:${competitionKey}`,
    async () => {
      const tokenResult = await validateTokenOnly(assetAddress);
      if (!tokenValidationPassed(tokenResult)) {
        return { ...tokenResult, market: { ...tokenResult.market, poolAddress } };
      }
      return validateFullUnlistedAsset({ assetAddress, poolAddress, competitionStartsAt: input.competitionStartsAt });
    },
  );
  return normalizeCachedResult(result);
}
