import deployment from "@/config/robinhood-testnet.json";
import { getAddress, isAddress, type Address } from "viem";

type ContractDeployment = { address?: unknown };
type ConstituentPoolDeployment = {
  asset?: unknown;
  pool?: unknown;
  fee?: unknown;
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
export const SUPPORTED_PROTOCOL_VERSION = 2;
const deploymentProtocolVersion = (deployment as { protocolVersion?: unknown }).protocolVersion;
export const robinhoodTestnetProtocolVersion =
  typeof deploymentProtocolVersion === "number" && Number.isSafeInteger(deploymentProtocolVersion)
    ? deploymentProtocolVersion
    : undefined;

function address(value: unknown): Address | undefined {
  return typeof value === "string" && isAddress(value) ? getAddress(value) : undefined;
}

function deployedContract(name: string): Address | undefined {
  return address(contracts[name]?.address);
}

const constituentPools = Array.isArray(v3Venue?.constituentPools)
  ? (v3Venue.constituentPools as ConstituentPoolDeployment[]).flatMap((record) => {
      const asset = address(record.asset);
      const pool = address(record.pool);
      const fee = typeof record.fee === "number" ? record.fee : Number(record.fee);
      return asset && pool && Number.isInteger(fee) && fee > 0
        ? [{ asset, pool, fee }]
        : [];
    })
  : [];

export const robinhoodTestnetAddresses = Object.freeze({
  assetRegistry: deployedContract("assetRegistry"),
  oracleRegistry: deployedContract("oracleRegistry"),
  rebalanceExecutor: deployedContract("rebalanceExecutor"),
  feeCollector: deployedContract("feeCollector"),
  vaultImplementation: deployedContract("vaultImplementation"),
  factory: deployedContract("factory"),
  entryRouter: deployedContract("entryRouter"),
  uniswapV3Adapter: deployedContract("uniswapV3Adapter"),
  v3MarketRegistry: deployedContract("v3MarketRegistry"),
  usdg: address(externalContracts.usdg),
  uniswapV3Factory: address(externalContracts.uniswapV3Factory),
  uniswapV3PositionManager: address(externalContracts.uniswapV3PositionManager),
  uniswapV3SwapRouter: address(externalContracts.uniswapV3SwapRouter),
  uniswapV3Quoter: address(externalContracts.uniswapV3Quoter),
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
