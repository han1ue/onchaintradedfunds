import deployment from "../config/robinhood-testnet.json";
import { getAddress, isAddress, type Address } from "viem";

type ContractDeployment = { address?: unknown };
type ConstituentPoolDeployment = {
  asset?: unknown;
  pool?: unknown;
  fee?: unknown;
  quoteToken?: unknown;
  quoteTokenAddress?: unknown;
};
type V3VenueDeployment = {
  provider?: unknown;
  liquidityUrl?: unknown;
  settlementToken?: unknown;
  constituentFee?: unknown;
  constituentPools?: unknown;
};

const contracts = deployment.contracts as Record<string, ContractDeployment | undefined>;
const externalContracts = deployment.externalContracts as Record<string, unknown>;
const v3Venue = (deployment as { v3Venue?: V3VenueDeployment }).v3Venue;
const wethV3Venue = (deployment as { wethV3Venue?: V3VenueDeployment }).wethV3Venue;
function address(value: unknown): Address | undefined {
  return typeof value === "string" && isAddress(value) ? getAddress(value) : undefined;
}

function deployedContract(name: string): Address | undefined {
  return address(contracts[name]?.address);
}

function parseConstituentPools(venue?: V3VenueDeployment) {
  return Array.isArray(venue?.constituentPools)
  ? (venue.constituentPools as ConstituentPoolDeployment[]).flatMap((record) => {
      const asset = address(record.asset);
      const pool = address(record.pool);
      const fee = typeof record.fee === "number" ? record.fee : Number(record.fee);
      const quoteToken = address(record.quoteToken) ?? address(record.quoteTokenAddress)
        ?? address(venue?.settlementToken);
      return asset && pool && quoteToken && Number.isInteger(fee) && fee > 0
        ? [{ asset, pool, fee, quoteToken }]
        : [];
    })
  : [];
}

const constituentPools = parseConstituentPools(v3Venue);
const wethConstituentPools = parseConstituentPools(wethV3Venue);

export const robinhoodTestnetAddresses = Object.freeze({
  rebalanceExecutor: deployedContract("rebalanceExecutor"),
  feeCollector: deployedContract("feeCollector"),
  vaultImplementation: deployedContract("vaultImplementation"),
  factory: deployedContract("factory"),
  entryRouter: deployedContract("entryRouter"),
  entryRouterWeth: deployedContract("entryRouterWeth"),
  uniswapV3Adapter: deployedContract("uniswapV3Adapter"),
  registeredUniswapV3AdapterUsdg: deployedContract("registeredUniswapV3AdapterUsdg"),
  registeredUniswapV3AdapterWeth: deployedContract("registeredUniswapV3AdapterWeth"),
  assetMarketRegistry: deployedContract("assetMarketRegistry"),
  pricingResolver: deployedContract("pricingResolver"),
  v3MarketRegistry: deployedContract("v3MarketRegistry"),
  usdg: address(externalContracts.usdg),
  weth: address(externalContracts.weth),
  wethUsdgPool: address(externalContracts.wethUsdgPool),
  uniswapV3Factory: address(externalContracts.uniswapV3Factory),
  uniswapV3PositionManager: address(externalContracts.uniswapV3PositionManager),
  uniswapV3SwapRouter: address(externalContracts.uniswapV3SwapRouter),
  uniswapV3Quoter: address(externalContracts.uniswapV3Quoter),
});

export const robinhoodTestnetWethV3Venue = Object.freeze({
  provider: typeof wethV3Venue?.provider === "string" ? wethV3Venue.provider : undefined,
  liquidityUrl: typeof wethV3Venue?.liquidityUrl === "string" ? wethV3Venue.liquidityUrl : undefined,
  settlementToken: address(wethV3Venue?.settlementToken) ?? address(externalContracts.weth),
  constituentFee: typeof wethV3Venue?.constituentFee === "number"
    ? wethV3Venue.constituentFee
    : Number(wethV3Venue?.constituentFee) || undefined,
  constituentPools: Object.freeze(wethConstituentPools),
});

export const robinhoodTestnetV3Venue = Object.freeze({
  provider: typeof v3Venue?.provider === "string" ? v3Venue.provider : undefined,
  liquidityUrl: typeof v3Venue?.liquidityUrl === "string" ? v3Venue.liquidityUrl : undefined,
  settlementToken: address(v3Venue?.settlementToken),
  constituentFee: typeof v3Venue?.constituentFee === "number"
    ? v3Venue.constituentFee
    : Number(v3Venue?.constituentFee) || undefined,
  constituentPools: Object.freeze(constituentPools),
});
