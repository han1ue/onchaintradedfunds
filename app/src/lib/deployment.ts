import mainnetDeployment from "../config/robinhood-mainnet.json";
import testnetDeployment from "../config/robinhood-testnet.json";
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

function address(value: unknown): Address | undefined {
  return typeof value === "string" && isAddress(value) ? getAddress(value) : undefined;
}

function safePositiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

const testnet = record(testnetDeployment);
const testnetContracts = record(testnet.contracts) as Record<string, ContractDeployment | undefined>;
const testnetExternalContracts = record(testnet.externalContracts);
const testnetCreation = record(testnet.creation);
const testnetLiquidity = record(testnet.externalLiquidity);
const testnetRouting = record(testnet.routing);
const testnetCompatible = testnet.architecture === "generic-trade-adapter-v1";

function deployedTestnetContract(name: string): Address | undefined {
  return testnetCompatible ? address(testnetContracts[name]?.address) : undefined;
}

export const robinhoodTestnetAddresses = Object.freeze({
  feeCollector: deployedTestnetContract("feeCollector"),
  otfToken: deployedTestnetContract("otfToken"),
  vaultImplementation: deployedTestnetContract("vaultImplementation"),
  factory: deployedTestnetContract("factory"),
  entryRouter: deployedTestnetContract("entryRouter"),
  uniswapV3Adapter: deployedTestnetContract("uniswapV3Adapter"),
  usdg: address(testnetExternalContracts.usdg),
  weth: address(testnetExternalContracts.weth),
});

export const robinhoodTestnetLiquidity = Object.freeze({
  venue: testnetLiquidity.venue === "Synthra" ? "Synthra" : undefined,
  baseUrl: httpsUrl(testnetLiquidity.baseUrl),
});

export const robinhoodTestnetCreation = Object.freeze({
  assetDataEndpoint: httpsUrl(testnetCreation.assetDataEndpoint),
});

export const robinhoodTestnetCreationReady = testnet.status === "deployed"
  && Boolean(robinhoodTestnetAddresses.factory);

export const robinhoodTestnetDeploymentReady = testnet.status === "deployed"
  && Boolean(
    robinhoodTestnetAddresses.factory
    && robinhoodTestnetAddresses.entryRouter
    && robinhoodTestnetAddresses.feeCollector
    && robinhoodTestnetAddresses.otfToken
    && robinhoodTestnetAddresses.uniswapV3Adapter
    && Array.isArray(testnetRouting.approvedAdapters)
    && testnetRouting.approvedAdapters.some((candidate) => (
      address(candidate)?.toLowerCase() === robinhoodTestnetAddresses.uniswapV3Adapter?.toLowerCase()
    )),
  );

const mainnet = record(mainnetDeployment);
const mainnetCompatible = Number(mainnet.chainId) === 4663 && mainnet.network === "robinhood-mainnet";
const mainnetExternalContracts = mainnetCompatible ? record(mainnet.externalContracts) : {};
const mainnetLiquidity = mainnetCompatible ? record(mainnet.externalLiquidity) : {};
const mainnetTradingApi = mainnetCompatible ? record(mainnet.uniswapTradingApi) : {};

/** Canonical production token identity; it is intentionally separate from testnet deployment state. */
export const robinhoodMainnetAddresses = Object.freeze({
  usdg: address(mainnetExternalContracts.usdg),
  weth: address(mainnetExternalContracts.weth),
});

export const robinhoodMainnetLiquidity = Object.freeze({
  venue: mainnetLiquidity.venue === "Uniswap" ? "Uniswap" : undefined,
  baseUrl: httpsUrl(mainnetLiquidity.baseUrl),
  chainSlug: typeof mainnetLiquidity.chainSlug === "string" && mainnetLiquidity.chainSlug
    ? mainnetLiquidity.chainSlug
    : undefined,
  feeAmount: safePositiveInteger(mainnetLiquidity.feeAmount),
  tickSpacing: safePositiveInteger(mainnetLiquidity.tickSpacing),
  isDynamic: typeof mainnetLiquidity.isDynamic === "boolean" ? mainnetLiquidity.isDynamic : undefined,
});

/** Supported targets for server-issued Uniswap Trading API execution plans. */
export const robinhoodMainnetUniswap = Object.freeze({
  permit2: address(mainnetTradingApi.permit2),
  universalRouter: address(mainnetTradingApi.universalRouter),
  universalRouterVersion: mainnetTradingApi.universalRouterVersion === "2.1.1" ? "2.1.1" : undefined,
});
