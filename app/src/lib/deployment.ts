import deployment from "../config/robinhood-testnet.json";
import { getAddress, isAddress, type Address } from "viem";

type ContractDeployment = { address?: unknown };
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return new URL(value).protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

const contracts = record(deployment.contracts) as Record<string, ContractDeployment | undefined>;
const externalContracts = record(deployment.externalContracts);
const deploymentCompatible = Number(deployment.schemaVersion) >= 9
  && record(deployment.migration).architecture === "centralized-adapter-permissions";
const executionRoutes = (deploymentCompatible && Array.isArray(deployment.executionRoutes)
  ? deployment.executionRoutes
  : []) as Array<{
  settlement?: unknown;
  settlementToken?: unknown;
  adapter?: unknown;
  entryRouter?: unknown;
}>;
const pricingConfiguration = record(deployment.pricingConfiguration);
const quoteTokens = Array.isArray(pricingConfiguration.quoteTokens)
  ? pricingConfiguration.quoteTokens as Array<{
  symbol?: unknown;
  quoteToken?: unknown;
  usdFeed?: unknown;
  maxStaleness?: unknown;
}>
  : [];
const externalLiquidity = record(deployment.externalLiquidity);
const quoteService = record(deployment.quoteService);
function address(value: unknown): Address | undefined {
  return typeof value === "string" && isAddress(value) ? getAddress(value) : undefined;
}

function deployedContract(name: string): Address | undefined {
  return deploymentCompatible ? address(contracts[name]?.address) : undefined;
}

export const robinhoodTestnetAddresses = Object.freeze({
  rebalanceExecutor: deployedContract("rebalanceExecutor"),
  feeCollector: deployedContract("feeCollector"),
  vaultImplementation: deployedContract("vaultImplementation"),
  factory: deployedContract("factory"),
  entryRouter: deployedContract("entryRouter"),
  uniswapV3Adapter: deployedContract("uniswapV3Adapter"),
  assetMarketRegistry: deployedContract("assetMarketRegistry"),
  pricingResolver: deployedContract("pricingResolver"),
  usdg: address(externalContracts.usdg),
  weth: address(externalContracts.weth),
  uniswapV3Factory: address(externalContracts.uniswapV3Factory),
  uniswapV3PositionManager: address(externalContracts.uniswapV3PositionManager),
  uniswapV3SwapRouter: address(externalContracts.uniswapV3SwapRouter),
  uniswapV3Quoter: address(externalContracts.uniswapV3Quoter),
});

export const robinhoodTestnetLiquidity = Object.freeze({
  venue: typeof externalLiquidity.venue === "string" ? externalLiquidity.venue : undefined,
  baseUrl: httpsUrl(externalLiquidity.baseUrl),
});

/** A null endpoint is an intentional disabled state until a typed HTTPS quote service is configured. */
export const robinhoodTestnetQuote = Object.freeze({
  endpoint: httpsUrl(quoteService.endpoint),
});

export const robinhoodTestnetMarketAssets = Object.freeze(executionRoutes.flatMap((route) => {
  const token = address(route.settlementToken);
  const adapter = address(route.adapter);
  const entryRouter = address(route.entryRouter);
  if (!token || !adapter || !entryRouter || typeof route.settlement !== "string") return [];
  const pricing = quoteTokens.find((quote) => (
    typeof quote.quoteToken === "string"
      && quote.quoteToken.toLowerCase() === token.toLowerCase()
  ));
  const usdFeed = address(pricing?.usdFeed);
  const maxStaleness = Number(pricing?.maxStaleness);
  if (!usdFeed || !Number.isFinite(maxStaleness) || maxStaleness <= 0) return [];
  return [{
    symbol: route.settlement,
    token,
    adapter,
    entryRouter,
    usdFeed,
    maxStaleness,
  }];
}));
