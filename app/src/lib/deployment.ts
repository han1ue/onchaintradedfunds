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
type PricingRouteDeployment = {
  asset?: unknown;
  base?: unknown;
  feed?: unknown;
  primarySource?: unknown;
  secondarySource?: unknown;
  source?: unknown;
};
type PricingConfigurationDeployment = {
  suggestedInitialPricingConfigs?: unknown;
  suggestedV3PricingConfigs?: unknown;
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

export function parseKnownPricingConfigs(sourceDeployment: unknown) {
  const deploymentRecord = sourceDeployment as {
    pricingConfiguration?: PricingConfigurationDeployment;
    trustedOracleRoutes?: unknown;
    setupTransactions?: { priceFeeds?: unknown };
  };
  const trustedOracleRoutes = deploymentRecord.trustedOracleRoutes;
  const pricingConfiguration = deploymentRecord.pricingConfiguration;
  const legacyPriceFeeds = deploymentRecord.setupTransactions?.priceFeeds;
  const suggestedRecords = [
    ...(Array.isArray(pricingConfiguration?.suggestedInitialPricingConfigs)
      ? pricingConfiguration.suggestedInitialPricingConfigs as PricingRouteDeployment[]
      : []),
    ...(Array.isArray(pricingConfiguration?.suggestedV3PricingConfigs)
      ? pricingConfiguration.suggestedV3PricingConfigs as PricingRouteDeployment[]
      : []),
  ];
  const records = suggestedRecords.length
    ? suggestedRecords
    : Array.isArray(legacyPriceFeeds)
      ? legacyPriceFeeds as PricingRouteDeployment[]
      : Array.isArray(trustedOracleRoutes)
        ? trustedOracleRoutes as PricingRouteDeployment[]
        : [];
  return records.flatMap((record) => {
    const asset = address(record.asset) ?? address(record.base);
    const primarySource = address(record.primarySource) ?? address(record.feed);
    const secondarySource = address(record.secondarySource);
    const rawSource = typeof record.source === "number"
      ? record.source
      : typeof record.source === "string"
        ? ({
            direct: 0,
            chainlinkDirect: 0,
            ChainlinkDirect: 0,
            composed: 1,
            chainlinkAssetWeth: 1,
            ChainlinkAssetWeth: 1,
            v3: 2,
            UniswapV3Twap: 2,
          } as const)[record.source as "direct"]
        : 0;
    const source = rawSource === 0 || rawSource === 1 || rawSource === 2 ? rawSource : undefined;
    if (!asset || !primarySource || source === undefined || (source === 1 && !secondarySource)) return [];
    return [{
      asset,
      config: {
        source,
        primarySource,
        secondarySource: secondarySource ?? "0x0000000000000000000000000000000000000000" as Address,
      },
    }];
  });
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

export const robinhoodTestnetKnownPricingConfigs = Object.freeze(parseKnownPricingConfigs(deployment));
