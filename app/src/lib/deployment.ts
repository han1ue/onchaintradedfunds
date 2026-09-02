import mainnetDeployment from "../config/robinhood-mainnet.json";
import testnetDeployment from "../config/robinhood-testnet.json";
import {
  productionAssetsForChain,
  testnetAssetById,
  testnetVenue,
} from "./asset-catalog";
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
const testnetCompatible = testnet.architecture === "otf-token-economics-v2";

function deployedTestnetContract(name: string): Address | undefined {
  return testnetCompatible ? address(testnetContracts[name]?.address) : undefined;
}

export const robinhoodTestnetAddresses = Object.freeze({
  otfToken: deployedTestnetContract("otfToken"),
  launchManager: deployedTestnetContract("launchManager"),
  teamVesting: deployedTestnetContract("teamVesting"),
  buybackCollector: deployedTestnetContract("buybackCollector"),
  merkleRewardsDistributor: deployedTestnetContract("merkleRewardsDistributor"),
  ethUsdOracle: deployedTestnetContract("fakeEthUsdOracle"),
  vaultImplementation: deployedTestnetContract("vaultImplementation"),
  factory: deployedTestnetContract("factory"),
  entryRouter: deployedTestnetContract("entryRouter"),
  uniswapV3Adapter: deployedTestnetContract("uniswapV3Adapter"),
  uniswapV4Adapter: deployedTestnetContract("uniswapV4Adapter"),
  usdg: testnetAssetById("usdg")?.address,
  weth: testnetAssetById("weth")?.address,
});

export const robinhoodTestnetLiquidity = Object.freeze({
  venue: testnetLiquidity.venue === "Synthra" && testnetVenue.id === "synthra-v3" ? "Synthra" : undefined,
  baseUrl: httpsUrl(testnetLiquidity.baseUrl) === testnetVenue.baseUrl ? testnetVenue.baseUrl : undefined,
});

export const robinhoodTestnetV3 = Object.freeze({
  factory: testnetVenue.factory,
  swapRouter02: testnetVenue.swapRouter02,
  quoter: testnetVenue.quoter,
  positionManager: testnetVenue.positionManager,
});

export const robinhoodTestnetV4 = Object.freeze({
  poolManager: address(testnetExternalContracts.uniswapV4PoolManager),
  stateView: address(testnetExternalContracts.uniswapV4StateView),
  universalRouter: address(testnetExternalContracts.uniswapUniversalRouter),
  positionManager: address(testnetExternalContracts.uniswapV4PositionManager),
  permit2: address(testnetExternalContracts.permit2),
});

export const robinhoodTestnetV4AdapterReady = testnet.status === "deployed"
  && Boolean(
    robinhoodTestnetAddresses.entryRouter
    && robinhoodTestnetAddresses.uniswapV4Adapter
    && robinhoodTestnetV4.poolManager
    && robinhoodTestnetV4.stateView
    && robinhoodTestnetV4.universalRouter
    && robinhoodTestnetV4.permit2
    && Array.isArray(testnetRouting.approvedAdapters)
    && testnetRouting.approvedAdapters.some((candidate) => (
      address(candidate)?.toLowerCase() === robinhoodTestnetAddresses.uniswapV4Adapter?.toLowerCase()
    )),
  );

export const robinhoodTestnetCreation = Object.freeze({
  assetDataEndpoint: httpsUrl(testnetCreation.assetDataEndpoint),
});

export const robinhoodTestnetCreationReady = testnet.status === "deployed"
  && Boolean(robinhoodTestnetAddresses.factory);

export const robinhoodTestnetDeploymentReady = testnet.status === "deployed"
  && Boolean(
    robinhoodTestnetAddresses.factory
    && robinhoodTestnetAddresses.entryRouter
    && robinhoodTestnetAddresses.buybackCollector
    && robinhoodTestnetAddresses.otfToken
    && robinhoodTestnetAddresses.launchManager
    && robinhoodTestnetAddresses.teamVesting
    && robinhoodTestnetAddresses.merkleRewardsDistributor
    && robinhoodTestnetAddresses.ethUsdOracle
    && robinhoodTestnetAddresses.uniswapV3Adapter
    && address(testnetExternalContracts.uniswapV3Factory)?.toLowerCase() === testnetVenue.factory.toLowerCase()
    && address(testnetExternalContracts.uniswapV3SwapRouter02)?.toLowerCase() === testnetVenue.swapRouter02.toLowerCase()
    && Array.isArray(testnetRouting.approvedAdapters)
    && testnetRouting.approvedAdapters.some((candidate) => (
      address(candidate)?.toLowerCase() === robinhoodTestnetAddresses.uniswapV3Adapter?.toLowerCase()
    )),
  );

/** Native basket calls stay disabled until the deployed entry router includes canonical WETH endpoints. */
export const robinhoodTestnetNativeEntryReady = robinhoodTestnetDeploymentReady
  && testnetRouting.nativeEntryExitEnabled === true;

const mainnet = record(mainnetDeployment);
const mainnetCompatible = Number(mainnet.chainId) === 4663 && mainnet.network === "robinhood-mainnet";
const mainnetProtocolContracts = mainnetCompatible ? record(mainnet.protocolContracts) : {};
const mainnetExternalContracts = mainnetCompatible ? record(mainnet.externalContracts) : {};
const mainnetLiquidity = mainnetCompatible ? record(mainnet.externalLiquidity) : {};
const mainnetTradingApi = mainnetCompatible ? record(mainnet.uniswapTradingApi) : {};
const mainnetAssets = mainnetCompatible ? productionAssetsForChain(4663) : [];

/** Canonical production token identity; it is intentionally separate from testnet deployment state. */
export const robinhoodMainnetAddresses = Object.freeze({
  otfToken: address(record(mainnetProtocolContracts.otfToken).address),
  usdg: mainnetAssets.find((asset) => asset.id === "usdg")?.address,
  weth: mainnetAssets.find((asset) => asset.id === "weth")?.address,
  ethUsdOracle: address(mainnetExternalContracts.ethUsdOracle),
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
