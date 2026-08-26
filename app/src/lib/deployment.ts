import deployment from "../config/robinhood-testnet.json";
import { getAddress, isAddress, type Address } from "viem";

type ContractDeployment = { address?: unknown };
const contracts = deployment.contracts as Record<string, ContractDeployment | undefined>;
const externalContracts = deployment.externalContracts as Record<string, unknown>;
const deploymentCompatible = Number(deployment.schemaVersion) >= 8
  && (deployment.migration as { architecture?: unknown }).architecture === "decoupled-otf-markets";
const executionRoutes = (deploymentCompatible ? deployment.executionRoutes : []) as Array<{
  settlement?: unknown;
  settlementToken?: unknown;
  adapter?: unknown;
  entryRouter?: unknown;
}>;
const quoteTokens = deployment.pricingConfiguration.quoteTokens as Array<{
  symbol?: unknown;
  quoteToken?: unknown;
  usdFeed?: unknown;
  maxStaleness?: unknown;
}>;
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
