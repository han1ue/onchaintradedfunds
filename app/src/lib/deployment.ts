import deployment from "../config/robinhood-testnet.json";
import { getAddress, isAddress, type Address } from "viem";

type ContractDeployment = { address?: unknown };
const contracts = deployment.contracts as Record<string, ContractDeployment | undefined>;
const externalContracts = deployment.externalContracts as Record<string, unknown>;
const deploymentCompatible = Number(deployment.schemaVersion) === 10
  && deployment.architecture === "oracleless-market-cap-at-formation-v1";

function address(value: unknown): Address | undefined {
  return typeof value === "string" && isAddress(value) ? getAddress(value) : undefined;
}

function deployedContract(name: string): Address | undefined {
  return deploymentCompatible ? address(contracts[name]?.address) : undefined;
}

export const robinhoodTestnetAddresses = Object.freeze({
  feeCollector: deployedContract("feeCollector"),
  otfToken: deployedContract("otfToken"),
  vaultImplementation: deployedContract("vaultImplementation"),
  factory: deployedContract("factory"),
  entryRouter: deployedContract("entryRouter"),
  usdg: address(externalContracts.usdg),
  weth: address(externalContracts.weth),
});

const liquidity = deployment.externalLiquidity as Record<string, unknown>;
const quote = deployment.quoteService as Record<string, unknown> | undefined;

export const robinhoodTestnetLiquidity = Object.freeze({
  venue: liquidity.venue === "Synthra" ? "Synthra" : undefined,
  baseUrl: typeof liquidity.baseUrl === "string" && /^https:\/\//.test(liquidity.baseUrl)
    ? liquidity.baseUrl
    : undefined,
  prefillSupported: liquidity.prefillSupported === true,
});

/**
 * The API is optional deployment configuration. Its response is still parsed
 * into typed OTFEntryExitRouter arguments before it can enable a transaction.
 */
export const robinhoodTestnetQuote = Object.freeze({
  endpoint: typeof quote?.endpoint === "string" && /^https:\/\//.test(quote.endpoint)
    ? quote.endpoint
    : undefined,
});

export const robinhoodTestnetFormation = Object.freeze({
  calculationVersion: Number(deployment.formation.calculationVersion),
  snapshotAuthority: address(deployment.formation.snapshotAuthority),
  dataSourceConfigured: Boolean(deployment.formation.dataSource),
});

export const robinhoodTestnetDeploymentReady = deployment.status === "deployed"
  && Boolean(
    robinhoodTestnetAddresses.factory
    && robinhoodTestnetAddresses.entryRouter
    && robinhoodTestnetAddresses.feeCollector
    && robinhoodTestnetAddresses.otfToken
    && robinhoodTestnetFormation.snapshotAuthority
    && robinhoodTestnetQuote.endpoint,
  );
