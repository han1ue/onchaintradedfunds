import mainnetDeployment from "../config/robinhood-mainnet.json";
import testnetDeployment from "../config/robinhood-testnet.json";
import { testnetVenue } from "./venue-config";
import { getAddress, isAddress, type Address } from "viem";

type ContractDeployment = { address?: unknown; blockNumber?: unknown; blockTimestamp?: unknown };

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

function safePositiveBigInt(value: unknown): bigint | undefined {
  if (typeof value !== "string" || !/^\d+$/u.test(value)) return undefined;
  const parsed = BigInt(value);
  return parsed > 0n ? parsed : undefined;
}

function timestampMillis(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const testnet = record(testnetDeployment);
const testnetContracts = record(testnet.contracts) as Record<string, ContractDeployment | undefined>;
const testnetExternalContracts = record(testnet.externalContracts);
const testnetCreation = record(testnet.creation);
const testnetLiquidity = record(testnet.externalLiquidity);
const testnetRouting = record(testnet.routing);
const testnetConfigValid = Number(testnet.chainId) === 46630
  && testnet.network === "robinhood-testnet";

function deployedTestnetContract(name: string): Address | undefined {
  return testnetConfigValid && testnet.status === "deployed"
    ? address(testnetContracts[name]?.address)
    : undefined;
}

export const robinhoodTestnetAddresses = Object.freeze({
  otfToken: deployedTestnetContract("otfToken"),
  launchManager: deployedTestnetContract("launchManager"),
  launchRouter: deployedTestnetContract("launchRouter"),
  teamVesting: deployedTestnetContract("teamVesting"),
  buybackCollector: deployedTestnetContract("buybackCollector"),
  merkleRewardsDistributor: deployedTestnetContract("merkleRewardsDistributor"),
  ethUsdOracle: deployedTestnetContract("fakeEthUsdOracle"),
  vaultImplementation: deployedTestnetContract("vaultImplementation"),
  factory: deployedTestnetContract("factory"),
  entryRouter: deployedTestnetContract("entryRouter"),
  uniswapUniversalRouterAdapter: deployedTestnetContract("uniswapUniversalRouterAdapter"),
  usdg: address(testnetExternalContracts.usdg),
  weth: address(testnetExternalContracts.weth),
});

export const robinhoodTestnetRewardsDeploymentBlock = testnetConfigValid && testnet.status === "deployed"
  ? safePositiveBigInt(testnetContracts.merkleRewardsDistributor?.blockNumber)
  : undefined;

export const robinhoodTestnetRewardsDeployedAtMs = robinhoodTestnetRewardsDeploymentBlock
  ? timestampMillis(testnetContracts.merkleRewardsDistributor?.blockTimestamp)
  : undefined;

export const robinhoodTestnetLiquidity = Object.freeze({
  venue: testnetLiquidity.venue === "Uniswap V3" && testnetVenue.id === "uniswap-v3" ? "Uniswap V3" : undefined,
  baseUrl: httpsUrl(testnetLiquidity.baseUrl) === testnetVenue.baseUrl ? testnetVenue.baseUrl : undefined,
});

export const robinhoodTestnetV3 = Object.freeze({
  factory: testnetVenue.factory,
  quoter: testnetVenue.quoter,
  positionManager: testnetVenue.positionManager,
});

export const robinhoodTestnetV4 = Object.freeze({
  poolManager: address(testnetExternalContracts.uniswapV4PoolManager),
  stateView: address(testnetExternalContracts.uniswapV4StateView),
  quoter: address(testnetExternalContracts.uniswapV4Quoter),
  universalRouter: address(testnetExternalContracts.uniswapUniversalRouter),
  positionManager: address(testnetExternalContracts.uniswapV4PositionManager),
  permit2: address(testnetExternalContracts.permit2),
});

export const robinhoodTestnetUniversalAdapterReady = testnet.status === "deployed"
  && testnetRouting.status === "ready"
  && Boolean(
    robinhoodTestnetAddresses.entryRouter
    && robinhoodTestnetAddresses.uniswapUniversalRouterAdapter
    && robinhoodTestnetV4.poolManager
    && robinhoodTestnetV4.stateView
    && robinhoodTestnetV4.universalRouter
    && robinhoodTestnetV4.permit2
    && Array.isArray(testnetRouting.approvedAdapters)
    && testnetRouting.approvedAdapters.some((candidate) => (
      address(candidate)?.toLowerCase() === robinhoodTestnetAddresses.uniswapUniversalRouterAdapter?.toLowerCase()
    )),
  );

export const robinhoodTestnetCreation = Object.freeze({
  assetDataEndpoint: httpsUrl(testnetCreation.assetDataEndpoint),
});

export const robinhoodTestnetCreationReady = testnet.status === "deployed"
  && testnetRouting.status === "ready"
  && Boolean(robinhoodTestnetAddresses.factory);

export const robinhoodTestnetDeploymentReady = testnet.status === "deployed"
  && testnetRouting.status === "ready"
  && Boolean(
    robinhoodTestnetAddresses.factory
    && robinhoodTestnetAddresses.entryRouter
    && robinhoodTestnetAddresses.buybackCollector
    && robinhoodTestnetAddresses.otfToken
    && robinhoodTestnetAddresses.launchManager
    && robinhoodTestnetAddresses.launchRouter
    && robinhoodTestnetAddresses.teamVesting
    && robinhoodTestnetAddresses.merkleRewardsDistributor
    && robinhoodTestnetAddresses.ethUsdOracle
    && robinhoodTestnetAddresses.uniswapUniversalRouterAdapter
    && address(testnetExternalContracts.uniswapV3Factory)?.toLowerCase() === testnetVenue.factory.toLowerCase()
    && Array.isArray(testnetRouting.approvedAdapters)
    && testnetRouting.approvedAdapters.some((candidate) => (
      address(candidate)?.toLowerCase() === robinhoodTestnetAddresses.uniswapUniversalRouterAdapter?.toLowerCase()
    )),
  );

/** Native basket calls stay disabled until the deployed entry router includes canonical WETH endpoints. */
export const robinhoodTestnetNativeEntryReady = robinhoodTestnetDeploymentReady
  && testnetRouting.nativeEntryExitEnabled === true;

const mainnet = record(mainnetDeployment);
const mainnetConfigValid = Number(mainnet.chainId) === 4663
  && mainnet.network === "robinhood-mainnet";
const mainnetProtocolContracts = mainnetConfigValid ? record(mainnet.protocolContracts) : {};
const mainnetExternalContracts = mainnetConfigValid ? record(mainnet.externalContracts) : {};
const mainnetLiquidity = mainnetConfigValid ? record(mainnet.externalLiquidity) : {};
const mainnetTradingApi = mainnetConfigValid ? record(mainnet.uniswapTradingApi) : {};

const mainnetDeployed = mainnetConfigValid && mainnet.protocolStatus === "deployed";

function deployedMainnetContract(name: string): Address | undefined {
  return mainnetDeployed ? address(record(mainnetProtocolContracts[name]).address) : undefined;
}

/** Canonical production token identity; it is intentionally separate from testnet deployment state. */
export const robinhoodMainnetAddresses = Object.freeze({
  launchManager: deployedMainnetContract("launchManager"),
  launchRouter: deployedMainnetContract("launchRouter"),
  teamVesting: deployedMainnetContract("teamVesting"),
  buybackCollector: deployedMainnetContract("buybackCollector"),
  merkleRewardsDistributor: deployedMainnetContract("merkleRewardsDistributor"),
  vaultImplementation: deployedMainnetContract("vaultImplementation"),
  factory: deployedMainnetContract("factory"),
  entryRouter: deployedMainnetContract("entryRouter"),
  uniswapUniversalRouterAdapter: deployedMainnetContract("uniswapUniversalRouterAdapter"),
  otfToken: deployedMainnetContract("otfToken"),
  usdg: address(mainnetExternalContracts.usdg),
  weth: address(mainnetExternalContracts.weth),
  ethUsdOracle: address(mainnetExternalContracts.ethUsdOracle),
});

export const robinhoodMainnetBasketDeployment = (() => {
  const { factory, entryRouter, uniswapUniversalRouterAdapter, weth, otfToken, launchManager } = robinhoodMainnetAddresses;
  const uniswapV3Factory = address(mainnetExternalContracts.uniswapV3Factory);
  const uniswapV4PoolManager = address(mainnetExternalContracts.uniswapV4PoolManager);
  const uniswapV4StateView = address(mainnetExternalContracts.uniswapV4StateView);
  const uniswapV4Quoter = address(mainnetExternalContracts.uniswapV4Quoter);
  const universalRouter = address(mainnetTradingApi.universalRouter);
  const permit2 = address(mainnetTradingApi.permit2);
  if (!factory || !entryRouter || !uniswapUniversalRouterAdapter || !weth || !otfToken || !launchManager || !uniswapV3Factory
    || !uniswapV4PoolManager || !uniswapV4StateView || !uniswapV4Quoter || !universalRouter || !permit2) return undefined;
  return { factory, entryRouter, uniswapUniversalRouterAdapter, weth, otfToken, launchManager, uniswapV3Factory, uniswapV4PoolManager, uniswapV4StateView, uniswapV4Quoter, universalRouter, permit2 };
})();

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

const mainnetRouting = record(mainnet.routing);
export const robinhoodMainnetV4 = Object.freeze({
  poolManager: address(mainnetExternalContracts.uniswapV4PoolManager),
  stateView: address(mainnetExternalContracts.uniswapV4StateView),
  quoter: address(mainnetExternalContracts.uniswapV4Quoter),
  universalRouter: robinhoodMainnetUniswap.universalRouter,
  positionManager: address(mainnetExternalContracts.uniswapV4PositionManager),
  permit2: robinhoodMainnetUniswap.permit2,
});
const mainnetRoutingReady = mainnetDeployed && mainnetRouting.status === "ready" && Boolean(robinhoodMainnetBasketDeployment)
  && [robinhoodMainnetAddresses.uniswapUniversalRouterAdapter].every((adapter) =>
    adapter && Array.isArray(mainnetRouting.approvedAdapters) && mainnetRouting.approvedAdapters.some((value) => address(value)?.toLowerCase() === adapter.toLowerCase()));

export function protocolDeploymentForChain(chainId: number) {
  if (chainId === 46630) return {
    addresses: robinhoodTestnetAddresses, v4: robinhoodTestnetV4,
    creationReady: robinhoodTestnetCreationReady, routingReady: robinhoodTestnetDeploymentReady,
    rewardsDeployedAtMs: robinhoodTestnetRewardsDeployedAtMs,
    assetDataEndpoint: robinhoodTestnetCreation.assetDataEndpoint,
  };
  if (chainId === 4663) return {
    addresses: robinhoodMainnetAddresses, v4: robinhoodMainnetV4,
    creationReady: mainnetRoutingReady && Boolean(robinhoodMainnetAddresses.factory), routingReady: mainnetRoutingReady,
    rewardsDeployedAtMs: mainnetDeployed && robinhoodMainnetAddresses.merkleRewardsDistributor
      && safePositiveBigInt(record(mainnetProtocolContracts.merkleRewardsDistributor).blockNumber)
      ? timestampMillis(record(mainnetProtocolContracts.merkleRewardsDistributor).blockTimestamp) : undefined,
    assetDataEndpoint: httpsUrl(record(mainnet.creation).assetDataEndpoint),
  };
  return undefined;
}
