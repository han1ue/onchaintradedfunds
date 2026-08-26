"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { OtfBrandMark, OtfTokenIcon } from "@onchaintradedfunds/brand";
import {
  managedOtfVaultAbi,
  otfEntryExitRouterAbi,
  otfFactoryAbi,
} from "@onchaintradedfunds/generated";
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChartPie,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  CircleHelp,
  Clock3,
  Copy,
  Droplets,
  ExternalLink,
  FilePlus2,
  Info,
  ListChecks,
  LayoutGrid,
  Loader2,
  LockKeyhole,
  Monitor,
  KeyRound,
  Landmark,
  List,
  Network,
  Palette,
  Plus,
  Percent,
  Pencil,
  ReceiptText,
  RefreshCw,
  Scale,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  Trash2,
  UserCog,
  Wallet,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  type Abi,
  type ContractFunctionParameters,
  encodeAbiParameters,
  encodePacked,
  formatUnits,
  isAddress,
  maxUint256,
  parseEventLogs,
  parseUnits,
  toFunctionSelector,
  zeroAddress,
} from "viem";
import {
  useAccount,
  useBalance,
  useBlockNumber,
  useChainId,
  useDisconnect,
  usePublicClient,
  useReadContract,
  useReadContracts,
  useSimulateContract,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { robinhoodChain, robinhoodChainTestnet } from "@/lib/chains";
import { robinhoodTestnetAddresses, robinhoodTestnetMarketAssets } from "@/lib/deployment";
import {
  selectExecutionRoute,
  selectV3Pool,
  useDiscoveredV3Pools,
  type DiscoveredExecutionRoute,
  type V3TokenPair,
} from "@/lib/v3-execution-routes";
import {
  approvedPricingConfigsFor,
  isVerifiedPricingConfig,
  pricingVerification,
  pricingConfigsMatch,
  type ApprovedPricingConfig,
  verifiedAssets,
  verifiedAssetFor,
} from "@/lib/verified-assets";
import {
  chainlinkDescriptionMatchesPair,
  DEFAULT_CHALLENGE_DEVIATION_BPS,
  DEFAULT_COMPLETION_DEVIATION_BPS,
  FRONTEND_MAX_TRACKED_ASSETS,
  isManagedByAddress,
  percentToBps,
  primaryDepositsBlocked,
  trackedAssetUnionCount,
  weightBandValidationError,
  type WeightBandLimits,
} from "@/lib/protocol-ui";
import {
  formatCooldown,
  formatRelativeAvailability,
  formatTimestamp,
  progressThroughCooldown,
} from "@/lib/time";
import { APP_ORIGIN, isAppHostname } from "@/config/site";
import { LandingPage } from "./LandingPage";

type ContractValue =
  | string
  | number
  | bigint
  | boolean
  | readonly string[]
  | readonly number[]
  | readonly bigint[]
  | readonly [string, number]
  | readonly [string, number, number]
  | readonly [bigint, number, number]
  | undefined;

type ReadResult = readonly { result?: ContractValue; status?: "success" | "failure" }[];
type TxState = "idle" | "simulating" | "ready" | "pending" | "submitted" | "confirmed" | "reverted";
type AppearancePreference = "default" | "light" | "dark";
type RoutedSettlementMode = "usdg" | "weth";
type PositionTradeReceipt = {
  action: "deposit" | "redeem";
  detail: string;
  transactionHash: `0x${string}`;
};
export type AppView = "landing" | "detail" | "vaults" | "create" | "created" | "manage" | "deposits" | "verified";
type DataMode = "live" | "empty" | "unavailable";

const MAX_STRATEGY_RATIONALE_BYTES = 2_048;
const MAX_ORACLE_STALENESS_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_ORACLE_STALENESS_SECONDS = 25 * 60 * 60;

type Allocation = {
  symbol: string;
  name: string;
  address: string;
  targetWeightBps: number;
  actualWeightBps: number;
  tone: string;
  logoUrl?: string;
};

type TargetAsset = {
  ticker: string;
  name?: string;
  address: string;
  poolAddress?: `0x${string}`;
  verified: boolean;
  pricingConfig: AssetPricingConfig;
  targetWeight: string | number;
  initialAmount: string;
};

type PricingSource = 0 | 1 | 2 | 3;
type AssetPricingConfig = {
  source: PricingSource;
  quoteToken: `0x${string}`;
  primarySource: `0x${string}`;
  secondarySource: `0x${string}`;
  primaryMaxStaleness: number;
  secondaryMaxStaleness: number;
};

type StrategyTargetAsset = Omit<TargetAsset, "targetWeight"> & {
  targetWeight: string;
};

type CatalogOraclePrice = {
  answer?: bigint;
  decimals?: number;
  updatedAt?: bigint;
  value?: number;
  display: string;
};

type CatalogOraclePrices = Record<string, CatalogOraclePrice>;

type StrategyVersionResult = {
  proposedAt: bigint;
  activatedAt: bigint;
  completedAt: bigint;
  author: `0x${string}`;
  rationale: string;
};

type StrategyHistoryEntry = StrategyVersionResult & {
  index: number;
  tokens: readonly string[];
  weights: readonly (number | bigint)[];
};

type RebalanceRecordResult = {
  timestamp: bigint;
  manager: `0x${string}`;
  navPerShareBefore: bigint;
  navPerShareAfter: bigint;
  turnoverBps: number;
  executionLossBps: number;
  strategyVersion: number;
};

type TradeExecutionRecordResult = {
  timestamp: bigint;
  executor: `0x${string}`;
  strategyVersion: number;
  navBefore: bigint;
  navAfter: bigint;
  batchLossBps: number;
  navLossBudgetUsedBps: number;
  tradeCount: number;
};

type VaultSummary = {
  address: `0x${string}`;
  name: string;
  symbol: string;
  manager?: string;
  creator?: string;
  managerFeeBps?: number;
  assetCount: number;
  navValue?: bigint;
  nav?: string;
  navPerShare?: string;
  navPerShareValue?: bigint;
  sunset: boolean;
  verified: boolean;
};

type VaultView = {
  name: string;
  symbol: string;
  address?: `0x${string}`;
  manager?: string;
  feeRecipient?: string;
  managerFeeBps: number;
  effectiveProtocolFeeShareBps: number;
  totalSupply: string;
  cooldownSeconds: number;
  lastStrategyCompletion?: number;
  nextStrategyChange?: number;
  cooldownProgress: number;
  allocations: Allocation[];
  maxNavLossBps: number;
  navLossBudgetRecoveryAt?: number;
  navLossBudgetUsedBps: number;
  maxWeightDeviationBps: number;
  challengeWeightDeviationBps: number;
  challengeGracePeriod: number;
  withinCompletionBands: boolean;
  withinChallengeBands: boolean;
  strategicRebalanceActive: boolean;
  strategyProposalPending: boolean;
  pendingStrategyActivationTime?: number;
  challengeActive: boolean;
  challengeCaller?: string;
  challengeStartedAt?: number;
  challengeDeadline?: number;
  challengeTimeRemaining: number;
  feeState: number;
  escrowedManagerFeeShares: string;
  forfeitedManagerFeeShares: string;
  claimableChallengeRewardShares: string;
  claimableChallengeRewardValue?: bigint;
  canProposeStrategy: boolean;
  authorizedExecutors: readonly string[];
  minTargetWeightBps?: number;
  connectedIsManager: boolean;
  enabled: boolean;
  isLoading: boolean;
  dataMode: DataMode;
  readFailed: boolean;
  blockNumber?: bigint;
  lastReadAt?: number;
  navValue?: bigint;
  nav?: string;
  navPerShare?: string;
  navPerShareValue?: bigint;
  factoryAddress?: `0x${string}`;
  factoryVaultCount: number;
  factoryReadFailed: boolean;
  sunset: boolean;
  sunsetAt?: number;
  protocolDepositsPaused: boolean;
  vaultDepositsPaused: boolean;
  depositPauseStatusUnavailable: boolean;
};

const navTabs = ["Home", "Verified", "Liquidity"];

type VerifiedCatalogAsset = {
  symbol: string;
  name: string;
  address: string;
  decimals?: number;
  logoUrl?: undefined;
  verified: true;
  metadataLoading: boolean;
};

const testnetVerifiedAssetRecords = verifiedAssets.filter(
  (asset) => asset.chainId === robinhoodChainTestnet.id,
);

const erc20BalanceAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "decimals", type: "uint8" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "allowance", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "approved", type: "bool" }],
  },
] as const;

const vaultDepositAbi = [
  {
    type: "function",
    name: "previewMint",
    stateMutability: "view",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ name: "amountsIn", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "previewRedeem",
    stateMutability: "view",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ name: "amountsOut", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "mintWithBasket",
    stateMutability: "nonpayable",
    inputs: [
      { name: "shares", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "maxAmountsIn", type: "uint256[]" },
    ],
    outputs: [{ name: "amountsIn", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "redeem",
    stateMutability: "nonpayable",
    inputs: [
      { name: "shares", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "shareOwner", type: "address" },
      { name: "minAmountsOut", type: "uint256[]" },
    ],
    outputs: [{ name: "amountsOut", type: "uint256[]" }],
  },
] as const;

const vaultFeeAbi = [
  {
    type: "function",
    name: "withdrawManagerFees",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "feeShares", type: "uint256" }],
  },
  {
    type: "function",
    name: "claimChallengeReward",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "rewardShares", type: "uint256" }],
  },
] as const;

const assetPricingResolverAbi = [
  {
    type: "function",
    name: "validateAndQuotePrice",
    stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      {
        name: "config",
        type: "tuple",
        components: [
          { name: "source", type: "uint8" },
          { name: "quoteToken", type: "address" },
          { name: "primarySource", type: "address" },
          { name: "primaryMaxStaleness", type: "uint32" },
        ],
      },
    ],
    outputs: [
      { name: "price", type: "uint256" },
      { name: "priceDecimals", type: "uint8" },
    ],
  },
] as const;

const erc20MetadataReadAbi = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
] as const;

function useVerifiedAssetCatalog(): VerifiedCatalogAsset[] {
  const chainId = useChainId();
  const { data, isLoading } = useReadContracts({
    contracts: testnetVerifiedAssetRecords.flatMap((asset) => ([
      {
        address: asset.tokenAddress as `0x${string}`,
        abi: erc20MetadataReadAbi,
        functionName: "name" as const,
        chainId: robinhoodChainTestnet.id,
      },
      {
        address: asset.tokenAddress as `0x${string}`,
        abi: erc20MetadataReadAbi,
        functionName: "symbol" as const,
        chainId: robinhoodChainTestnet.id,
      },
      {
        address: asset.tokenAddress as `0x${string}`,
        abi: erc20MetadataReadAbi,
        functionName: "decimals" as const,
        chainId: robinhoodChainTestnet.id,
      },
    ])),
    query: {
      enabled: chainId === robinhoodChainTestnet.id,
      staleTime: 5 * 60_000,
    },
  });

  return useMemo(() => testnetVerifiedAssetRecords.map((asset, index) => {
    const nameResult = data?.[index * 3];
    const symbolResult = data?.[index * 3 + 1];
    const decimalsResult = data?.[index * 3 + 2];
    const symbol = symbolResult?.status === "success"
      ? String(symbolResult.result).trim().slice(0, 16)
      : "";
    const name = nameResult?.status === "success"
      ? String(nameResult.result).trim().slice(0, 80)
      : "";
    return {
      symbol: symbol || shortAssetAddress(asset.tokenAddress),
      name: name || (isLoading ? "Loading onchain metadata" : "Name unavailable"),
      address: asset.tokenAddress,
      decimals: decimalsResult?.status === "success" ? Number(decimalsResult.result) : undefined,
      logoUrl: undefined,
      verified: true as const,
      metadataLoading: isLoading,
    };
  }), [data, isLoading]);
}

const vaultCreatedEventAbi = [
  {
    type: "event",
    name: "VaultCreated",
    inputs: [
      { indexed: true, name: "creator", type: "address" },
      { indexed: true, name: "vault", type: "address" },
      { indexed: false, name: "name", type: "string" },
      { indexed: false, name: "symbol", type: "string" },
    ],
  },
] as const;

const aggregatorV3ReadAbi = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "description",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

const uniswapV3QuoterAbi: Abi = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "view",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "fee", type: "uint24" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "quoteExactOutputSingle",
    stateMutability: "view",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountOut", type: "uint256" },
          { name: "fee", type: "uint24" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [
      { name: "amountIn", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "quoteExactInput",
    stateMutability: "view",
    inputs: [
      { name: "path", type: "bytes" },
      { name: "amountIn", type: "uint256" },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96AfterList", type: "uint160[]" },
      { name: "initializedTicksCrossedList", type: "uint32[]" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "quoteExactOutput",
    stateMutability: "view",
    inputs: [
      { name: "path", type: "bytes" },
      { name: "amountOut", type: "uint256" },
    ],
    outputs: [
      { name: "amountIn", type: "uint256" },
      { name: "sqrtPriceX96AfterList", type: "uint160[]" },
      { name: "initializedTicksCrossedList", type: "uint32[]" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

const uniswapV3SwapRouterAbi = [
  {
    type: "function",
    name: "exactInputSingle",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

const allocationTones = ["chart1", "chart2", "chart3", "chart4", "chart5", "chart6"];
type MulticallRead = ContractFunctionParameters & { chainId: number };
function configuredFactoryAddress(): `0x${string}` | undefined {
  return robinhoodTestnetAddresses.factory;
}

function configuredEntryRouterAddress(mode: RoutedSettlementMode = "usdg"): `0x${string}` | undefined {
  void mode;
  return robinhoodTestnetAddresses.entryRouter;
}

function configuredEntryAdapterAddress(mode: RoutedSettlementMode = "usdg"): `0x${string}` | undefined {
  void mode;
  return robinhoodTestnetAddresses.uniswapV3Adapter;
}

function configuredSettlementTokenAddress(mode: RoutedSettlementMode = "usdg"): `0x${string}` | undefined {
  return mode === "weth" ? robinhoodTestnetAddresses.weth : robinhoodTestnetAddresses.usdg;
}

type PackedV3Path = {
  path: `0x${string}`;
  tokens: `0x${string}`[];
  fees: number[];
};

function parsePackedV3Path(
  value: string | undefined,
  tokenIn: string,
  tokenOut: string,
): PackedV3Path | undefined {
  const path = value?.trim();
  if (!path || !/^0x[0-9a-fA-F]+$/.test(path) || path.length % 2 !== 0) return undefined;
  const byteLength = (path.length - 2) / 2;
  if (byteLength < 43 || (byteLength - 20) % 23 !== 0) return undefined;
  const hops = (byteLength - 20) / 23;
  const tokens: `0x${string}`[] = [];
  const fees: number[] = [];
  for (let index = 0; index <= hops; index += 1) {
    const tokenOffset = 2 + index * 46;
    const token = `0x${path.slice(tokenOffset, tokenOffset + 40)}` as `0x${string}`;
    if (!isAddress(token) || token === zeroAddress) return undefined;
    if (tokens.at(-1)?.toLowerCase() === token.toLowerCase()) return undefined;
    tokens.push(token);
    if (index === hops) continue;
    const fee = Number.parseInt(path.slice(tokenOffset + 40, tokenOffset + 46), 16);
    if (!Number.isInteger(fee) || fee <= 0) return undefined;
    fees.push(fee);
  }
  if (
    tokens[0]?.toLowerCase() !== tokenIn.toLowerCase()
      || tokens.at(-1)?.toLowerCase() !== tokenOut.toLowerCase()
  ) return undefined;
  return { path: path as `0x${string}`, tokens, fees };
}

function joinPackedV3Paths(
  first: `0x${string}` | undefined,
  second: `0x${string}` | undefined,
): `0x${string}` | undefined {
  if (!first) return second;
  if (!second) return first;
  return `${first}${second.slice(42)}` as `0x${string}`;
}

function packedExecutionRoute(
  route: DiscoveredExecutionRoute,
  assetToSettlement: boolean,
): `0x${string}` {
  const assetQuotePath = assetToSettlement
    ? encodePacked(
        ["address", "uint24", "address"],
        [route.asset, route.assetPool.fee, route.quoteToken],
      )
    : encodePacked(
        ["address", "uint24", "address"],
        [route.quoteToken, route.assetPool.fee, route.asset],
      );
  if (!route.bridgePool) return assetQuotePath;
  const bridgePath = assetToSettlement
    ? encodePacked(
        ["address", "uint24", "address"],
        [route.quoteToken, route.bridgePool.fee, route.settlementToken],
      )
    : encodePacked(
        ["address", "uint24", "address"],
        [route.settlementToken, route.bridgePool.fee, route.quoteToken],
      );
  return assetToSettlement
    ? joinPackedV3Paths(assetQuotePath, bridgePath)!
    : joinPackedV3Paths(bridgePath, assetQuotePath)!;
}

function executionRoutePools(route: DiscoveredExecutionRoute | undefined) {
  return route ? [route.assetPool, route.bridgePool].filter(Boolean) : [];
}

function configuredPricingConfig(
  asset: string,
  chainId = robinhoodChainTestnet.id,
): AssetPricingConfig | undefined {
  return approvedPricingConfigsFor(chainId, asset)[0] as AssetPricingConfig | undefined;
}

function emptyPricingConfig(): AssetPricingConfig {
  return {
    source: 0,
    quoteToken: zeroAddress,
    primarySource: zeroAddress,
    secondarySource: zeroAddress,
    primaryMaxStaleness: DEFAULT_ORACLE_STALENESS_SECONDS,
    secondaryMaxStaleness: 0,
  };
}

function pricingConfigIsComplete(config: AssetPricingConfig): boolean {
  if (!isAddress(config.primarySource) || config.primarySource === zeroAddress) return false;
  if (!Number.isInteger(config.primaryMaxStaleness)
    || config.primaryMaxStaleness <= 0
    || config.primaryMaxStaleness > MAX_ORACLE_STALENESS_SECONDS) return false;
  if (config.source === 1 || config.source === 2) {
    return isAddress(config.quoteToken)
      && config.quoteToken !== zeroAddress
      && registeredQuoteDetailsArePresent(config);
  }
  return config.quoteToken === zeroAddress;
}

function registeredQuoteDetailsArePresent(config: AssetPricingConfig): boolean {
  return isAddress(config.secondarySource) && config.secondarySource !== zeroAddress;
}

function pricingSourceLabel(source: PricingSource): string {
  if (source === 0) return "Chainlink";
  if (source === 1) return "Chainlink Composed";
  if (source === 2) return "Uniswap V3 TWAP";
  return "Chainlink Robinhood";
}

const quoteTokenRegistryAbi = [
  {
    type: "function", name: "quoteTokens", stateMutability: "view", inputs: [],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    type: "function", name: "quoteTokenConfig", stateMutability: "view",
    inputs: [{ name: "quoteToken", type: "address" }],
    outputs: [
      { name: "usdFeed", type: "address" },
      { name: "maxStaleness", type: "uint32" },
      { name: "enabled", type: "bool" },
    ],
  },
] as const;

type RegisteredQuoteToken = {
  address: `0x${string}`;
  usdFeed: `0x${string}`;
  maxStaleness: number;
};

function quoteTokenLabel(address: string): string {
  if (robinhoodTestnetAddresses.weth && address.toLowerCase() === robinhoodTestnetAddresses.weth.toLowerCase()) return "WETH";
  if (robinhoodTestnetAddresses.usdg && address.toLowerCase() === robinhoodTestnetAddresses.usdg.toLowerCase()) return "USDG";
  return shortAddress(address);
}

const uniswapV3FactoryReadAbi = [{
  type: "function",
  name: "getPool",
  stateMutability: "view",
  inputs: [
    { name: "tokenA", type: "address" },
    { name: "tokenB", type: "address" },
    { name: "fee", type: "uint24" },
  ],
  outputs: [{ name: "pool", type: "address" }],
}] as const;

const uniswapV3PoolDiscoveryAbi = [
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "fee", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint24" }] },
  {
    type: "function",
    name: "slot0",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "liquidity",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "liquidity", type: "uint128" }],
  },
  {
    type: "function",
    name: "observe",
    stateMutability: "view",
    inputs: [{ name: "secondsAgos", type: "uint32[]" }],
    outputs: [
      { name: "tickCumulatives", type: "int56[]" },
      { name: "secondsPerLiquidityCumulativeX128s", type: "uint160[]" },
    ],
  },
] as const;

const MAINNET_V3_FACTORY = "0x1f7d7550B1b028f7571E69A784071F0205FD2EfA" as const;
const MAINNET_WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73" as const;
const MAINNET_USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as const;
const V3_FEES = [100, 500, 3000, 10_000] as const;

type CompatiblePool = {
  address: `0x${string}`;
  fee: number;
  quoteSymbol: string;
  quoteToken: `0x${string}`;
};

function useCompatibleUniswapV3Pools(
  chainId: number,
  assetAddress: string,
  enabled: boolean,
  registeredQuotes: RegisteredQuoteToken[],
) {
  const network = chainId === robinhoodChain.id
    ? { factory: MAINNET_V3_FACTORY, quotes: [{ symbol: "WETH", address: MAINNET_WETH }, { symbol: "USDG", address: MAINNET_USDG }] }
    : chainId === robinhoodChainTestnet.id && robinhoodTestnetAddresses.uniswapV3Factory
      ? {
          factory: robinhoodTestnetAddresses.uniswapV3Factory,
          quotes: registeredQuotes.map((quote) => ({
            symbol: quoteTokenLabel(quote.address), address: quote.address,
          })),
        }
      : undefined;
  const lookupInputs = enabled && network && isAddress(assetAddress)
    ? network.quotes.flatMap((quote) => V3_FEES.map((fee) => ({ ...quote, fee })))
    : [];
  const { data: poolLookupResults, isLoading: lookupLoading } = useReadContracts({
    contracts: lookupInputs.map((input) => ({
      address: network!.factory,
      abi: uniswapV3FactoryReadAbi,
      functionName: "getPool" as const,
      args: [assetAddress as `0x${string}`, input.address, input.fee] as const,
      chainId,
    })),
    query: { enabled: lookupInputs.length > 0 },
  });
  const candidates = lookupInputs.flatMap((input, index) => {
    const result = poolLookupResults?.[index];
    const address = result?.status === "success" ? result.result : undefined;
    return address && address !== zeroAddress ? [{ address, fee: input.fee, quoteSymbol: input.symbol, quoteToken: input.address }] : [];
  });
  const { data: poolStateResults, isLoading: stateLoading } = useReadContracts({
    contracts: candidates.flatMap((pool) => ([
      { address: pool.address, abi: uniswapV3PoolDiscoveryAbi, functionName: "slot0" as const, chainId },
      { address: pool.address, abi: uniswapV3PoolDiscoveryAbi, functionName: "liquidity" as const, chainId },
      { address: pool.address, abi: uniswapV3PoolDiscoveryAbi, functionName: "observe" as const, args: [[3_600, 0]] as const, chainId },
    ])),
    query: { enabled: candidates.length > 0 },
  });
  const pools: CompatiblePool[] = candidates.filter((_, index) => {
    const slotResult = poolStateResults?.[index * 3];
    const liquidityResult = poolStateResults?.[index * 3 + 1];
    const observeResult = poolStateResults?.[index * 3 + 2];
    if (slotResult?.status !== "success" || liquidityResult?.status !== "success" || observeResult?.status !== "success") return false;
    const slot0 = slotResult.result as readonly [bigint, number, number, number, number, number, boolean];
    return slot0[0] > 0n && Number(slot0[3]) >= 64 && BigInt(liquidityResult.result as bigint) > 0n;
  });
  return { pools, isLoading: lookupLoading || stateLoading };
}

function PricingConfigurationFields({
  chainId,
  assetAddress,
  assetTicker,
  config,
  onChange,
  disabled = false,
}: {
  chainId: number;
  assetAddress: string;
  assetTicker?: string;
  config: AssetPricingConfig;
  onChange: (config: AssetPricingConfig) => void;
  disabled?: boolean;
}) {
  const modalTitleId = useId();
  const modalDescriptionId = useId();
  const [pricingModalOpen, setPricingModalOpen] = useState(false);
  const [draftConfig, setDraftConfig] = useState<AssetPricingConfig>(config);
  const pricingTriggerRef = useRef<HTMLButtonElement>(null);
  const approved = approvedPricingConfigsFor(chainId, assetAddress) as AssetPricingConfig[];
  const approvedIndex = approved.findIndex((candidate) => pricingConfigsMatch(candidate, config));
  const verification = pricingVerification(chainId, assetAddress, config);
  const registryAddress = chainId === robinhoodChainTestnet.id
    ? robinhoodTestnetAddresses.assetMarketRegistry
    : undefined;
  const { data: quoteTokenAddresses } = useReadContract({
    address: registryAddress,
    abi: quoteTokenRegistryAbi,
    functionName: "quoteTokens",
    chainId,
    query: { enabled: Boolean(registryAddress) },
  });
  const { data: quoteConfigResults } = useReadContracts({
    contracts: (quoteTokenAddresses ?? []).map((quoteToken) => ({
      address: registryAddress!,
      abi: quoteTokenRegistryAbi,
      functionName: "quoteTokenConfig" as const,
      args: [quoteToken] as const,
      chainId,
    })),
    query: { enabled: Boolean(registryAddress && quoteTokenAddresses?.length) },
  });
  const registeredQuotes: RegisteredQuoteToken[] = (quoteTokenAddresses ?? []).flatMap((address, index) => {
    const result = quoteConfigResults?.[index];
    if (result?.status !== "success") return [];
    const [usdFeed, maxStaleness, enabled] = result.result;
    if (!enabled) return [];
    return [{
      address,
      usdFeed,
      maxStaleness: Number(maxStaleness),
    }];
  });
  const { pools, isLoading: poolsLoading } = useCompatibleUniswapV3Pools(
    chainId,
    assetAddress,
    pricingModalOpen && draftConfig.source === 2,
    registeredQuotes,
  );
  const pricingAssetAddress = isAddress(assetAddress) ? assetAddress as `0x${string}` : undefined;
  const { data: onchainAssetTicker } = useReadContract({
    address: pricingAssetAddress,
    abi: erc20MetadataReadAbi,
    functionName: "symbol",
    chainId,
    query: { enabled: Boolean(pricingModalOpen && pricingAssetAddress && !assetTicker) },
  });
  const expectedAssetTicker = assetTicker?.trim() || String(onchainAssetTicker ?? "").trim().slice(0, 16);
  const chainlinkFeedAddress = pricingModalOpen
    && draftConfig.source !== 2
    && isAddress(draftConfig.primarySource)
    && draftConfig.primarySource !== zeroAddress
      ? draftConfig.primarySource
      : undefined;
  const {
    data: feedPreviewResults,
    isLoading: feedPreviewLoading,
    isError: feedPreviewReadFailed,
  } = useReadContracts({
    contracts: chainlinkFeedAddress ? [
      { address: chainlinkFeedAddress, abi: aggregatorV3ReadAbi, functionName: "latestRoundData" as const, chainId },
      { address: chainlinkFeedAddress, abi: aggregatorV3ReadAbi, functionName: "decimals" as const, chainId },
      { address: chainlinkFeedAddress, abi: aggregatorV3ReadAbi, functionName: "description" as const, chainId },
    ] : [],
    query: { enabled: Boolean(chainlinkFeedAddress) },
  });
  const feedRoundResult = feedPreviewResults?.[0];
  const feedDecimalsResult = feedPreviewResults?.[1];
  const feedDescriptionResult = feedPreviewResults?.[2];
  const feedPreviewPending = Boolean(
    chainlinkFeedAddress
    && !feedPreviewReadFailed
    && (feedPreviewLoading || !feedPreviewResults),
  );
  const feedRound = feedRoundResult?.status === "success"
    ? feedRoundResult.result as readonly [bigint, bigint, bigint, bigint, bigint]
    : undefined;
  const feedDecimals = feedDecimalsResult?.status === "success" ? Number(feedDecimalsResult.result) : undefined;
  const feedDescription = feedDescriptionResult?.status === "success" ? String(feedDescriptionResult.result).trim() : undefined;
  const feedExpectedQuote = draftConfig.source === 1 ? quoteTokenLabel(draftConfig.quoteToken) : "USD";
  const feedPairMatches = feedDescription && expectedAssetTicker
    ? chainlinkDescriptionMatchesPair(feedDescription, expectedAssetTicker, feedExpectedQuote)
    : undefined;
  const currentTimestamp = Math.floor(Date.now() / 1_000);
  const feedRoundValid = Boolean(
    feedRound
    && feedRound[0] > 0n
    && feedRound[1] > 0n
    && feedRound[2] > 0n
    && feedRound[3] >= feedRound[2]
    && Number(feedRound[3]) <= currentTimestamp
    && feedRound[4] >= feedRound[0]
    && feedDecimals !== undefined
    && feedDecimals <= 36,
  );
  const feedFresh = Boolean(
    feedRoundValid
    && feedRound
    && Number(feedRound[3]) + draftConfig.primaryMaxStaleness >= currentTimestamp,
  );
  const feedDescriptionValid = Boolean(feedDescription && expectedAssetTicker && feedPairMatches);
  const feedPreviewValid = feedRoundValid && feedFresh && feedDescriptionValid;
  const feedPreviewValue = feedRound && feedDecimals !== undefined
    ? Number(formatUnits(feedRound[1], feedDecimals))
    : undefined;
  const feedPreviewDisplay = feedPreviewValue === undefined
    ? "-"
    : feedExpectedQuote === "USD"
      ? formatOraclePrice(feedPreviewValue)
      : `${feedPreviewValue.toLocaleString(undefined, { maximumFractionDigits: 8 })} ${feedExpectedQuote}`;

  useEffect(() => {
    setPricingModalOpen(false);
    setDraftConfig(config);
  // The asset identity owns the pricing modal lifecycle.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetAddress, chainId]);

  const closePricingModal = useCallback(() => {
    setPricingModalOpen(false);
    window.setTimeout(() => pricingTriggerRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (!pricingModalOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePricingModal();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [closePricingModal, pricingModalOpen]);

  function openPricingModal() {
    setDraftConfig(pricingConfigIsComplete(config) ? config : {
      ...emptyPricingConfig(),
      primaryMaxStaleness: DEFAULT_ORACLE_STALENESS_SECONDS,
    });
    setPricingModalOpen(true);
  }

  const draftVerification = pricingVerification(chainId, assetAddress, draftConfig);

  return (
    <>
      <div className="pricingConfigurationFields">
        <div className="pricingConfigurationHeader">
          <span>Pricing configuration</span>
        </div>
        <div className="pricingConfigurationChoices">
          {approved.map((choice, index) => (
            <button
              className={approvedIndex === index ? "active" : ""}
              key={`${choice.source}-${choice.primarySource}`}
              type="button"
              disabled={disabled}
              aria-pressed={approvedIndex === index}
              onClick={() => onChange(choice)}
            >
              <span>{pricingSourceLabel(choice.source)}</span>
              <small>{shortAddress(choice.primarySource)}</small>
              {approvedIndex === index ? <Check size={13} aria-hidden="true" /> : null}
            </button>
          ))}
          <button
            ref={pricingTriggerRef}
            className={approvedIndex < 0 ? "active warning" : ""}
            type="button"
            disabled={disabled}
            aria-pressed={approvedIndex < 0}
            onClick={openPricingModal}
          >
            <span>{approved.length ? (approvedIndex < 0 ? "Edit unverified pricing" : "Custom pricing") : pricingConfigIsComplete(config) ? "Edit pricing" : "Configure pricing"}</span>
            <small>{approvedIndex < 0 && pricingConfigIsComplete(config) ? pricingSourceLabel(config.source) : "Choose source and details"}</small>
            <Pencil size={13} aria-hidden="true" />
          </button>
        </div>
        {verification.availabilityWarning ? (
          <small className="availabilityWarning">
            This verified source uses a shorter freshness limit and may be unavailable more often.
          </small>
        ) : null}
      </div>

      {pricingModalOpen ? (
        <div className="priceDetailsBackdrop" onMouseDown={(event) => event.target === event.currentTarget && closePricingModal()}>
          <section
            className="pricingSetupModal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={modalTitleId}
            aria-describedby={modalDescriptionId}
            onKeyDown={(event) => {
              if (event.key !== "Tab") return;
              const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
                "button:not([disabled]), input:not([disabled]), select:not([disabled])",
              ));
              const first = focusable.at(0);
              const last = focusable.at(-1);
              if (!first || !last) return;
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
              }
            }}
          >
            <header className="pricingSetupModalHeader">
              <div>
                <h2 id={modalTitleId}>Set pricing configuration</h2>
                <p id={modalDescriptionId}>Choose the oracle type and exact source this OTF will pin for the asset.</p>
              </div>
              <button className="sunsetDialogClose" type="button" aria-label="Close pricing configuration" autoFocus onClick={closePricingModal}>
                <X size={16} />
              </button>
            </header>

            <div className="pricingSetupModalBody customPricingFields">
              <label>
                <span>Pricing type</span>
                <select
                  value={draftConfig.source}
                  disabled={disabled}
                  onChange={(event) => setDraftConfig({
                    source: Number(event.target.value) as PricingSource,
                    quoteToken: zeroAddress,
                    primarySource: zeroAddress,
                    secondarySource: zeroAddress,
                    primaryMaxStaleness: DEFAULT_ORACLE_STALENESS_SECONDS,
                    secondaryMaxStaleness: [1, 2].includes(Number(event.target.value)) ? 60 * 60 : 0,
                  })}
                >
                  <option value={0}>Chainlink</option>
                  <option value={1}>Chainlink Composed</option>
                  <option value={2}>Uniswap V3 TWAP</option>
                  <option value={3}>Chainlink Robinhood</option>
                </select>
              </label>
              {draftConfig.source === 1 || draftConfig.source === 2 ? (
                <label>
                  <span>Registered quote token</span>
                  <select
                    value={registeredQuotes.some((quote) => quote.address.toLowerCase() === draftConfig.quoteToken.toLowerCase()) ? draftConfig.quoteToken : ""}
                    disabled={disabled || registeredQuotes.length === 0}
                    onChange={(event) => {
                      const quote = registeredQuotes.find((candidate) => candidate.address === event.target.value);
                      if (!quote) return;
                      setDraftConfig((current) => ({
                        ...current,
                        quoteToken: quote.address,
                        secondarySource: quote.usdFeed,
                        secondaryMaxStaleness: quote.maxStaleness,
                      }));
                    }}
                  >
                    <option value="">{registeredQuotes.length ? "Choose a quote token" : "No enabled quote tokens"}</option>
                    {registeredQuotes.map((quote) => (
                      <option key={quote.address} value={quote.address}>{quoteTokenLabel(quote.address)}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              {draftConfig.source === 2 ? (
                <>
                  <label>
                    <span>Compatible pools</span>
                    <select
                      value={pools.some((pool) => pool.address.toLowerCase() === draftConfig.primarySource.toLowerCase()) ? draftConfig.primarySource : ""}
                      disabled={disabled || poolsLoading || pools.length === 0}
                      onChange={(event) => {
                        const pool = pools.find((candidate) => candidate.address === event.target.value);
                        if (!pool) return;
                        setDraftConfig((current) => ({ ...current, primarySource: pool.address, quoteToken: pool.quoteToken }));
                      }}
                    >
                      <option value="">{poolsLoading ? "Discovering pools…" : pools.length ? "Choose a pool" : "No compatible pools found"}</option>
                      {pools.map((pool) => (
                        <option key={pool.address} value={pool.address}>
                          {pool.quoteSymbol} · {(pool.fee / 10_000).toFixed(2)}% · {shortAddress(pool.address)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Pool address</span>
                    <input
                      className={draftConfig.primarySource !== zeroAddress && !isAddress(draftConfig.primarySource) ? "invalid" : undefined}
                      value={draftConfig.primarySource === zeroAddress ? "" : draftConfig.primarySource}
                      disabled={disabled}
                      onChange={(event) => setDraftConfig((current) => ({ ...current, primarySource: event.target.value.trim() as `0x${string}` }))}
                      placeholder="Select above or enter 0x address"
                    />
                  </label>
                </>
              ) : (
                <label>
                  <span>{draftConfig.source === 1 ? "Asset/quote Chainlink feed" : "Asset/USD Chainlink feed"}</span>
                  <input
                    className={draftConfig.primarySource !== zeroAddress && !isAddress(draftConfig.primarySource) ? "invalid" : undefined}
                    value={draftConfig.primarySource === zeroAddress ? "" : draftConfig.primarySource}
                    disabled={disabled}
                    onChange={(event) => setDraftConfig((current) => ({ ...current, primarySource: event.target.value.trim() as `0x${string}` }))}
                    placeholder="0x feed address"
                  />
                </label>
              )}
              {draftConfig.source !== 2 && chainlinkFeedAddress ? (
                <div className={`chainlinkFeedPreview ${feedPreviewValid ? "valid" : "warning"}`} role="status" aria-live="polite">
                  <div className="chainlinkFeedPreviewHeader">
                    <span>Chainlink feed details</span>
                    <span className={`stateBadge ${feedPreviewPending ? "muted" : feedPreviewValid ? "success" : "warning"}`}>
                      {feedPreviewPending ? "Checking" : feedPreviewValid ? "Validated" : "Review"}
                    </span>
                  </div>
                  {feedPreviewPending ? (
                    <small>Reading the latest round and feed description…</small>
                  ) : feedRound && feedDecimals !== undefined && feedDescription ? (
                    <>
                      <dl>
                        <div><dt>Latest answer</dt><dd>{feedPreviewDisplay}</dd></div>
                        <div><dt>Feed description</dt><dd>{feedDescription}</dd></div>
                        <div><dt>Latest update</dt><dd>{feedRound[3] > 0n ? formatTimestamp(Number(feedRound[3])) : "Unavailable"}</dd></div>
                        <div><dt>Freshness</dt><dd>{feedFresh ? `Within ${formatPricingDuration(draftConfig.primaryMaxStaleness)}` : "Outside the selected limit"}</dd></div>
                      </dl>
                      <div className={`chainlinkPairValidation ${feedPairMatches ? "success" : "warning"}`}>
                        {feedPairMatches ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
                        <span>{feedPairMatches
                          ? `Pair matches ${expectedAssetTicker} / ${feedExpectedQuote}.`
                          : expectedAssetTicker
                            ? `Expected ${expectedAssetTicker} / ${feedExpectedQuote}; review the feed description before saving.`
                            : `Feed description found. Confirm that it prices this asset against ${feedExpectedQuote}.`}</span>
                      </div>
                    </>
                  ) : (
                    <small>No valid Chainlink AggregatorV3 metadata was returned for this address.</small>
                  )}
                </div>
              ) : null}
              {draftConfig.source === 1 || draftConfig.source === 2 ? (
                <div className="quoteRegistrySummary">
                  <span>Current admin-managed quote/USD configuration</span>
                  <strong>{draftConfig.secondarySource !== zeroAddress ? shortAddress(draftConfig.secondarySource) : "Choose a quote token"}</strong>
                  <small>
                    {draftConfig.secondarySource !== zeroAddress
                      ? `${formatPricingDuration(draftConfig.secondaryMaxStaleness)} · full Chainlink round validation`
                      : "The registry supplies the Chainlink-compatible feed and freshness limit."}
                  </small>
                </div>
              ) : null}
              <label>
                <span>{draftConfig.source === 1 ? "Asset/quote freshness limit" : "Freshness limit"}</span>
                <input
                  type="number"
                  min={1}
                  max={MAX_ORACLE_STALENESS_SECONDS}
                  step={1}
                  value={draftConfig.primaryMaxStaleness}
                  disabled={disabled}
                  onChange={(event) => setDraftConfig((current) => ({ ...current, primaryMaxStaleness: Number(event.target.value) }))}
                />
                <small>Seconds; nonzero and no more than 7 days.</small>
              </label>
              {draftConfig.source === 3 ? (
                <small className="pricingSetupNote">Robinhood pricing requires a Robinhood-aware oracle and blocks oracle-dependent actions while its pause status is true.</small>
              ) : null}
              {draftVerification.availabilityWarning ? (
                <small className="availabilityWarning">This source uses a shorter freshness limit and may be unavailable more often.</small>
              ) : null}
            </div>

            <footer className="pricingSetupModalActions">
              <button className="secondaryAction" type="button" onClick={closePricingModal}>Cancel</button>
              <button
                className="primaryAction"
                type="button"
                disabled={
                  !pricingConfigIsComplete(draftConfig)
                  || (draftConfig.source !== 2 && (!feedPreviewValid || feedPreviewPending))
                }
                onClick={() => {
                  onChange(draftConfig);
                  closePricingModal();
                }}
              >
                Save pricing
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}

function vaultAddressFromPathname(pathname: string): `0x${string}` | undefined {
  const segment = pathname.split("/").filter(Boolean)[1];
  return segment && isAddress(segment) ? segment : undefined;
}

function transactionHashFromLocation(): `0x${string}` | undefined {
  if (typeof window === "undefined") return undefined;
  const value = new URLSearchParams(window.location.search).get("tx");
  return value && /^0x[0-9a-fA-F]{64}$/.test(value) ? value as `0x${string}` : undefined;
}

function shortAddress(address?: string): string {
  if (!address) return "Not configured";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function shortAssetAddress(address: string): string {
  return `${address.slice(0, 10)}...${address.slice(-6)}`;
}

function symbolMonogram(symbol: string): string {
  const value = symbol.replace(/^OTF-/, "").replace(/[^A-Z0-9]/gi, "");
  return (value || "OTF").slice(0, 4).toUpperCase();
}

function formatWalletTokenBalance(
  value: bigint | undefined,
  decimals: number,
  maximumFractionDigits = 6,
): string {
  if (value === undefined) return "—";
  const amount = Number(formatUnits(value, decimals));
  return amount.toLocaleString(undefined, { maximumFractionDigits });
}

function oracleTokenValue(
  amount: bigint | undefined,
  tokenDecimals: number,
  price: CatalogOraclePrice | undefined,
): bigint | undefined {
  if (amount === undefined || price?.answer === undefined || price.answer <= 0n || price.decimals === undefined) return undefined;
  return amount * price.answer * 10n ** 18n
    / (10n ** BigInt(tokenDecimals) * 10n ** BigInt(price.decimals));
}

function tokenAmountForOracleValue(
  value: bigint | undefined,
  tokenDecimals: number,
  price: CatalogOraclePrice | undefined,
): bigint | undefined {
  if (value === undefined || price?.answer === undefined || price.answer <= 0n || price.decimals === undefined) return undefined;
  return value * 10n ** BigInt(tokenDecimals) * 10n ** BigInt(price.decimals)
    / (price.answer * 10n ** 18n);
}

function weightPercentFromValue(value: bigint | undefined, nav: bigint | undefined): number | undefined {
  if (value === undefined || nav === undefined || nav <= 0n) return undefined;
  return Number(value * 1_000n / nav) / 10;
}

function catalogAssetForAddress(catalog: VerifiedCatalogAsset[], address: string) {
  return catalog.find(
    (asset) => asset.address.toLowerCase() === address.toLowerCase(),
  );
}

function assetIsVerifiedForAddress(catalog: VerifiedCatalogAsset[], address: string): boolean {
  return Boolean(catalogAssetForAddress(catalog, address)?.verified);
}

function useVaultPinnedOraclePrices(vault: VaultView, enabled: boolean): CatalogOraclePrices {
  const { data: feedResults } = useReadContracts({
    contracts: enabled && vault.address
      ? vault.allocations.map((asset) => ({
          address: vault.address as `0x${string}`,
          abi: managedOtfVaultAbi,
          functionName: "pricingConfigForAsset" as const,
          args: [asset.address as `0x${string}`] as const,
          chainId: robinhoodChainTestnet.id,
        }))
      : [],
    query: { enabled: enabled && Boolean(vault.address && vault.allocations.length) },
  });
  const feeds = vault.allocations.map((asset, index) => {
    const result = feedResults?.[index];
    const feed = result?.status === "success"
      ? result.result[5] as `0x${string}`
      : undefined;
    return { asset: asset.address, feed: feed && feed !== zeroAddress ? feed : undefined };
  });
  const { data: priceResults } = useReadContracts({
    contracts: feeds.flatMap(({ feed }) => feed ? [
      {
        address: feed,
        abi: aggregatorV3ReadAbi,
        functionName: "latestRoundData" as const,
        chainId: robinhoodChainTestnet.id,
      },
      {
        address: feed,
        abi: aggregatorV3ReadAbi,
        functionName: "decimals" as const,
        chainId: robinhoodChainTestnet.id,
      },
    ] : []),
    query: { enabled: enabled && feeds.some(({ feed }) => Boolean(feed)) },
  });
  return useMemo(() => {
    const prices: CatalogOraclePrices = {};
    let cursor = 0;
    feeds.forEach(({ asset, feed }) => {
      if (!feed) {
        prices[asset.toLowerCase()] = { display: "Pinned feed unavailable" };
        return;
      }
      const roundResult = priceResults?.[cursor * 2];
      const decimalsResult = priceResults?.[cursor * 2 + 1];
      cursor += 1;
      const round = roundResult?.status === "success"
        ? roundResult.result as readonly [bigint, bigint, bigint, bigint, bigint]
        : undefined;
      const decimals = decimalsResult?.status === "success" ? Number(decimalsResult.result) : undefined;
      const answer = round?.[1];
      const value = answer !== undefined && answer > 0n && decimals !== undefined
        ? Number(formatUnits(answer, decimals))
        : undefined;
      prices[asset.toLowerCase()] = {
        answer,
        decimals,
        updatedAt: round?.[3],
        value,
        display: formatOraclePrice(value),
      };
    });
    return prices;
  }, [feeds, priceResults]);
}

function useVaultPinnedPricingConfigs(vault: VaultView, enabled: boolean) {
  const { data, isLoading } = useReadContracts({
    contracts: enabled && vault.address
      ? vault.allocations.map((asset) => ({
          address: vault.address as `0x${string}`,
          abi: managedOtfVaultAbi,
          functionName: "pricingConfigForAsset" as const,
          args: [asset.address as `0x${string}`] as const,
          chainId: robinhoodChainTestnet.id,
        }))
      : [],
    query: { enabled: enabled && Boolean(vault.address && vault.allocations.length) },
  });
  const configs = useMemo(() => Object.fromEntries(vault.allocations.map((asset, index) => {
    const result = data?.[index];
    if (result?.status !== "success") return [asset.address.toLowerCase(), undefined];
    const [
      configured,
      source,
      quoteToken,
      primarySource,
      secondarySource,
      ,
      primaryMaxStaleness,
      secondaryMaxStaleness,
    ] = result.result;
    return [
      asset.address.toLowerCase(),
      configured && (source === 0 || source === 1 || source === 2 || source === 3)
        ? {
            source,
            quoteToken,
            primarySource,
            secondarySource,
            primaryMaxStaleness,
            secondaryMaxStaleness,
          } as AssetPricingConfig
        : undefined,
    ];
  })), [data, vault.allocations]);
  return { configs, isLoading };
}

function AssetLogo({ logoUrl, symbol, compact = false }: {
  logoUrl?: string;
  symbol: string;
  compact?: boolean;
}) {
  const [failed, setFailed] = useState(!logoUrl);

  useEffect(() => setFailed(!logoUrl), [logoUrl]);

  if (failed || !logoUrl) {
    return (
      <span className={`assetLogoFallback${compact ? " compact" : ""}`} aria-hidden="true">
        {symbolMonogram(symbol).slice(0, 2)}
      </span>
    );
  }

  return (
    // The source is build-time metadata and must remain a direct CDN request so a bad URL can fall back locally.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={`assetLogo${compact ? " compact" : ""}`}
      src={logoUrl}
      alt=""
      width={compact ? 22 : 32}
      height={compact ? 22 : 32}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

function formatOraclePrice(value: number | undefined): string {
  if (value === undefined) return "Loading";
  return value.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: value < 10 ? 4 : 2,
  });
}

function formatRwaOraclePrice(price: CatalogOraclePrice | undefined): string {
  if (price?.value === undefined) return "Loading";

  const formattedPrice = price.value.toLocaleString(undefined, {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
  if (price.updatedAt === undefined || price.updatedAt <= 0n) return `${formattedPrice}$`;

  const ageSeconds = Math.max(
    0,
    Math.floor(Date.now() / 1_000) - Number(price.updatedAt),
  );
  if (ageSeconds < 60) return `${formattedPrice}$ (just now)`;
  if (ageSeconds < 3_600) return `${formattedPrice}$ (${Math.floor(ageSeconds / 60)}m ago)`;
  if (ageSeconds < 72 * 3_600) return `${formattedPrice}$ (${Math.floor(ageSeconds / 3_600)}h ago)`;
  return `${formattedPrice}$ (${Math.floor(ageSeconds / 86_400)}d ago)`;
}

function formatSeedTokenAmount(value: bigint | undefined): string {
  if (value === undefined) return "";
  const formatted = Number(formatUnits(value, 18));
  return formatted.toLocaleString(undefined, { maximumFractionDigits: 8, useGrouping: false });
}

function formatUsd18(value?: bigint): string | undefined {
  if (value === undefined) return undefined;
  const amount = Number(formatUnits(value, 18));
  return amount.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: amount >= 1_000 ? 0 : 2,
  });
}

function bpsToPercent(value?: number): string {
  if (value === undefined) return "Not available";
  return `${(value / 100).toFixed(value % 100 === 0 ? 0 : 2)}%`;
}

function quotedSlippageBps(quotedValue?: bigint, referenceValue?: bigint): number | undefined {
  if (quotedValue === undefined || referenceValue === undefined || referenceValue <= 0n) return undefined;
  return Number((referenceValue - quotedValue) * 10_000n / referenceValue);
}

function formatQuotedSlippage(value?: number): string {
  if (value === undefined) return "—";
  if (value < 0) return `${(Math.abs(value) / 100).toFixed(2)}% better`;
  return `${(value / 100).toFixed(2)}%`;
}

function bpsToAllocationPercent(value: number): string {
  return `${(value / 100).toFixed(1)}%`;
}

function bpsToCompactPercent(value: number): string {
  const percent = value / 100;
  const fractionDigits = percent < 0.1 ? 2 : percent < 1 ? 1 : Number.isInteger(percent) ? 0 : 1;
  return `${percent.toFixed(fractionDigits)}%`;
}

function signedBpsToAllocationPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${bpsToAllocationPercent(value)}`;
}

function resultAt<T extends ContractValue>(results: ReadResult | undefined, index: number): T | undefined {
  return results?.[index]?.result as T | undefined;
}

function normalizeAllocations(
  assets?: readonly string[],
  weights?: readonly number[] | readonly bigint[],
  currentWeights?: readonly number[] | readonly bigint[],
  catalog: VerifiedCatalogAsset[] = [],
): Allocation[] {
  if (!assets?.length || !weights?.length) return [];

  return assets.map((address, index) => {
    const weight = Number(weights[index] ?? 0);
    const catalogAsset = catalogAssetForAddress(catalog, address);
    return {
      symbol: catalogAsset?.symbol ?? `Asset ${index + 1}`,
      name: catalogAsset?.name ?? "Supported token",
      address,
      targetWeightBps: weight,
      actualWeightBps: Number(currentWeights?.[index] ?? weight),
      tone: allocationTones[index % allocationTones.length],
      logoUrl: catalogAsset?.logoUrl,
    };
  });
}

function txStateLabel(state: TxState): { label: string; tone: "muted" | "info" | "success" | "warning" | "danger" } {
  if (state === "simulating") return { label: "Validating configuration", tone: "info" };
  if (state === "ready") return { label: "Validation passed. No transaction was sent.", tone: "success" };
  if (state === "pending") return { label: "Awaiting wallet signature", tone: "warning" };
  if (state === "submitted") return { label: "Submitted, awaiting confirmation", tone: "info" };
  if (state === "confirmed") return { label: "Confirmed", tone: "success" };
  if (state === "reverted") return { label: "Transaction reverted", tone: "danger" };
  return { label: "Idle", tone: "muted" };
}

const protocolErrorMessages = new Map<string, string>(
  [
    ["SafeTransferFailed()", "A token transfer failed. Check the token balance and try again."],
    ["SafeTransferFromFailed()", "A token transfer was rejected. Check the token balance and approval, then try again."],
    ["SafeApproveFailed()", "The token approval failed. Reset the existing approval or try again."],
    ["ERC20InsufficientBalance(address,uint256,uint256)", "The wallet does not have enough of one of the required tokens."],
    ["ERC20InsufficientAllowance(address,uint256,uint256)", "A token approval is too small for this transaction. Approve the required amount and try again."],
    ["ERC20InvalidReceiver(address)", "The receiving address cannot accept this token transfer."],
    ["ERC20InvalidSender(address)", "The sending address is not valid for this token transfer."],
    ["ERC20NonZeroAllowance(address,address,uint256)", "This token requires its existing approval to be reset before a new approval is set."],
    ["AssetNotContract(address)", "A selected asset address is not a deployed token contract."],
    ["OracleFeedMissing(address)", "A selected token does not have a valid price feed pinned by this OTF."],
    ["OracleFeedNotContract(address)", "A selected feed address is not a deployed contract."],
    ["InvalidPricingConfig(address)", "The selected pricing route is incomplete or contains an invalid contract address."],
    ["InvalidMaxStaleness(uint32)", "Every configured oracle leg needs a freshness limit greater than zero."],
    ["InvalidMaxStaleness()", "Every configured oracle leg needs a freshness limit greater than zero."],
    ["MaxStalenessTooHigh(uint32,uint32)", "An oracle freshness limit exceeds the protocol maximum of seven days."],
    ["InvalidOraclePrice(address,int256)", "A selected token's oracle returned an invalid price."],
    ["InvalidOracleTimestamp(address,uint256)", "A selected token's oracle returned an invalid update time."],
    ["IncompleteOracleRound(address,uint80,uint80)", "A selected token's latest oracle round is incomplete. Try again after the next price update."],
    ["StaleOraclePrice(address,uint256,uint256)", "A selected token's oracle price is too old. Oracle-priced actions will resume after the feed updates."],
    ["OraclePauseStatusUnavailable(address)", "A selected asset does not expose the pause status required by its oracle configuration."],
    ["OraclePaused(address)", "A selected asset's oracle is paused. Oracle-priced actions will resume when the feed is available."],
    ["TokenDecimalsUnavailable(address)", "A selected token did not report its decimals, so its value cannot be calculated safely."],
    ["UnsupportedDecimals(address,uint8)", "A selected token uses a decimals value that the protocol does not support."],
    ["ZeroNav()", "The portfolio currently has no measurable oracle value, so this action cannot be priced."],
    ["InitialShareSupplyTooSmall(uint256,uint256)", "The initial portfolio deposit is too small. Increase the seed amounts and try again."],
    ["InitialAmountZero(address)", "Every selected asset needs a seed amount greater than zero."],
    ["InitialBalanceMismatch(address,uint256,uint256)", "The vault did not receive the expected seed-token amount. Check for fee-on-transfer tokens."],
    ["AssetTransferMismatch(address,uint256,uint256,uint256)", "A token transfer delivered a different amount than expected. Fee-on-transfer tokens are not supported."],
    ["InvalidArrayLength()", "Some portfolio fields are missing or do not match. Review the selected assets and amounts."],
    ["LengthMismatch(uint256,uint256)", "The number of tokens and amounts does not match."],
    ["EmptyPortfolio()", "Add at least one asset to the portfolio."],
    ["InvalidOTFName()", "Enter a valid portfolio name and ticker."],
    ["InvalidWeightSum(uint256)", "Portfolio target weights must add up to 100%."],
    ["InvalidWeights(uint256)", "Portfolio target weights must add up to 100%."],
    ["AssetWeightTooLow(address,uint256,uint256)", "One selected asset is below the protocol's minimum target weight."],
    ["DuplicateConstituent(address)", "The same asset cannot be added to a portfolio more than once."],
    ["StrategyRationaleRequired()", "Add a short rationale explaining this portfolio strategy."],
    ["StrategyRationaleTooLong(uint256)", "The strategy rationale is too long. Shorten it and try again."],
    ["ManagerFeeTooHigh(uint16,uint16)", "The manager fee is above the protocol maximum."],
    ["ManagerFeeTooHigh(uint16,uint16)", "The manager fee is above the protocol maximum."],
    ["InvalidWeightBands(uint16,uint16)", "The proposed weight bands do not satisfy the factory's current policy."],
    ["ZeroShares()", "Enter a share amount greater than zero."],
    ["ZeroInputAmount()", "Enter an input-token amount greater than zero."],
    ["ZeroAmount()", "Enter an amount greater than zero."],
    ["AmountTooHigh(address,uint256,uint256)", "The required token amount exceeds the maximum allowed for this transaction."],
    ["AmountTooLow(address,uint256,uint256)", "The token amount received is below the minimum allowed for this transaction."],
    ["NonProportionalContribution(address,uint256,uint256)", "The supplied tokens do not match the portfolio's required proportions."],
    ["DepositsPausedForAssetRemoval(address)", "Deposits are paused while an asset is being removed from the portfolio."],
    ["ProtocolDepositsPaused()", "New deposits are temporarily paused by the protocol administrator. Redemptions remain available."],
    ["DepositsPaused()", "New OTF creation and deposits are temporarily paused by the protocol administrator."],
    ["VaultSunset()", "This OTF has been sunset. New deposits and portfolio-management actions are permanently disabled."],
    ["VaultAlreadySunset()", "This OTF has already been sunset."],
    ["InsufficientShares(uint256,uint256)", "The share output is below your selected minimum."],
    ["InsufficientAmount(uint256,uint256,uint256)", "One token output is below your selected minimum."],
    ["DeadlineExpired(uint256)", "This quote expired before it could be executed. Request a fresh quote and try again."],
    ["InputAmountMismatch(uint256,uint256)", "The constituent allocations no longer match the input-token amount. Request a fresh quote and try again."],
    ["InvalidDirectLeg(uint256)", "A direct constituent leg contains swap data. Request a fresh quote and try again."],
    ["MinimumOutputNotMet(uint256,uint256)", "The trade output fell below your selected minimum. Request a fresh quote and try again."],
    ["Slippage(uint256,uint256)", "The price moved beyond the allowed slippage. Request a fresh quote and try again."],
    ["NavLossTooHigh(uint256,uint256,uint16)", "This trade would lose more oracle value than the portfolio allows. Reduce the trade size and try again."],
    ["NavLossBudgetExceeded(uint256,uint256,uint16)", "This trade would exceed the OTF's remaining seven-day NAV-loss budget. Reduce the quoted loss or wait for capacity to replenish continuously."],
    ["OracleSlippageTooHigh(address,address,uint256,uint256,uint16)", "The pool quote loses more oracle value than this portfolio allows. Choose a smaller trade size and try again."],
    ["TradeDoesNotImproveTarget(uint256,uint256)", "This trade does not move the portfolio closer to its target allocation."],
    ["AssetMovedAwayFromTarget(address,uint256,uint256)", "This trade moves one asset farther away from its target allocation."],
    ["RemovedAssetBalanceRemaining(address,uint256)", "The removed asset still has a balance. Trade or redeem the remaining amount first."],
    ["TooManyTrades(uint256,uint256)", "This rebalance contains more trades than the protocol allows."],
    ["BadTrade(address,address,uint256)", "One rebalance trade has invalid assets or an invalid amount."],
    ["TradeAssetNotTracked(address)", "A rebalance trade references an asset that is not tracked by this portfolio."],
    ["UnapprovedAdapter(address)", "The selected trading adapter is not approved by the protocol."],
    ["UnapprovedTradeAdapter(address)", "The selected trade adapter is not approved by the protocol."],
    ["StrategyChangeCooldownActive(uint256)", "This portfolio is still in its strategy-change cooldown. Try again after the cooldown ends."],
    ["StrategyActivationPending(uint256)", "A new strategy is waiting for activation and cannot be changed yet."],
    ["PendingStrategyExists()", "This portfolio already has a strategy change waiting for activation."],
    ["StrategyTargetsUnchanged()", "The proposed target allocation is identical to the current strategy."],
    ["StrategyStateLocked()", "The strategy is temporarily locked while another strategy action is active."],
    ["StrategicRebalanceNotActive()", "No strategic rebalance is currently active."],
    ["TargetBandsNotReached()", "The portfolio has not yet reached the target completion bands."],
    ["NoChallengeBreach()", "The portfolio is currently within its challenge limits."],
    ["ChallengeAlreadyActive()", "A rebalance challenge is already active."],
    ["ChallengeNotActive()", "There is no active rebalance challenge to resolve."],
    ["NotManager()", "Only the portfolio manager can perform this action."],
    ["NotTradeAuthority()", "This wallet is not authorized to execute portfolio trades."],
    ["ExecutorNotAuthorized(address)", "This executor is not authorized for the portfolio."],
    ["ExecutorAlreadyAuthorized(address)", "This executor is already authorized for the portfolio."],
    ["Reentrancy()", "The contract is already processing another action. Wait for it to finish and try again."],
  ].map(([signature, message]) => [toFunctionSelector(signature), message]),
);

function rawErrorText(error: unknown, seen = new Set<unknown>()): string {
  if (error === null || error === undefined || seen.has(error)) return "";
  seen.add(error);

  const serialized = (() => {
    try {
      return JSON.stringify(error, (_, value) => typeof value === "bigint" ? value.toString() : value);
    } catch {
      return String(error);
    }
  })();
  const nestedCause = error && typeof error === "object" && "cause" in error
    ? rawErrorText((error as { cause?: unknown }).cause, seen)
    : "";
  return [
    serialized,
    error instanceof Error ? error.message : "",
    error && typeof error === "object" && "shortMessage" in error
      ? String((error as { shortMessage?: unknown }).shortMessage ?? "")
      : "",
    nestedCause,
  ].join(" ");
}

function errorMessage(error: unknown): string {
  const errorText = rawErrorText(error);
  const normalizedError = errorText.toLowerCase();

  if (/user rejected|user denied|request rejected|rejected the request|cancelled by user/.test(normalizedError)) {
    return "The wallet request was cancelled. No transaction was submitted.";
  }
  if (/insufficient funds|exceeds the balance/.test(normalizedError)) {
    return "This wallet does not have enough native currency to pay the network fee.";
  }
  if (/chain mismatch|unsupported chain|wrong network|does not support chain/.test(normalizedError)) {
    return "Switch to Robinhood Chain Testnet in your wallet and try again.";
  }

  for (const selector of errorText.match(/0x[0-9a-fA-F]{8}\b/g) ?? []) {
    const message = protocolErrorMessages.get(selector.toLowerCase());
    if (message) return message;
  }

  const shortMessage = error && typeof error === "object" && "shortMessage" in error
    ? String((error as { shortMessage?: unknown }).shortMessage ?? "").trim()
    : "";
  const isOpaqueContractError = (message: string) =>
    /0x[0-9a-f]{8}\b/i.test(message)
    || /reverted with (?:the following )?signature/i.test(message)
    || /^execution reverted\.?$/i.test(message)
    || /unknown custom error/i.test(message);

  if (shortMessage && !isOpaqueContractError(shortMessage)) return shortMessage;
  if (/timeout|timed out|failed to fetch|network error|rpc request/.test(normalizedError)) {
    return "The network request failed. Check your connection and try again.";
  }
  return "The contract rejected this request. Refresh the onchain data, review the form values and token approvals, then try again.";
}

const viewPaths: Record<AppView, string> = {
  landing: "/",
  vaults: "/otfs",
  detail: "/otfs/unconfigured",
  create: "/create",
  created: "/otfs/unconfigured/created",
  manage: "/otfs/unconfigured/manage",
  deposits: "/wallet",
  verified: "/verified",
};

function viewFromPathname(pathname: string, hostname?: string): AppView {
  if (pathname === "/create") return "create";
  if (pathname === "/wallet") return "deposits";
  if (pathname === "/verified") return "verified";
  if (pathname.endsWith("/created")) return "created";
  if (pathname.endsWith("/manage")) return "manage";
  if (pathname.startsWith("/otfs/")) return "detail";
  if (pathname === "/otfs") return "vaults";
  if (pathname === "/" && isAppHostname(hostname)) return "vaults";
  return "landing";
}

export function RebalanceCooldownPanel({ initialView = "landing" }: { initialView?: AppView }) {
  const factoryAddress = configuredFactoryAddress();
  const { address: connectedAddress } = useAccount();
  const chainId = useChainId();
  const isTestnet = chainId === robinhoodChainTestnet.id;
  const testnetCreateAssets = useVerifiedAssetCatalog();
  const [view, setView] = useState<AppView>(initialView);
  const [selectedVaultAddress, setSelectedVaultAddress] = useState<`0x${string}` | undefined>(
    () => typeof window === "undefined" ? undefined : vaultAddressFromPathname(window.location.pathname),
  );
  const [createdTxHash, setCreatedTxHash] = useState<`0x${string}` | undefined>(
    transactionHashFromLocation,
  );
  const [lastReadAt, setLastReadAt] = useState<number>();

  const {
    data: factoryVaultCount,
    error: factoryError,
    isLoading: factoryLoading,
  } = useReadContract({
    address: factoryAddress,
    abi: otfFactoryAbi,
    functionName: "vaultCount",
    chainId: robinhoodChainTestnet.id,
    query: {
      enabled: Boolean(factoryAddress) && isTestnet,
      refetchInterval: 12_000,
    },
  });
  const factoryVaultContracts = factoryAddress && isTestnet
    ? Array.from({ length: Number(factoryVaultCount ?? 0n) }, (_, index) => ({
        address: factoryAddress,
        abi: otfFactoryAbi,
        functionName: "vaultAt" as const,
        args: [BigInt(index)] as const,
        chainId: robinhoodChainTestnet.id,
      }))
    : undefined;
  const { data: factoryVaultData } = useReadContracts({
    contracts: factoryVaultContracts,
    query: { enabled: Boolean(factoryVaultContracts), refetchInterval: 12_000 },
  });
  const catalogFeedAddresses = testnetCreateAssets.map((asset) => {
    const pricing = configuredPricingConfig(asset.address);
    return (pricing?.source === 0 || pricing?.source === 3) && isAddress(pricing.primarySource)
      ? pricing.primarySource
      : undefined;
  });
  const catalogPricesReady = catalogFeedAddresses.every(
    (address): address is `0x${string}` => Boolean(address),
  );
  const catalogPriceContracts = catalogPricesReady
    ? catalogFeedAddresses.flatMap((address) => ([
        {
          address,
          abi: aggregatorV3ReadAbi,
          functionName: "latestRoundData" as const,
          chainId: robinhoodChainTestnet.id,
        },
        {
          address,
          abi: aggregatorV3ReadAbi,
          functionName: "decimals" as const,
          chainId: robinhoodChainTestnet.id,
        },
      ] as const))
    : undefined;
  const { data: catalogPriceResults } = useReadContracts({
    contracts: catalogPriceContracts,
    query: {
      enabled: Boolean(catalogPriceContracts) && isTestnet,
      refetchInterval: 12_000,
      refetchOnWindowFocus: true,
    },
  });
  const catalogOraclePrices = useMemo<CatalogOraclePrices>(() => Object.fromEntries(
    testnetCreateAssets.map((asset, index) => {
      const round = catalogPriceResults?.[index * 2]?.result as
        | readonly [bigint, bigint, bigint, bigint, bigint]
        | undefined;
      const decimals = catalogPriceResults?.[index * 2 + 1]?.result;
      const parsedDecimals = typeof decimals === "number" ? decimals : undefined;
      const answer = round?.[1];
      const updatedAt = round?.[3];
      const value = answer !== undefined && answer > 0n && parsedDecimals !== undefined
        ? Number(formatUnits(answer, parsedDecimals))
        : undefined;
      return [asset.address.toLowerCase(), {
        answer,
        decimals: parsedDecimals,
        updatedAt,
        value,
        display: formatOraclePrice(value),
      }];
    }),
  ), [catalogPriceResults]);

  const factoryVaultAddresses = useMemo(
    () => isTestnet
      ? (factoryVaultData ?? []).flatMap((result) => result.status === "success" && isAddress(result.result)
        ? [result.result]
        : []).filter(
          (address): address is `0x${string}` => isAddress(address),
        )
      : [],
    [factoryVaultData, isTestnet],
  );
  const selectedIsFactoryVault = Boolean(
    selectedVaultAddress &&
    factoryVaultAddresses.some(
      (address) => address.toLowerCase() === selectedVaultAddress.toLowerCase(),
    ),
  );
  const routeNeedsSelectedVault = view === "detail" || view === "created" || view === "manage";
  const vaultAddress = routeNeedsSelectedVault
    ? selectedVaultAddress
    : selectedIsFactoryVault
      ? selectedVaultAddress
      : factoryVaultAddresses[0];
  const enabled = Boolean(vaultAddress) && isTestnet;

  const { data: blockNumber } = useBlockNumber({
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(factoryAddress) && isTestnet },
  });

  const readContracts = vaultAddress
    ? ([
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "name" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "symbol" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "manager" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "feeRecipient" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "managerFeeBpsPerYear" },
        { address: factoryAddress ?? zeroAddress, abi: otfFactoryAbi, functionName: "protocolFeeShareBps" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "totalSupply" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "getConstituents" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "maxNavLossBps" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "maxWeightDeviationBps" },
        { address: factoryAddress ?? zeroAddress, abi: otfFactoryAbi, functionName: "minTargetWeightBps" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "totalAssetsValue" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "navPerShare" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "currentWeightsBps" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "challengeWeightDeviationBps" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "isWithinTargetBands" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "strategicRebalanceActive" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "challengeActive" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "challengeStartedAt" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "challengeDeadline" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "challengeTimeRemaining" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "feeState" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "escrowedManagerFeeShares" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "forfeitedManagerFeeShares" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "challengeRewardShares", args: [(connectedAddress ?? zeroAddress) as `0x${string}`] },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "lastCompletedStrategyTimestamp" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "canProposeStrategy" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "authorizedExecutors" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "isWithinChallengeBands" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "strategyProposalPending" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "pendingStrategyActivationTime" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "nextStrategyChangeTime" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "challengeCaller" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "sunset" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "sunsetAt" },
        { address: factoryAddress ?? zeroAddress, abi: otfFactoryAbi, functionName: "depositsPaused" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "navLossBudgetState" },
        {
          address: factoryAddress ?? zeroAddress,
          abi: otfFactoryAbi,
          functionName: "vaultDepositsPaused",
          args: [vaultAddress],
        },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "effectiveProtocolFeeShareBps" },
      ] as const)
    : undefined;

  const { data, error, isLoading, refetch: refetchVaultData } = useReadContracts({
    contracts: readContracts,
    query: {
      enabled: Boolean(readContracts) && isTestnet,
      placeholderData: (previousData) => previousData,
    },
  });

  const directoryContracts = factoryAddress && factoryVaultAddresses.length
    ? factoryVaultAddresses.flatMap((address) => ([
        { address, abi: managedOtfVaultAbi, functionName: "name" },
        { address, abi: managedOtfVaultAbi, functionName: "symbol" },
        { address, abi: managedOtfVaultAbi, functionName: "manager" },
        { address, abi: managedOtfVaultAbi, functionName: "managerFeeBpsPerYear" },
        { address, abi: managedOtfVaultAbi, functionName: "assets" },
        { address, abi: managedOtfVaultAbi, functionName: "totalAssetsValue" },
        { address, abi: managedOtfVaultAbi, functionName: "navPerShare" },
        { address, abi: managedOtfVaultAbi, functionName: "sunset" },
      ] as const))
    : undefined;
  const {
    data: directoryData,
    isLoading: directoryLoading,
  } = useReadContracts({
    contracts: directoryContracts,
    query: { enabled: Boolean(directoryContracts) && isTestnet },
  });
  const directoryResults = directoryData as ReadResult | undefined;
  const vaultSummaries = useMemo<VaultSummary[]>(
    () => factoryVaultAddresses.map((address, index) => {
      const offset = index * 8;
      const name = resultAt<string>(directoryResults, offset);
      const symbol = resultAt<string>(directoryResults, offset + 1);
      const managerValue = resultAt<string>(directoryResults, offset + 2);
      const managerFee = resultAt<number>(directoryResults, offset + 3);
      const vaultAssets = resultAt<readonly string[]>(directoryResults, offset + 4);
      const totalValue = resultAt<bigint>(directoryResults, offset + 5);
      const shareValue = resultAt<bigint>(directoryResults, offset + 6);
      const sunset = Boolean(resultAt<boolean>(directoryResults, offset + 7));
      return {
        address,
        name: name || shortAddress(address),
        symbol: symbol || "OTF",
        manager: managerValue && isAddress(managerValue) ? managerValue : undefined,
        managerFeeBps: managerFee,
        assetCount: vaultAssets?.length ?? 0,
        verified: (vaultAssets?.length ?? 0) > 0
          && (vaultAssets ?? []).every((asset) => assetIsVerifiedForAddress(testnetCreateAssets, asset)),
        navValue: totalValue,
        nav: formatUsd18(totalValue),
        navPerShare: formatUsd18(shareValue),
        sunset,
      };
    }),
    [directoryResults, factoryVaultAddresses],
  );

  const results = data as ReadResult | undefined;
  const vaultName = resultAt<string>(results, 0) ?? "Connected OTF";
  const vaultSymbol = resultAt<string>(results, 1) ?? "OTF";
  const managerResult = resultAt<string>(results, 2);
  const feeRecipientResult = resultAt<string>(results, 3);
  const manager = managerResult && isAddress(managerResult) ? managerResult : undefined;
  const feeRecipient =
    feeRecipientResult && isAddress(feeRecipientResult) ? feeRecipientResult : undefined;
  const managerFeeBps = resultAt<number>(results, 4) ?? 0;
  const protocolFeeShareBps = resultAt<number>(results, 5) ?? 0;
  const totalSupply = resultAt<bigint>(results, 6);
  const constituents = resultAt<readonly string[]>(results, 7) as unknown as
    | readonly [readonly string[], readonly number[] | readonly bigint[]]
    | undefined;
  const assets = constituents?.[0];
  const targetWeights = constituents?.[1];
  const maxNavLossBps = resultAt<number>(results, 8) ?? 0;
  const maxWeightDeviationBps = resultAt<number>(results, 9) ?? 0;
  const cooldownSeconds = 14 * 86_400;
  const minTargetWeightBps = resultAt<number>(results, 10);
  const totalAssetsValue = resultAt<bigint>(results, 11);
  const navPerShareValue = resultAt<bigint>(results, 12);
  const currentWeights = resultAt<readonly number[] | readonly bigint[]>(results, 13);
  const challengeWeightDeviationBps = resultAt<number>(results, 14) ?? 0;
  const withinCompletionBands = Boolean(resultAt<boolean>(results, 15));
  const strategicRebalanceActive = Boolean(resultAt<boolean>(results, 16));
  const challengeActive = Boolean(resultAt<boolean>(results, 17));
  const challengeStartedAt = resultAt<bigint>(results, 18)
    ? Number(resultAt<bigint>(results, 18))
    : undefined;
  const challengeDeadline = resultAt<bigint>(results, 19)
    ? Number(resultAt<bigint>(results, 19))
    : undefined;
  const challengeGracePeriod = challengeStartedAt && challengeDeadline
    ? challengeDeadline - challengeStartedAt
    : 0;
  const challengeTimeRemaining = Number(resultAt<bigint>(results, 20) ?? 0n);
  const feeState = Number(resultAt<number>(results, 21) ?? 0);
  const escrowedManagerFeeSharesValue = resultAt<bigint>(results, 22);
  const forfeitedManagerFeeSharesValue = resultAt<bigint>(results, 23);
  const claimableChallengeRewardValue = resultAt<bigint>(results, 24);
  const lastStrategyCompletion = resultAt<bigint>(results, 25)
    ? Number(resultAt<bigint>(results, 25))
    : undefined;
  const canProposeStrategy = Boolean(resultAt<boolean>(results, 26));
  const authorizedExecutors = resultAt<readonly string[]>(results, 27) ?? [];
  const withinChallengeBands = Boolean(resultAt<boolean>(results, 28));
  const strategyProposalPending = Boolean(resultAt<boolean>(results, 29));
  const pendingStrategyActivationTime = resultAt<bigint>(results, 30)
    ? Number(resultAt<bigint>(results, 30))
    : undefined;
  const nextStrategyChange = resultAt<bigint>(results, 31)
    ? Number(resultAt<bigint>(results, 31))
    : undefined;
  const challengeCaller = resultAt<string>(results, 32);
  const sunset = Boolean(resultAt<boolean>(results, 33));
  const sunsetAt = resultAt<bigint>(results, 34)
    ? Number(resultAt<bigint>(results, 34))
    : undefined;
  const protocolDepositsPaused = Boolean(resultAt<boolean>(results, 35));
  const navLossBudget = resultAt<readonly [bigint, number, number]>(results, 36);
  const vaultDepositsPaused = Boolean(resultAt<boolean>(results, 37));
  const effectiveProtocolFeeShareBps =
    resultAt<number>(results, 38) ?? protocolFeeShareBps;
  const depositPauseStatusUnavailable = Boolean(enabled) && (
    results?.[35]?.status !== "success" || results?.[37]?.status !== "success"
  );
  const navLossBudgetRecoveryAt = navLossBudget?.[0] ? Number(navLossBudget[0]) : undefined;
  const navLossBudgetUsedBps = Number(navLossBudget?.[1] ?? 0);
  const allocations = normalizeAllocations(assets, targetWeights, currentWeights, testnetCreateAssets);
  const cooldownProgress = progressThroughCooldown(lastStrategyCompletion, nextStrategyChange);
  const connectedIsManager =
    connectedAddress && manager && connectedAddress.toLowerCase() === manager.toLowerCase();
  const supplyDisplay = totalSupply !== undefined
    ? `${formatWalletTokenBalance(totalSupply, 18)} ${vaultSymbol}`
    : "Not available";
  const dataMode: DataMode = !isTestnet
    ? "unavailable"
    : enabled && Boolean(results?.[0]?.result)
      ? "live"
      : "empty";

  const vault = {
    name: vaultName,
    symbol: vaultSymbol,
    address: vaultAddress,
    manager,
    feeRecipient,
    managerFeeBps,
    effectiveProtocolFeeShareBps,
    totalSupply: supplyDisplay,
    cooldownSeconds,
    lastStrategyCompletion,
    nextStrategyChange,
    cooldownProgress,
    allocations,
    maxNavLossBps,
    navLossBudgetRecoveryAt,
    navLossBudgetUsedBps,
    maxWeightDeviationBps,
    challengeWeightDeviationBps,
    challengeGracePeriod,
    withinCompletionBands,
    withinChallengeBands,
    strategicRebalanceActive,
    strategyProposalPending,
    pendingStrategyActivationTime,
    challengeActive,
    challengeCaller,
    challengeStartedAt,
    challengeDeadline,
    challengeTimeRemaining,
    feeState,
    escrowedManagerFeeShares: escrowedManagerFeeSharesValue
      ? `${Number(formatUnits(escrowedManagerFeeSharesValue, 18)).toLocaleString()} ${vaultSymbol}`
      : `0 ${vaultSymbol}`,
    forfeitedManagerFeeShares: forfeitedManagerFeeSharesValue
      ? `${Number(formatUnits(forfeitedManagerFeeSharesValue, 18)).toLocaleString()} ${vaultSymbol}`
      : `0 ${vaultSymbol}`,
    claimableChallengeRewardShares: claimableChallengeRewardValue
      ? `${Number(formatUnits(claimableChallengeRewardValue, 18)).toLocaleString()} ${vaultSymbol}`
      : `0 ${vaultSymbol}`,
    claimableChallengeRewardValue,
    canProposeStrategy,
    authorizedExecutors,
    minTargetWeightBps,
    connectedIsManager: Boolean(connectedIsManager),
    enabled,
    isLoading: Boolean(vaultAddress) && isLoading,
    dataMode,
    readFailed: Boolean(error),
    blockNumber,
    lastReadAt,
    navValue: totalAssetsValue,
    nav: formatUsd18(totalAssetsValue),
    navPerShare: formatUsd18(navPerShareValue),
    navPerShareValue,
    factoryAddress,
    factoryVaultCount: factoryVaultAddresses.length,
    factoryReadFailed: Boolean(factoryError),
    sunset,
    sunsetAt,
    protocolDepositsPaused,
    vaultDepositsPaused,
    depositPauseStatusUnavailable,
  };
  const vaultOraclePrices = useVaultPinnedOraclePrices(vault, isTestnet && dataMode === "live");
  const pinnedPricing = useVaultPinnedPricingConfigs(vault, isTestnet && dataMode === "live");
  const vaultPricingVerified = pinnedPricing.isLoading
    ? undefined
    : vault.allocations.length > 0 && vault.allocations.every((asset) => {
        const config = pinnedPricing.configs[asset.address.toLowerCase()];
        return config && isVerifiedPricingConfig(robinhoodChainTestnet.id, asset.address, config);
      });
  const activeTab = view === "verified" ? "Verified" : "Home";

  useEffect(() => {
    if (dataMode === "live" && data) {
      setLastReadAt(Math.floor(Date.now() / 1_000));
    }
  }, [data, dataMode]);

  useEffect(() => {
    const syncViewToHistory = () => {
      setView(viewFromPathname(window.location.pathname, window.location.hostname));
      setSelectedVaultAddress(vaultAddressFromPathname(window.location.pathname));
      setCreatedTxHash(transactionHashFromLocation());
    };
    window.addEventListener("popstate", syncViewToHistory);
    return () => window.removeEventListener("popstate", syncViewToHistory);
  }, []);

  useEffect(() => {
    if (!isTestnet && (view === "detail" || view === "manage")) {
      window.history.replaceState({}, "", isAppHostname(window.location.hostname) ? "/" : viewPaths.vaults);
      setView("vaults");
    }
  }, [isTestnet, view]);

  function openView(nextView: AppView, address?: `0x${string}`) {
    if (nextView === "vaults" && !isAppHostname(window.location.hostname)) {
      window.location.assign(APP_ORIGIN);
      return;
    }

    const nextVaultAddress = address ?? vaultAddress;
    if (address) setSelectedVaultAddress(address);
    const otfSlug = nextVaultAddress ?? "unconfigured";
    const nextPath = nextView === "detail"
      ? `/otfs/${otfSlug}`
      : nextView === "created"
        ? `/otfs/${otfSlug}/created`
      : nextView === "manage"
        ? `/otfs/${otfSlug}/manage`
        : nextView === "vaults"
          ? "/"
          : viewPaths[nextView];
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, "", nextPath);
    }
    window.scrollTo({ top: 0, behavior: "auto" });
    setView(nextView);
  }

  function openCreatedVault(address: `0x${string}`, transactionHash: `0x${string}`) {
    setSelectedVaultAddress(address);
    setCreatedTxHash(transactionHash);
    window.history.pushState({}, "", `/otfs/${address}/created?tx=${transactionHash}`);
    window.scrollTo({ top: 0, behavior: "auto" });
    setView("created");
  }

  function changeView(tab: string) {
    if (tab === "Verified") openView("verified");
    else if (tab === "Liquidity") window.location.assign("/liquidity");
    else openView("vaults");
  }

  if (view === "landing") {
    return (
      <LandingPage
        onCreate={() => window.location.assign(`${APP_ORIGIN}/create`)}
        onEnter={() => window.location.assign(APP_ORIGIN)}
      />
    );
  }

  return (
    <div className="otfAppShell">
      <TopNav
        activeTab={activeTab}
        depositsActive={view === "deposits"}
        onHome={() => openView("vaults")}
        onTabChange={changeView}
        onOpenDeposits={() => openView("deposits")}
      />

      <main className="dashboardMain">
        {isTestnet && !factoryAddress ? (
          <div className="validationSummary danger factoryAddressWarning" role="alert">
            <AlertTriangle size={15} />
            <div>
              <strong>Factory address missing</strong>
              <span>The deployment manifest does not contain a valid factory address. Contract writes are disabled until a factory is configured.</span>
            </div>
          </div>
        ) : null}
        {view === "detail" && isTestnet && vault.dataMode === "live" ? (
          <>
            <VaultHeader
              vault={vault}
              canManage={vault.connectedIsManager}
              pricingVerified={vaultPricingVerified}
              onBack={() => openView("vaults")}
              onManage={() => openView("manage")}
            />
            <DataProvenance vault={vault} />
            <SunsetStatusBanner vault={vault} />
            <VaultMetrics vault={vault} />

            <div className="dashboardGrid">
              <div className="primaryColumn">
                <PortfolioAllocation
                  vault={vault}
                  allocations={allocations}
                  oraclePrices={vaultOraclePrices}
                  pinnedPricingConfigs={pinnedPricing.configs}
                  pricingConfigsLoading={pinnedPricing.isLoading}
                  onRefresh={refetchVaultData}
                />
                <UserActions vault={vault} />
              </div>

              <aside className="sideColumn">
                <StrategyHistoryModule vault={vault} />
                <RebalanceCooldown vault={vault} />
              </aside>

              <div className="dashboardSafety">
                <SafetyLimits vault={vault} />
              </div>
            </div>
            <RebalanceHistoryPanel vault={vault} />
          </>
        ) : null}

        {view === "detail" && isTestnet && vault.dataMode !== "live" ? (
          <UnconfiguredOtfView
            isLoading={vault.isLoading}
            onBack={() => openView("vaults")}
          />
        ) : null}

        {view === "vaults" ? (
          <VaultsDirectory
            currentVault={vault}
            vaults={vaultSummaries}
            isTestnet={isTestnet}
            aumLoading={factoryLoading || directoryLoading}
            onOpenVault={(address) => openView("detail", address)}
          />
        ) : null}

        {view === "create" ? (
          <CreateVaultView
            connectedAddress={connectedAddress}
            isTestnet={isTestnet}
            onBack={() => openView("vaults")}
            onCreated={openCreatedVault}
          />
        ) : null}

        {view === "created" && vaultAddress ? (
          <CreatedVaultView
            vault={vault}
            transactionHash={createdTxHash}
            onCreateAnother={() => openView("create")}
            onManage={() => openView("manage", vaultAddress)}
            onView={() => openView("detail", vaultAddress)}
          />
        ) : null}

        {view === "manage" && isTestnet && vault.dataMode === "live" ? (
          <ManageVaultsView
            vault={vault}
            oraclePrices={vaultOraclePrices}
            onBack={() => openView("vaults")}
            onOpenVault={() => openView("detail")}
            onRefresh={refetchVaultData}
          />
        ) : null}

        {view === "manage" && isTestnet && vault.dataMode !== "live" ? (
          <UnconfiguredOtfView
            isLoading={vault.isLoading}
            onBack={() => openView("vaults")}
          />
        ) : null}

        {view === "deposits" ? (
          <WalletView
            connectedAddress={connectedAddress}
            vaults={vaultSummaries}
            isTestnet={isTestnet}
            onBrowseVaults={() => openView("vaults")}
            onOpenVault={(address) => openView("detail", address)}
            onCreateVault={() => openView("create")}
          />
        ) : null}

        {view === "verified" ? (
          <VerifiedAssetsView isTestnet={isTestnet} oraclePrices={catalogOraclePrices} />
        ) : null}

        <footer className="dashboardFooter">
          <span>Onchain Traded Funds · experimental, unaudited software</span>
          <div className="footerLinks">
          <a href="/docs" target="_blank" rel="noreferrer">
              Docs
              <ExternalLink size={12} />
            </a>
            <a href="https://github.com/han1ue/onchaintradedfunds" target="_blank" rel="noreferrer">
              GitHub
              <ExternalLink size={12} />
            </a>
          </div>
        </footer>
      </main>
    </div>
  );
}

export function TopNav({
  activeTab,
  depositsActive,
  onHome,
  onTabChange,
  onOpenDeposits,
}: {
  activeTab: string;
  depositsActive: boolean;
  onHome: () => void;
  onTabChange: (tab: string) => void;
  onOpenDeposits: () => void;
}) {
  const [networkOpen, setNetworkOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<AppearancePreference>("default");
  const [palette, setPalette] = useState<"default" | "robinhood">("default");
  const chainId = useChainId();
  const testnetMode = chainId === robinhoodChainTestnet.id;
  const { switchChain, isPending: networkSwitchPending } = useSwitchChain();
  const networkRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("otf-theme");
    const initialTheme: AppearancePreference = savedTheme === "light" || savedTheme === "dark"
      ? savedTheme
      : "default";
    const savedPalette = window.localStorage.getItem("otf-palette");
    const initialPalette = savedPalette === "robinhood" ? "robinhood" : "default";
    setTheme(initialTheme);
    setPalette(initialPalette);
    document.documentElement.dataset.palette = initialPalette;
  }, []);

  useEffect(() => {
    const browserPreference = window.matchMedia("(prefers-color-scheme: light)");

    function applyTheme() {
      document.documentElement.dataset.theme = theme === "default"
        ? browserPreference.matches ? "light" : "dark"
        : theme;
    }

    applyTheme();
    if (theme !== "default") return;
    browserPreference.addEventListener("change", applyTheme);
    return () => browserPreference.removeEventListener("change", applyTheme);
  }, [theme]);

  useEffect(() => {
    if (!networkOpen && !settingsOpen) return;

    function closeOnOutsidePress(event: PointerEvent) {
      const target = event.target as Node;
      if (networkOpen && !networkRef.current?.contains(target)) setNetworkOpen(false);
      if (settingsOpen && !settingsRef.current?.contains(target)) setSettingsOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setNetworkOpen(false);
        setSettingsOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [networkOpen, settingsOpen]);

  function selectRobinhoodNetwork() {
    const nextChainId = testnetMode ? robinhoodChainTestnet.id : robinhoodChain.id;
    if (chainId !== nextChainId) switchChain({ chainId: nextChainId });
    setNetworkOpen(false);
  }

  function toggleTestnetMode() {
    switchChain({ chainId: testnetMode ? robinhoodChain.id : robinhoodChainTestnet.id });
  }

  function changeTheme(nextTheme: AppearancePreference) {
    setTheme(nextTheme);
    window.localStorage.setItem("otf-theme", nextTheme);
  }

  function changePalette(nextPalette: "default" | "robinhood") {
    setPalette(nextPalette);
    document.documentElement.dataset.palette = nextPalette;
    window.localStorage.setItem("otf-palette", nextPalette);
  }

  return (
    <header className="topNav">
      <div className="topNavInner">
        <button className="logoGroup brandHomeButton" type="button" onClick={onHome} title="Back to homepage">
          <OtfBrandMark />
          <div className="brandText">
            <strong>Onchain Traded Funds</strong>
          </div>
        </button>

        <nav className="navTabs" aria-label="Primary navigation">
          {navTabs.map((tab) => (
            <button
              className={!depositsActive && tab === activeTab ? "active" : ""}
              key={tab}
              type="button"
              onClick={() => onTabChange(tab)}
            >
              {tab}
            </button>
          ))}
          <a href="/docs" target="_blank" rel="noreferrer">
            Docs
            <ExternalLink size={12} />
          </a>
        </nav>

        <div className="navActions">
          <button
            className={`depositsButton ${depositsActive ? "active" : ""}`}
            type="button"
            onClick={onOpenDeposits}
            title="Wallet"
          >
            <Wallet size={14} />
            <span>Wallet</span>
          </button>
          <div className="networkControl" ref={networkRef}>
            <button
              className={`networkButton ${networkOpen ? "active" : ""}`}
              type="button"
              title="Robinhood Chain"
              aria-label="Current network: Robinhood Chain. Open networks"
              aria-expanded={networkOpen}
              aria-haspopup="menu"
              onClick={() => {
                setSettingsOpen(false);
                setNetworkOpen((open) => !open);
              }}
            >
              <span className="robinhoodNetworkIcon" aria-hidden="true" />
            </button>
            {networkOpen ? (
              <div className="networkMenu" role="menu" aria-label="Networks">
                <div className="settingsMenuHeader">
                  <strong>Networks</strong>
                  <span>Choose a supported ecosystem</span>
                </div>
                <div className="settingsGroup">
                  <button
                    className="settingsOption selected"
                    type="button"
                    role="menuitemradio"
                    aria-checked={chainId === robinhoodChain.id || testnetMode}
                    disabled={networkSwitchPending}
                    onClick={selectRobinhoodNetwork}
                  >
                    <span className="settingsOptionIcon network">
                      <span className="robinhoodNetworkIcon" aria-hidden="true" />
                    </span>
                    <span className="settingsOptionText">
                      <strong>Robinhood Chain</strong>
                      <small>Selected network</small>
                    </span>
                    <Check className="settingsCheck" size={14} />
                  </button>
                </div>
              </div>
            ) : null}
          </div>
          <div className="settingsControl" ref={settingsRef}>
            <button
              className={`iconOnly ${settingsOpen ? "active" : ""}`}
              type="button"
              title="Settings"
              aria-label="Open settings"
              aria-expanded={settingsOpen}
              aria-haspopup="dialog"
              onClick={() => {
                setNetworkOpen(false);
                setSettingsOpen((open) => !open);
              }}
            >
              <Settings size={16} />
            </button>
            {settingsOpen ? (
              <div className="settingsMenu" role="dialog" aria-label="Application settings">
                <div className="settingsMenuHeader">
                  <strong>Settings</strong>
                </div>
                <div className="settingsGroup">
                  <span className="settingsLabel">Environment</span>
                  <button
                    className="settingsEnvironmentToggle"
                    type="button"
                    aria-pressed={testnetMode}
                    disabled={networkSwitchPending}
                    onClick={toggleTestnetMode}
                  >
                    <span className="settingsOptionIcon"><Zap size={15} /></span>
                    <span className="settingsOptionText">
                      <strong>Testnet mode</strong>
                      <small>Uses the testnet of the currently selected chain.</small>
                    </span>
                    <span className={`themeSwitch ${testnetMode ? "active" : ""}`} aria-hidden="true">
                      <span />
                    </span>
                  </button>
                </div>
                <div className="settingsGroup">
                  <span className="settingsLabel">Appearance</span>
                  <div className="settingsThemeHeading">
                    <span className="settingsOptionIcon"><Sun size={15} /></span>
                    <span className="settingsOptionText">
                      <strong>Mode</strong>
                      <small>Follow your browser or choose a mode</small>
                    </span>
                  </div>
                  <div className="settingsThemeChoices appearance" role="radiogroup" aria-label="Application appearance">
                    {(["default", "light", "dark"] as const).map((value) => (
                      <button
                        className={`settingsThemeChoice ${theme === value ? "selected" : ""}`}
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={theme === value}
                        onClick={() => changeTheme(value)}
                      >
                        {value === "default" ? (
                          <Monitor className="settingsSystemIcon" size={13} aria-hidden="true" />
                        ) : (
                          <span className={`settingsThemeSwatch appearance-${value}`} aria-hidden="true" />
                        )}
                        <span>{value === "default" ? "Browser" : value[0].toUpperCase() + value.slice(1)}</span>
                        {theme === value ? <Check size={12} aria-hidden="true" /> : null}
                      </button>
                    ))}
                  </div>
                  <div className="settingsThemePicker">
                    <div className="settingsThemeHeading">
                      <span className="settingsOptionIcon"><Palette size={15} /></span>
                      <span className="settingsOptionText">
                        <strong>Theme</strong>
                        <small>Choose the application color palette</small>
                      </span>
                    </div>
                    <div className="settingsThemeChoices palette" role="radiogroup" aria-label="Application theme">
                      {(["default", "robinhood"] as const).map((value) => (
                        <button
                          className={`settingsThemeChoice ${palette === value ? "selected" : ""}`}
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={palette === value}
                          onClick={() => changePalette(value)}
                        >
                          <span className={`settingsThemeSwatch ${value}`} aria-hidden="true" />
                          <span>{value === "default" ? "Default" : "Robinhood"}</span>
                          {palette === value ? <Check size={13} aria-hidden="true" /> : null}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}

export function WalletConnectionAction() {
  const { disconnect } = useDisconnect();

  return (
    <ConnectButton.Custom>
      {({
        account,
        mounted,
        authenticationStatus,
        openConnectModal,
      }) => {
        const ready = mounted && authenticationStatus !== "loading";
        const connected =
          ready &&
          account &&
          (!authenticationStatus || authenticationStatus === "authenticated");

        if (!ready) return <button className="secondaryAction" type="button" disabled>Loading wallet</button>;
        if (!connected) {
          return (
            <button className="primaryAction" type="button" onClick={openConnectModal}>
              <Wallet size={14} />
              Connect wallet
            </button>
          );
        }
        return (
          <button className="secondaryAction walletDisconnectAction" type="button" onClick={() => disconnect()}>
            <XCircle size={14} />
            Disconnect
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}

function VaultHeader({
  vault,
  canManage,
  pricingVerified,
  onBack,
  onManage,
}: {
  vault: VaultView;
  canManage: boolean;
  pricingVerified?: boolean;
  onBack: () => void;
  onManage: () => void;
}) {
  const testnetCreateAssets = useVerifiedAssetCatalog();
  const [copied, setCopied] = useState<string | null>(null);
  const verified = vault.allocations.length > 0
    && vault.allocations.every((asset) => assetIsVerifiedForAddress(testnetCreateAssets, asset.address));

  async function copy(value: string | undefined, key: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1_500);
    } catch {
      setCopied(null);
    }
  }

  return (
    <>
      <div className="vaultBreadcrumb detailBreadcrumb">
        <button type="button" onClick={onBack}>
          <ArrowLeft size={12} />
          OTFs
        </button>
        <span>/</span>
        <strong>{vault.name}</strong>
      </div>

      <section className="vaultHeader">
        <div className="vaultTitleRow">
          <div className="vaultIdentity">
            <OtfTokenIcon className="vaultMonogram" size={46} ticker={vault.symbol} />
            <div>
              <div className="titleLine">
                <h1>{vault.name}</h1>
                {vault.sunset ? <span className="stateBadge danger">Sunset</span> : null}
                <span className={`stateBadge ${verified ? "success" : "warning"}`}>
                  {verified ? "Verified assets" : "Unverified assets"}
                </span>
                <span className={`stateBadge ${pricingVerified === undefined ? "muted" : pricingVerified ? "success" : "warning"}`}>
                  {pricingVerified === undefined ? "Checking pricing" : pricingVerified ? "Verified pricing" : "Unverified pricing"}
                </span>
              </div>
              <div className="addressLine">
                <AddressPill label="OTF" address={vault.address} copied={copied === "vault"} onCopy={() => copy(vault.address, "vault")} />
                <AddressPill label="Manager" address={vault.manager} copied={copied === "manager"} onCopy={() => copy(vault.manager, "manager")} />
              </div>
            </div>
          </div>
          {canManage ? (
            <button className="primaryAction vaultManageAction" type="button" onClick={onManage}>
              <UserCog size={14} />
              Manage OTF
            </button>
          ) : null}
        </div>
      </section>
    </>
  );
}

function VaultMetrics({ vault }: { vault: VaultView }) {
  const marketPairs = useMemo<V3TokenPair[]>(
    () => vault.address
      ? robinhoodTestnetMarketAssets.map((asset) => ({ tokenA: vault.address!, tokenB: asset.token }))
      : [],
    [vault.address],
  );
  const { pools: discoveredMarkets, isLoading: marketsLoading } = useDiscoveredV3Pools(
    marketPairs,
    Boolean(vault.address),
  );
  const marketCount = robinhoodTestnetMarketAssets.filter((asset) => (
    vault.address && selectV3Pool(discoveredMarkets, vault.address, asset.token)
  )).length;
  const poolVenueUrl = vault.address ? `/liquidity?vault=${vault.address}` : undefined;
  const portfolioState = vault.sunset
    ? "Sunset"
    : vault.challengeActive
      ? "Challenge active"
      : vault.strategicRebalanceActive
        ? "Target in progress"
        : vault.withinCompletionBands
          ? "Within bands"
          : "Outside completion";
  return (
    <div className="metricGrid">
      <MetricCard label="NAV" value={vault.nav ?? "Oracle read failed"} tone={vault.nav ? "success" : "neutral"} />
      <MetricCard
        label="NAV / Share"
        value={vault.navPerShare ?? "Oracle read failed"}
        helpText="This dollar value is the OTF's current onchain NAV per share: constituent balances valued in USD using each asset's configured pricing route. It is not a redemption quote. Routed or proportional redemption value can differ because of market movement, pool liquidity, fees, and slippage."
      />
      <MetricCard label="Manager Fee" value={`${bpsToPercent(vault.managerFeeBps)} / yr`} tone={vault.feeState === 2 ? "danger" : vault.feeState === 1 ? "warning" : "neutral"} />
      <MetricCard
        label="Liquidity Markets"
        value={marketsLoading ? "Resolving..." : `${marketCount} found`}
        href={poolVenueUrl}
        external={false}
        linkLabel="View or create supported OTF markets"
      />
      <MetricCard label="Portfolio Status" value={portfolioState} tone={vault.sunset || vault.challengeActive ? "danger" : vault.withinCompletionBands ? "success" : "warning"} />
      <MetricCard label="Total Shares" value={vault.totalSupply} />
    </div>
  );
}

function useLiveCountdown(deadline?: number) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1_000));
  useEffect(() => {
    if (!deadline) return;
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1_000)), 1_000);
    return () => window.clearInterval(timer);
  }, [deadline]);
  return deadline ? Math.max(0, deadline - now) : 0;
}

function ChallengeCountdownBanner({ vault }: { vault: VaultView }) {
  const remaining = useLiveCountdown(vault.challengeDeadline);
  if (!vault.challengeActive) return null;
  const progress = vault.challengeGracePeriod > 0
    ? Math.max(0, Math.min(100, ((vault.challengeGracePeriod - remaining) / vault.challengeGracePeriod) * 100))
    : 0;
  const expired = remaining === 0;
  return (
    <div className={`challengeCountdownBanner ${expired ? "danger" : "warning"}`} role="alert">
      <div className="challengeCountdownHeading">
        <span><AlertTriangle size={16} /><strong>{expired ? "Strategy challenge deadline passed" : "Strategy challenge active"}</strong></span>
        <strong>{expired ? "Expired" : `Time remaining: ${formatCooldown(remaining)}`}</strong>
      </div>
      <div className="challengeCountdownTrack" aria-label={`${progress.toFixed(0)}% of challenge response period elapsed, ${formatCooldown(remaining)} remaining`}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <p>{expired ? "Manager fees from the missed challenge window are forfeitable; 50% becomes the caller reward and the rest is never minted." : "The manager cannot withdraw fees until the portfolio returns to its completion band."}</p>
    </div>
  );
}

function SunsetStatusBanner({ vault }: { vault: VaultView }) {
  if (!vault.sunset) return null;
  return (
    <div className="riskCallout danger sunsetStatusBanner" role="status">
      <Sun size={16} />
      <div>
        <strong>This OTF has been sunset</strong>
        <span>
          Deposits, new fees, challenges, and portfolio changes are permanently disabled
          {vault.sunsetAt ? ` since ${formatTimestamp(vault.sunsetAt)}` : ""}. Share transfers and proportional redemptions remain available for the wind-down.
        </span>
      </div>
    </div>
  );
}

function AddressPill({
  label,
  address,
  copied,
  onCopy,
}: {
  label: string;
  address?: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <span className={`addressPill ${copied ? "copied" : ""}`}>
      <span>{label}</span>
      <strong>{shortAddress(address)}</strong>
      <button type="button" onClick={onCopy} title={copied ? "Copied" : `Copy ${label.toLowerCase()} address`}>
        {copied ? <CheckCircle size={13} /> : <Copy size={13} />}
      </button>
      {copied ? <span className="copyFeedback" role="status" aria-live="polite">Copied</span> : null}
      {address ? (
        <a
          href={`${robinhoodChainTestnet.blockExplorers.default.url}/address/${address}`}
          target="_blank"
          rel="noreferrer"
          title={`Open ${label.toLowerCase()} in explorer`}
        >
          <ExternalLink size={13} />
        </a>
      ) : null}
    </span>
  );
}

function DataProvenance({ vault, factory = false }: { vault: VaultView; factory?: boolean }) {
  if (factory) {
    const hasFactory = Boolean(vault.factoryAddress);
    if (hasFactory && !vault.factoryReadFailed) return null;
    return (
      <div className={`provenanceBanner ${vault.dataMode}`} role="status">
        <span className={`stateBadge ${hasFactory && !vault.factoryReadFailed ? "success" : "muted"}`}>
          {vault.factoryReadFailed
            ? "OTFs unavailable"
            : hasFactory
              ? `${vault.factoryVaultCount} OTF${vault.factoryVaultCount === 1 ? "" : "s"}`
              : "Protocol unavailable"}
        </span>
        <div>
          <strong>
            {vault.factoryReadFailed
              ? "OTFs could not be loaded from Robinhood Testnet."
              : hasFactory
                ? "The protocol connection is unavailable."
                : "The Robinhood Testnet deployment is not configured."}
          </strong>
          <span>
            {hasFactory
              ? "Retry after confirming the network is available."
              : "OTFs will appear here when the deployment is connected."}
          </span>
        </div>
      </div>
    );
  }

  const isLive = vault.dataMode === "live";
  const isEmpty = vault.dataMode === "empty";
  const label = isLive
    ? vault.readFailed ? "Last successful contract data" : "Live contract data"
    : isEmpty && vault.factoryReadFailed
      ? "OTF data unavailable"
      : isEmpty && vault.factoryAddress
        ? `${vault.factoryVaultCount} OTF${vault.factoryVaultCount === 1 ? "" : "s"}`
        : isEmpty
          ? "Protocol unavailable"
          : "Network unavailable";
  const tone = isLive ? vault.readFailed ? "warning" : "success" : "muted";

  return (
    <div className={`provenanceBanner ${vault.dataMode}`} role="status">
      <span className={`stateBadge ${tone}`}>{label}</span>
      <div>
        <strong>
          {isLive
            ? vault.readFailed
              ? "The latest refresh failed, so the last successful contract values remain visible."
              : "Values are being read from Robinhood Chain Testnet."
            : isEmpty
              ? vault.factoryReadFailed
                ? "OTF data could not be loaded from Robinhood Chain Testnet."
                : vault.factoryAddress
                  ? "No OTF data was returned by the protocol."
                  : "The Robinhood Testnet deployment is not configured."
              : "Robinhood Chain Mainnet has no supported OTF deployment."}
        </strong>
        <span>
          {isLive
            ? `Block ${vault.blockNumber?.toLocaleString() ?? "loading"}${vault.lastReadAt ? ` · refreshed ${formatTimestamp(vault.lastReadAt)}` : ""}`
            : isEmpty
              ? vault.factoryAddress
                ? `${vault.factoryVaultCount} OTF${vault.factoryVaultCount === 1 ? "" : "s"} found`
                : "OTFs will appear when the deployment is connected."
              : "Switch to Robinhood Chain Testnet to use the MVP."}
        </span>
      </div>
      {isLive && vault.address ? (
        <a
          href={`${robinhoodChainTestnet.blockExplorers.default.url}/address/${vault.address}`}
          target="_blank"
          rel="noreferrer"
        >
          Verify contract
          <ExternalLink size={13} />
        </a>
      ) : null}
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon,
  action,
  tone = "neutral",
  sub,
  href,
  linkLabel,
  external = false,
  helpText,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
  action?: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
  sub?: string;
  href?: string;
  linkLabel?: string;
  external?: boolean;
  helpText?: string;
}) {
  return (
    <div className={`metricCard ${tone}${action ? " hasMetricAction" : ""}`}>
      <div className="metricLabel">
        <span>{label}</span>
        {action ?? icon ?? null}
      </div>
      {href ? (
        <a className="metricCardValueLink" href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined} aria-label={linkLabel}>
          <strong>{value}</strong>
          {external ? <ExternalLink size={12} /> : <ArrowRight size={12} />}
        </a>
      ) : helpText ? <div className="metricValueWithHelp"><strong>{value}</strong><ValueHelp text={helpText} /></div> : <strong>{value}</strong>}
      {sub ? <span>{sub}</span> : null}
    </div>
  );
}

function ValueHelp({ text }: { text: string }) {
  const tooltipId = useId();
  return (
    <span className="valueHelp" onClick={(event) => event.stopPropagation()}>
      <button type="button" title={text} aria-label="How this dollar value is calculated" aria-describedby={tooltipId}>
        <CircleHelp size={14} aria-hidden="true" />
      </button>
      <span className="valueHelpTooltip" id={tooltipId} role="tooltip">{text}</span>
    </span>
  );
}

function PriceSourceAddress({ address, label }: { address: string; label: string }) {
  return (
    <a
      className="priceSourceAddress"
      href={`${robinhoodChainTestnet.blockExplorers.default.url}/address/${address}`}
      target="_blank"
      rel="noreferrer"
      title={`Open ${label.toLowerCase()} ${address}`}
    >
      {shortAssetAddress(address)}
      <ExternalLink size={11} aria-hidden="true" />
    </a>
  );
}

function PriceSourcePill({ config, assetSymbol }: { config: ApprovedPricingConfig; assetSymbol: string }) {
  const detailsId = useId();
  const label = config.source === "chainlink-robinhood"
    ? "Chainlink Robinhood"
    : config.source === "chainlink"
      ? "Chainlink"
      : config.source === "chainlink-composed"
        ? "Chainlink Composed"
        : "Uniswap V3 TWAP";

  return (
    <div className="priceSourcePill">
      <button
        type="button"
        className="priceSourceTrigger"
        aria-label={`${label} price source details for ${assetSymbol}`}
        aria-describedby={detailsId}
        onPointerDown={(event) => event.preventDefault()}
      >
        {label}
      </button>
      <div className="priceSourcePopover" id={detailsId}>
        <strong>{label}</strong>
        {"feedAddress" in config ? (
          <dl>
            <div><dt>Price feed</dt><dd><PriceSourceAddress address={config.feedAddress} label="Price feed" /></dd></div>
            <div><dt>Maximum price age</dt><dd>{formatCooldown(config.maxStaleness)}</dd></div>
          </dl>
        ) : "assetQuoteFeedAddress" in config ? (
          <dl>
            <div><dt>Asset / quote feed</dt><dd><PriceSourceAddress address={config.assetQuoteFeedAddress} label="Asset quote feed" /></dd></div>
            <div><dt>Maximum feed age</dt><dd>{formatCooldown(config.assetQuoteMaxStaleness)}</dd></div>
            <div><dt>Quote token</dt><dd><PriceSourceAddress address={config.quoteToken} label="Quote token" /></dd></div>
            <div><dt>Quote / USD feed</dt><dd><PriceSourceAddress address={config.quoteUsdFeedAddress} label="Quote USD feed" /></dd></div>
            <div><dt>Maximum quote age</dt><dd>{formatCooldown(config.quoteUsdMaxStaleness)}</dd></div>
          </dl>
        ) : (
          <dl>
            <div><dt>TWAP pool</dt><dd><PriceSourceAddress address={config.poolAddress} label="TWAP pool" /></dd></div>
            <div><dt>TWAP window</dt><dd>1 hour</dd></div>
            <div><dt>Maximum price age</dt><dd>{formatCooldown(config.maxStaleness)}</dd></div>
            <div><dt>Quote token</dt><dd><PriceSourceAddress address={config.quoteToken} label="Quote token" /></dd></div>
            <div><dt>Quote / USD feed</dt><dd><PriceSourceAddress address={config.quoteUsdFeedAddress} label="Quote USD feed" /></dd></div>
            <div><dt>Maximum quote age</dt><dd>{formatCooldown(config.quoteUsdMaxStaleness)}</dd></div>
          </dl>
        )}
      </div>
    </div>
  );
}

function SectionCard({
  title,
  subtitle,
  icon,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="sectionCard">
      <div className="sectionTitle">
        <div className="sectionHeading">
          <div className="sectionTitleLine">
            {icon}
            <h2>{title}</h2>
          </div>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {action}
      </div>
      <div className="sectionBody">{children}</div>
    </section>
  );
}

function RebalanceCooldown({ vault }: { vault: VaultView }) {
  const isLive = vault.dataMode === "live";
  const portfolioCooldownRemaining = useLiveCountdown(vault.nextStrategyChange);
  const portfolioCooldownComplete = isLive && portfolioCooldownRemaining === 0;
  const proposalAvailable = isLive && vault.canProposeStrategy;
  const lifecycleStage = !isLive
    ? "Live data required"
    : vault.sunset
      ? "Sunset"
      : vault.challengeActive
        ? "Challenge active"
        : vault.strategyProposalPending
          ? "Activation pending"
          : vault.strategicRebalanceActive
            ? "Rebalancing"
            : proposalAvailable
              ? "Ready for proposal"
              : portfolioCooldownComplete
                ? "Portfolio state blocked"
                : "Cooling down";
  const lifecycleTone = !isLive
    ? "muted"
    : vault.sunset || vault.challengeActive
      ? "danger"
      : proposalAvailable
        ? "success"
        : "warning";
  return (
    <SectionCard
      title="Strategy lifecycle"
      subtitle="Current stage and next strategy-change window"
      icon={<Clock3 size={15} />}
      action={<span className={`stateBadge ${lifecycleTone}`}>{lifecycleStage}</span>}
    >
      <div className="cooldownStats">
        <TimelineItem label="Current stage" value={lifecycleStage} icon={<Activity size={13} />} />
        <TimelineItem label="Cooldown length" value={vault.isLoading ? "Loading" : formatCooldown(vault.cooldownSeconds)} icon={<LockKeyhole size={13} />} />
        <TimelineItem label="Strategy baseline" value={isLive ? formatTimestamp(vault.lastStrategyCompletion) : "Not available"} icon={<Clock3 size={13} />} />
        <TimelineItem label="Cooldown ends" value={isLive ? (portfolioCooldownComplete ? "Complete" : formatTimestamp(vault.nextStrategyChange)) : "Not available"} icon={<Activity size={13} />} />
      </div>

      {isLive ? <div className="progressBlock">
        <div className="progressMeta">
          <span>Cooldown progress</span>
          <strong>{formatRelativeAvailability(vault.nextStrategyChange)}</strong>
        </div>
        <div className="progressTrack">
          <span style={{ width: `${vault.cooldownProgress}%` }} />
          <i style={{ left: `calc(${vault.cooldownProgress}% - 5px)` }} />
        </div>
        <div className="progressDates">
          <span>{formatTimestamp(vault.lastStrategyCompletion)}</span>
          <span>{formatTimestamp(vault.nextStrategyChange)}</span>
        </div>
      </div> : null}

      <div className="cardFooterAction">
        <span className="mutedInline">
          <Info size={14} />
          {isLive
            ? proposalAvailable
              ? "The cooldown is complete and the portfolio is in bounds with no active challenge. A proposal still receives a 48-hour notice window."
              : portfolioCooldownComplete
                ? "The cooldown is complete, but a challenge, pending strategy, active rebalance, or out-of-band portfolio still blocks proposals."
                : "The initial strategy starts this timer at deployment; later successful rebalances restart it. Being in-band never shortens it."
            : "Connect a deployed OTF to read the portfolio-change schedule."}
        </span>
      </div>
    </SectionCard>
  );
}

function TimelineItem({
  label,
  value,
  icon,
  highlight,
  status,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  highlight?: boolean;
  status?: "locked" | "open";
}) {
  return (
    <div className={`timelineItem ${highlight ? "highlight" : ""} ${status ?? ""}`}>
      <span>
        {icon}
        {label}
      </span>
      <strong>{value}</strong>
    </div>
  );
}

function formatPricingDuration(seconds: number): string {
  if (seconds % 86_400 === 0) return `${seconds / 86_400} day${seconds === 86_400 ? "" : "s"}`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600} hour${seconds === 3_600 ? "" : "s"}`;
  if (seconds % 60 === 0) return `${seconds / 60} minute${seconds === 60 ? "" : "s"}`;
  return `${seconds} seconds`;
}

function PriceSourceLink({ address, label }: { address: string; label: string }) {
  return (
    <a
      href={`${robinhoodChainTestnet.blockExplorers.default.url}/address/${address}`}
      target="_blank"
      rel="noreferrer"
      title={`Open ${label.toLowerCase()} in explorer`}
    >
      {shortAddress(address)} <ExternalLink size={11} />
    </a>
  );
}

function PriceDetailsModal({
  asset,
  price,
  config,
  verified,
  onClose,
}: {
  asset: Allocation;
  price: CatalogOraclePrice | undefined;
  config: AssetPricingConfig | undefined;
  verified: boolean;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const primaryIsChainlink = Boolean(config && config.source !== 2);
  const hasSecondary = Boolean(config && (config.source === 1 || config.source === 2));
  const { data: primaryResults } = useReadContracts({
    contracts: primaryIsChainlink && config ? [
      { address: config.primarySource, abi: aggregatorV3ReadAbi, functionName: "latestRoundData" as const, chainId: robinhoodChainTestnet.id },
      { address: config.primarySource, abi: aggregatorV3ReadAbi, functionName: "decimals" as const, chainId: robinhoodChainTestnet.id },
    ] : [],
    query: { enabled: primaryIsChainlink },
  });
  const { data: secondaryResults } = useReadContracts({
    contracts: hasSecondary && config ? [
      { address: config.secondarySource, abi: aggregatorV3ReadAbi, functionName: "latestRoundData" as const, chainId: robinhoodChainTestnet.id },
      { address: config.secondarySource, abi: aggregatorV3ReadAbi, functionName: "decimals" as const, chainId: robinhoodChainTestnet.id },
    ] : [],
    query: { enabled: hasSecondary },
  });
  const { data: poolResults } = useReadContracts({
    contracts: config?.source === 2 ? [
      { address: config.primarySource, abi: uniswapV3PoolDiscoveryAbi, functionName: "token0" as const, chainId: robinhoodChainTestnet.id },
      { address: config.primarySource, abi: uniswapV3PoolDiscoveryAbi, functionName: "token1" as const, chainId: robinhoodChainTestnet.id },
      { address: config.primarySource, abi: uniswapV3PoolDiscoveryAbi, functionName: "fee" as const, chainId: robinhoodChainTestnet.id },
    ] : [],
    query: { enabled: config?.source === 2 },
  });

  useEffect(() => {
    closeButtonRef.current?.focus();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  function feedReading(results: typeof primaryResults): { value: string; updated: string } | undefined {
    const round = results?.[0]?.status === "success"
      ? results[0].result as readonly [bigint, bigint, bigint, bigint, bigint]
      : undefined;
    const decimals = results?.[1]?.status === "success" ? results[1].result : undefined;
    if (!round || typeof decimals !== "number" || round[1] <= 0n) return undefined;
    return {
      value: Number(formatUnits(round[1], decimals)).toLocaleString(undefined, { maximumFractionDigits: 8 }),
      updated: round[3] > 0n ? formatTimestamp(Number(round[3])) : "No update timestamp",
    };
  }

  const primaryReading = feedReading(primaryResults);
  const secondaryReading = feedReading(secondaryResults);
  const poolToken0 = poolResults?.[0]?.status === "success" ? poolResults[0].result : undefined;
  const poolToken1 = poolResults?.[1]?.status === "success" ? poolResults[1].result : undefined;
  const poolFee = poolResults?.[2]?.status === "success" ? Number(poolResults[2].result) : undefined;
  const quoteLabel = config && config.quoteToken !== zeroAddress
    ? quoteTokenLabel(config.quoteToken)
    : "quote token";
  const formula = !config
    ? "Pricing configuration unavailable"
    : config.source === 0 || config.source === 3
      ? `${asset.symbol}/USD ${config.source === 3 ? "Robinhood" : "Chainlink"} answer`
      : config.source === 1
        ? `${asset.symbol}/${quoteLabel} Chainlink answer × ${quoteLabel}/USD Chainlink answer`
        : `${asset.symbol}/${quoteLabel} 1-hour Uniswap V3 TWAP × ${quoteLabel}/USD Chainlink answer`;

  return (
    <div className="priceDetailsBackdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section
        className="priceDetailsModal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="price-details-title"
        aria-describedby="price-details-description"
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
            "button:not([disabled]), a[href]",
          ));
          const first = focusable.at(0);
          const last = focusable.at(-1);
          if (!first || !last) return;
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <header className="priceDetailsHeader">
          <AssetLogo logoUrl={asset.logoUrl} symbol={asset.symbol} />
          <div>
            <h2 id="price-details-title">How {asset.symbol} is priced</h2>
            <p id="price-details-description">The OTF pins the asset feed or V3 pool and uses the quote token’s current admin-managed USD feed.</p>
          </div>
          <button ref={closeButtonRef} className="sunsetDialogClose" type="button" aria-label="Close price details" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="priceCalculationSummary">
          <div>
            <span>Current normalized price</span>
            <strong>{price?.display ?? "Unavailable"}</strong>
            <small>{price?.updatedAt ? `Latest underlying update ${formatTimestamp(Number(price.updatedAt))}` : "Runtime oracle data is unavailable."}</small>
          </div>
          <span className={`stateBadge ${price?.value !== undefined ? "success" : "danger"}`}>
            {price?.value !== undefined ? "Runtime healthy" : "Runtime unavailable"}
          </span>
        </div>

        <div className="priceFormula" aria-label="Price calculation formula">
          <span>Calculation</span>
          <strong>{formula}</strong>
          <small>The final result is normalized to USD. There is no automatic fallback source.</small>
        </div>

        {config ? (
          <div className="priceDetailsSections">
            <section>
              <h3>Pricing route</h3>
              <dl className="priceDetailsList">
                <div><dt>Route</dt><dd>{pricingSourceLabel(config.source)}</dd></div>
                {config.quoteToken !== zeroAddress ? <div><dt>Quote token</dt><dd>{quoteLabel} · <PriceSourceLink address={config.quoteToken} label="Quote token" /></dd></div> : null}
                <div><dt>{config.source === 2 ? "Pricing pool" : config.source === 1 ? "Asset/quote feed" : "Asset/USD feed"}</dt><dd><PriceSourceLink address={config.primarySource} label="Primary pricing source" /></dd></div>
                {hasSecondary ? <div><dt>Quote/USD feed</dt><dd><PriceSourceLink address={config.secondarySource} label="Quote USD feed" /></dd></div> : null}
                {config.source === 2 && poolToken0 && poolToken1 ? <div><dt>Pool pair</dt><dd><PriceSourceLink address={poolToken0} label="Pool token 0" /> / <PriceSourceLink address={poolToken1} label="Pool token 1" /></dd></div> : null}
                {config.source === 2 ? <div><dt>Pool fee</dt><dd>{poolFee !== undefined ? `${(poolFee / 10_000).toFixed(2)}% (${poolFee})` : "Loading"}</dd></div> : null}
                {config.source === 2 ? <div><dt>TWAP window</dt><dd>1 hour of pool observations</dd></div> : null}
              </dl>
            </section>

            <section>
              <h3>Validation</h3>
              <dl className="priceDetailsList">
                <div><dt>Configuration</dt><dd><span className={`stateBadge ${verified ? "success" : "warning"}`}>{verified ? "Verified" : "Unverified"}</span></dd></div>
                <div><dt>Primary rule</dt><dd>{config.source === 2 ? "Canonical V3 factory, exact pair and fee, initialized pool, ≥64 observations, full TWAP history" : config.source === 3 ? "Full Chainlink round validation plus oracle-level pause status" : "Full Chainlink round validation"}</dd></div>
                <div><dt>Primary freshness</dt><dd>{formatPricingDuration(config.primaryMaxStaleness)}</dd></div>
                {hasSecondary ? <div><dt>Quote/USD rule</dt><dd>Full Chainlink round validation</dd></div> : null}
                {hasSecondary ? <div><dt>Quote/USD freshness</dt><dd>{formatPricingDuration(config.secondaryMaxStaleness)}</dd></div> : null}
              </dl>
            </section>

            {primaryIsChainlink || hasSecondary ? (
              <section>
                <h3>Current Chainlink legs</h3>
                <dl className="priceDetailsList">
                  {primaryIsChainlink ? <div><dt>{config.source === 1 ? `${asset.symbol}/${quoteLabel}` : `${asset.symbol}/USD`}</dt><dd>{primaryReading ? `${primaryReading.value} · ${primaryReading.updated}` : "Reading unavailable"}</dd></div> : null}
                  {hasSecondary ? <div><dt>{quoteLabel}/USD</dt><dd>{secondaryReading ? `${secondaryReading.value} · ${secondaryReading.updated}` : "Reading unavailable"}</dd></div> : null}
                </dl>
              </section>
            ) : null}
          </div>
        ) : (
          <div className="validationSummary warning" role="status"><AlertTriangle size={15} /><div><strong>Pinned configuration unavailable</strong><span>Refresh the OTF data to inspect its pricing route.</span></div></div>
        )}

        <p className="priceDetailsFootnote">Verified means the pinned identity matches the frontend manifest. Runtime healthy means the current onchain read succeeded. These are separate checks.</p>
      </section>
    </div>
  );
}

function PortfolioAllocation({
  vault,
  allocations,
  oraclePrices,
  pinnedPricingConfigs,
  pricingConfigsLoading,
  onRefresh,
}: {
  vault: VaultView;
  allocations: Allocation[];
  oraclePrices: CatalogOraclePrices;
  pinnedPricingConfigs: Record<string, AssetPricingConfig | undefined>;
  pricingConfigsLoading: boolean;
  onRefresh: () => Promise<unknown>;
}) {
  const [selectedPriceAsset, setSelectedPriceAsset] = useState<Allocation>();
  const priceTriggerRef = useRef<HTMLButtonElement | null>(null);
  const holdingContracts = vault.address && allocations.length
    ? allocations.flatMap((asset) => ([
        {
          address: asset.address as `0x${string}`,
          abi: erc20BalanceAbi,
          functionName: "balanceOf" as const,
          args: [vault.address as `0x${string}`],
          chainId: robinhoodChainTestnet.id,
        },
        {
          address: asset.address as `0x${string}`,
          abi: erc20BalanceAbi,
          functionName: "decimals" as const,
          chainId: robinhoodChainTestnet.id,
        },
      ] as const))
    : undefined;
  const {
    data: holdingResults,
    isLoading: holdingsLoading,
  } = useReadContracts({
    contracts: holdingContracts,
    query: {
      enabled: Boolean(holdingContracts),
      refetchInterval: 12_000,
      refetchOnWindowFocus: true,
    },
  });

  const closePriceDetails = useCallback(() => {
    setSelectedPriceAsset(undefined);
    window.setTimeout(() => priceTriggerRef.current?.focus(), 0);
  }, []);

  return (
    <>
    {selectedPriceAsset ? (
      <PriceDetailsModal
        asset={selectedPriceAsset}
        price={oraclePrices[selectedPriceAsset.address.toLowerCase()]}
        config={pinnedPricingConfigs[selectedPriceAsset.address.toLowerCase()]}
        verified={Boolean(pinnedPricingConfigs[selectedPriceAsset.address.toLowerCase()] && isVerifiedPricingConfig(
          robinhoodChainTestnet.id,
          selectedPriceAsset.address,
          pinnedPricingConfigs[selectedPriceAsset.address.toLowerCase()]!,
        ))}
        onClose={closePriceDetails}
      />
    ) : null}
    <SectionCard
      title="Portfolio allocation"
      subtitle="Token holdings and target vs actual weights"
      icon={<ChartPie size={15} />}
      action={<span className="stateBadge muted">{allocations.length} assets</span>}
    >
      <div className="allocationBar">
        {allocations.map((asset) => (
          <span
            className={`allocationSegment ${asset.tone}`}
            key={asset.address}
            style={{ width: `${Math.max(asset.actualWeightBps / 100, 1)}%` }}
            title={`${asset.name}: ${bpsToAllocationPercent(asset.actualWeightBps)}`}
          />
        ))}
      </div>

      <div className="allocationLegend">
        {allocations.map((asset) => (
          <span className="legendItem" key={asset.address}>
            <span className={`legendSwatch ${asset.tone}`} />
            <span>{asset.symbol}</span>
            <strong>{bpsToAllocationPercent(asset.actualWeightBps)}</strong>
          </span>
        ))}
      </div>

      <div className="assetTableWrap">
        <table className="assetTable">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Amount held</th>
              <th>Price</th>
              <th>Pricing</th>
              <th>Target</th>
              <th>Actual</th>
              <th>Drift</th>
            </tr>
          </thead>
          <tbody>
            {allocations.map((asset, index) => {
              const diff = asset.actualWeightBps - asset.targetWeightBps;
              const driftTone = diff > 0 ? "success" : diff < 0 ? "danger" : "neutral";
              const balanceResult = holdingResults?.[index * 2];
              const decimalsResult = holdingResults?.[index * 2 + 1];
              const balance = balanceResult?.result as bigint | undefined;
              const decimals = decimalsResult?.result;
              const holdingReadFailed = balanceResult?.status === "failure" || decimalsResult?.status === "failure";
              const amountHeld = holdingReadFailed
                ? "Unavailable"
                : balance !== undefined && typeof decimals === "number"
                  ? formatWalletTokenBalance(balance, decimals)
                  : holdingsLoading
                    ? "Loading"
                    : "—";
              const pinnedConfig = pinnedPricingConfigs[asset.address.toLowerCase()];
              const pricingVerified = pinnedConfig
                ? isVerifiedPricingConfig(robinhoodChainTestnet.id, asset.address, pinnedConfig)
                : false;
              return (
                <tr key={asset.address}>
                  <td data-label="Asset">
                    <div className="assetIdentity">
                      <AssetLogo logoUrl={asset.logoUrl} symbol={asset.symbol} />
                      <div>
                        <strong>{asset.symbol}</strong>
                        <span>{shortAssetAddress(asset.address)}</span>
                      </div>
                    </div>
                  </td>
                  <td className="assetAmount mobileSecondaryAssetDatum" data-label="Amount held">{amountHeld}</td>
                  <td className="mobileSecondaryAssetDatum" data-label="Price">
                    <button className="assetPriceButton" type="button" onClick={(event) => {
                      priceTriggerRef.current = event.currentTarget;
                      setSelectedPriceAsset(asset);
                    }} aria-label={`Explain how ${asset.symbol} price is calculated`}>
                      <span>{oraclePrices[asset.address.toLowerCase()]?.display ?? "Loading"}</span>
                      <CircleHelp size={13} />
                    </button>
                  </td>
                  <td data-label="Pricing">
                    <span className={`stateBadge ${pricingConfigsLoading ? "muted" : pricingVerified ? "success" : "warning"}`}>
                      {pricingConfigsLoading ? "Checking" : pricingVerified ? "Verified" : "Unverified"}
                    </span>
                    {pinnedConfig ? <small className="pinnedPricingSource">{pricingSourceLabel(pinnedConfig.source)}</small> : null}
                  </td>
                  <td data-label="Target">{bpsToAllocationPercent(asset.targetWeightBps)}</td>
                  <td className="actualWeight" data-label="Actual">{bpsToAllocationPercent(asset.actualWeightBps)}</td>
                  <td data-label="Drift">
                    <span className={`driftValue ${driftTone}`}>{signedBpsToAllocationPercent(diff)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="cardFooterAction">
        <span className="mutedInline oracleFreshnessNotice">
          <Info size={20} strokeWidth={2.25} />
          Each OTF reads only its pinned price feeds. Every Chainlink leg must satisfy its own protocol-defined freshness and pause checks, while V3 routes use the fixed protocol TWAP window. Invalid pricing has no fallback and makes oracle-dependent actions unavailable; share transfers and proportional basket deposits or redemptions remain available.
        </span>
      </div>

      <StrategyChallenge vault={vault} onRefresh={onRefresh} />
    </SectionCard>
    </>
  );
}

function StrategyHistoryModule({ vault }: { vault: VaultView }) {
  const testnetCreateAssets = useVerifiedAssetCatalog();
  const [pendingTargets, setPendingTargets] = useState<{ tokens: readonly string[]; weights: readonly bigint[] }>();
  const publicClient = usePublicClient({ chainId: robinhoodChainTestnet.id });
  const {
    data: strategyVersionCount,
    isLoading: strategyCountLoading,
    isError: strategyCountFailed,
  } = useReadContract({
    address: vault.address,
    abi: managedOtfVaultAbi,
    functionName: "strategyVersionCount",
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(vault.address), refetchInterval: 12_000 },
  });
  const { data: pendingRationale, isLoading: pendingRationaleLoading } = useReadContract({
    address: vault.address,
    abi: managedOtfVaultAbi,
    functionName: "pendingStrategyRationale",
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(vault.address && vault.strategyProposalPending), refetchInterval: 12_000 },
  });
  useEffect(() => {
    if (!vault.strategyProposalPending || !vault.address || !publicClient) {
      setPendingTargets(undefined);
      return;
    }
    let active = true;
    publicClient.getContractEvents({
      address: vault.address,
      abi: managedOtfVaultAbi,
      eventName: "TargetWeightsProposed",
      fromBlock: 0n,
      toBlock: "latest",
    }).then((logs) => {
      const latest = logs.at(-1);
      if (!active || !latest) return;
      setPendingTargets({
        tokens: latest.args.newTokens ?? [],
        weights: latest.args.newWeights ?? [],
      });
    }).catch(() => {
      if (active) setPendingTargets(undefined);
    });
    return () => { active = false; };
  }, [publicClient, vault.address, vault.strategyProposalPending]);
  const versionCount = Number(strategyVersionCount ?? 0n);
  const strategyVersionContracts = vault.address
    ? Array.from({ length: versionCount }, (_, index) => ([
        {
          address: vault.address,
          abi: managedOtfVaultAbi,
          functionName: "getStrategyVersion" as const,
          args: [BigInt(index)],
          chainId: robinhoodChainTestnet.id,
        },
        {
          address: vault.address,
          abi: managedOtfVaultAbi,
          functionName: "getStrategyTargets" as const,
          args: [BigInt(index)],
          chainId: robinhoodChainTestnet.id,
        },
      ] as const)).flat()
    : [];
  const {
    data: strategyVersionResults,
    isLoading: strategyVersionsLoading,
    isError: strategyVersionsFailed,
  } = useReadContracts({
    contracts: strategyVersionContracts,
    query: {
      enabled: strategyVersionContracts.length > 0,
      refetchInterval: 12_000,
    },
  });
  const chronologicalVersions = Array.from({ length: versionCount }, (_, index) => {
    const versionResult = strategyVersionResults?.[index * 2];
    const targetsResult = strategyVersionResults?.[index * 2 + 1];
    if (versionResult?.status !== "success" || targetsResult?.status !== "success") return undefined;
    const version = versionResult.result as StrategyVersionResult;
    const [tokens, weights] = targetsResult.result as readonly [
      readonly string[],
      readonly (number | bigint)[],
    ];
    return { ...version, index, tokens, weights } satisfies StrategyHistoryEntry;
  }).filter((entry): entry is StrategyHistoryEntry => Boolean(entry));
  const historyLoading = strategyCountLoading || (versionCount > 0 && strategyVersionsLoading);
  const historyFailed = strategyCountFailed || strategyVersionsFailed;
  const activationRemaining = useLiveCountdown(vault.pendingStrategyActivationTime);

  function targetChanges(version: StrategyHistoryEntry) {
    const previous = chronologicalVersions[version.index - 1];
    const previousTargets = new Map(
      (previous?.tokens ?? []).map((token, index) => [token.toLowerCase(), Number(previous?.weights[index] ?? 0)]),
    );
    const nextTargets = new Map(
      version.tokens.map((token, index) => [token.toLowerCase(), Number(version.weights[index] ?? 0)]),
    );
    const tokenAddresses = version.index === 0
      ? version.tokens.map((token) => token.toLowerCase())
      : Array.from(new Set([...previousTargets.keys(), ...nextTargets.keys()]));
    const rows = tokenAddresses.flatMap((address) => {
      const previousWeight = previousTargets.get(address) ?? 0;
      const nextWeight = nextTargets.get(address) ?? 0;
      if (version.index > 0 && previousWeight === nextWeight) return [];
      const catalog = testnetCreateAssets.find((asset) => asset.address.toLowerCase() === address);
      return [{ address, symbol: catalog?.symbol ?? shortAddress(address), logoUrl: catalog?.logoUrl, previousWeight, nextWeight }];
    });
    const unchangedCount = version.index === 0
      ? 0
      : tokenAddresses.length - rows.length;
    return { rows, unchangedCount };
  }
  const pendingChanges = pendingTargets && chronologicalVersions.length
    ? (() => {
        const previous = chronologicalVersions[chronologicalVersions.length - 1];
        const previousTargets = new Map(
          previous.tokens.map((token, index) => [token.toLowerCase(), Number(previous.weights[index] ?? 0)]),
        );
        const nextTargets = new Map(
          pendingTargets.tokens.map((token, index) => [token.toLowerCase(), Number(pendingTargets.weights[index] ?? 0n)]),
        );
        return Array.from(new Set([...previousTargets.keys(), ...nextTargets.keys()])).flatMap((address) => {
          const previousWeight = previousTargets.get(address) ?? 0;
          const nextWeight = nextTargets.get(address) ?? 0;
          if (previousWeight === nextWeight) return [];
          const catalog = testnetCreateAssets.find((asset) => asset.address.toLowerCase() === address);
          return [{ address, symbol: catalog?.symbol ?? shortAddress(address), logoUrl: catalog?.logoUrl, previousWeight, nextWeight }];
        });
      })()
    : [];

  return (
    <SectionCard
      title="Strategy history"
      subtitle="Permanent rationales paired with the target changes they authorized"
      icon={<BookOpen size={15} />}
      action={<span className="stateBadge muted">{versionCount} entr{versionCount === 1 ? "y" : "ies"}</span>}
    >
      {vault.strategyProposalPending ? (
        <article className="pendingStrategyHistoryEntry">
          <div className="strategyVersionHeader">
            <div><strong>Pending strategy</strong><span className="stateBadge warning">Pending activation</span></div>
            <time>{activationRemaining > 0 ? `Activates in ${formatCooldown(activationRemaining)}` : "Ready to activate"}</time>
          </div>
          <p>{pendingRationaleLoading ? "Loading the locked strategy rationale..." : pendingRationale || "Locked rationale unavailable."}</p>
          {pendingChanges.length ? <div className="strategyTargetChanges">
            {pendingChanges.map((row) => <div key={row.address}>
              <div className="strategyTargetChangeHeader">
                <span className="assetNameWithLogo"><AssetLogo logoUrl={row.logoUrl} symbol={row.symbol} compact /><strong>{row.symbol}</strong></span>
                <span>
                  {row.previousWeight === 0 ? <em>Added</em> : bpsToPercent(row.previousWeight)}
                  <ArrowRight size={11} />
                  {row.nextWeight === 0 ? <em>Removed</em> : bpsToPercent(row.nextWeight)}
                </span>
              </div>
              <div className="strategyTargetTrack" role="img" aria-label={`${row.symbol} pending target ${bpsToPercent(row.nextWeight)}`}>
                <span style={{ width: `${Math.max(0, Math.min(100, row.nextWeight / 100))}%` }} />
              </div>
            </div>)}
          </div> : null}
          <span>Current targets remain active until the 48-hour notice window closes.</span>
        </article>
      ) : null}
      {historyLoading ? (
        <div className="inlineEmptyState">
          <Loader2 className="spin" size={17} />
          <div><strong>Loading strategy history</strong><span>Reading every rationale and target snapshot from the OTF contract.</span></div>
        </div>
      ) : historyFailed ? (
        <div className="inlineEmptyState">
          <RefreshCw size={17} />
          <div><strong>Strategy history unavailable</strong><span>The contract did not return every stored strategy entry.</span></div>
        </div>
      ) : chronologicalVersions.length ? (
        <div className="strategyHistory">
          {[...chronologicalVersions].reverse().map((version) => {
            const isCurrent = version.index === versionCount - 1;
            const isInitial = version.index === 0;
            const isRebalancing = isCurrent && Number(version.completedAt) === 0;
            const status = isRebalancing
              ? vault.challengeActive ? "Rebalancing · Challenge active" : "Rebalancing"
              : isCurrent ? "Current strategy" : "Completed";
            const changes = targetChanges(version);
            return (
              <article className={`strategyVersion ${isCurrent ? "current" : ""}`} key={version.index}>
                <div className="strategyVersionHeader">
                  <div>
                    <strong>{isInitial ? "Initial strategy" : `Strategy ${version.index}`}</strong>
                    <span className={`stateBadge ${isRebalancing ? vault.challengeActive ? "danger" : "warning" : isCurrent ? "success" : "muted"}`}>{status}</span>
                  </div>
                  <time>{formatTimestamp(Number(version.activatedAt))}</time>
                </div>
                <p>{version.rationale}</p>
                <div className="strategyTargetChanges">
                  {changes.rows.map((row) => (
                    <div key={row.address}>
                      <div className="strategyTargetChangeHeader">
                        <span className="assetNameWithLogo"><AssetLogo logoUrl={row.logoUrl} symbol={row.symbol} compact /><strong>{row.symbol}</strong></span>
                        {isInitial ? (
                          <span>{bpsToPercent(row.nextWeight)}</span>
                        ) : (
                          <span>
                            {row.previousWeight === 0 ? <em>Added</em> : bpsToPercent(row.previousWeight)}
                            <ArrowRight size={11} />
                            {row.nextWeight === 0 ? <em>Removed</em> : bpsToPercent(row.nextWeight)}
                          </span>
                        )}
                      </div>
                      <div className="strategyTargetTrack" role="img" aria-label={`${row.symbol} target ${bpsToPercent(row.nextWeight)}`}>
                        <span style={{ width: `${Math.max(0, Math.min(100, row.nextWeight / 100))}%` }} />
                      </div>
                    </div>
                  ))}
                  {changes.unchangedCount > 0 ? <small>{changes.unchangedCount} unchanged asset{changes.unchangedCount === 1 ? "" : "s"}</small> : null}
                </div>
                <div className="strategyVersionMeta">
                  <span>Manager <code>{shortAddress(version.author)}</code></span>
                  <span>Proposed {formatTimestamp(Number(version.proposedAt))}</span>
                  <span>{Number(version.completedAt) > 0 ? `Completed ${formatTimestamp(Number(version.completedAt))}` : "Completion pending"}</span>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="inlineEmptyState">
          <BookOpen size={17} />
          <div><strong>No strategy entries found</strong><span>This OTF did not return its initialized strategy record.</span></div>
        </div>
      )}
    </SectionCard>
  );
}

function UserActions({
  vault,
}: {
  vault: VaultView;
}) {
  const testnetCreateAssets = useVerifiedAssetCatalog();
  const [activeAction, setActiveAction] = useState<"deposit" | "redeem">("deposit");
  const [settlementMode, setSettlementMode] = useState<RoutedSettlementMode | "rwas">("usdg");
  const [selectedRoute, setSelectedRoute] = useState<"market" | "underlying">();
  const [tradeAmount, setTradeAmount] = useState("");
  const [maxSlippage, setMaxSlippage] = useState("1.0");
  const [entryState, setEntryState] = useState<TxState>("idle");
  const [entryError, setEntryError] = useState<string>();
  const [redeemState, setRedeemState] = useState<TxState>("idle");
  const [redeemError, setRedeemError] = useState<string>();
  const [marketState, setMarketState] = useState<TxState>("idle");
  const [marketError, setMarketError] = useState<string>();
  const [tradeReceipt, setTradeReceipt] = useState<PositionTradeReceipt>();
  const { address: connectedAddress } = useAccount();
  const publicClient = usePublicClient({ chainId: robinhoodChainTestnet.id });
  const { writeContractAsync } = useWriteContract();
  const isLive = vault.dataMode === "live";
  const routedSettlementMode: RoutedSettlementMode = settlementMode === "weth" ? "weth" : "usdg";
  const isRoutedMode = settlementMode !== "rwas";
  const isWethMode = settlementMode === "weth";
  const settlementSymbol = isWethMode ? "WETH" : "USDG";
  const entryRouterAddress = configuredEntryRouterAddress(routedSettlementMode);
  const entryAdapterAddress = configuredEntryAdapterAddress(routedSettlementMode);
  const uniswapV3SwapRouterAddress = configuredUniswapV3SwapRouterAddress();
  const uniswapV3QuoterAddress = configuredUniswapV3QuoterAddress();
  const configuredSettlementToken = configuredSettlementTokenAddress(routedSettlementMode);
  const isRegisteredEntryAdapter = Boolean(entryAdapterAddress);
  const executionDiscoveryPairs = useMemo<V3TokenPair[]>(() => {
    const quotes = [robinhoodTestnetAddresses.usdg, robinhoodTestnetAddresses.weth]
      .filter((address): address is `0x${string}` => Boolean(address));
    return [
      ...vault.allocations.flatMap((asset) => quotes.map((quote) => ({
        tokenA: asset.address,
        tokenB: quote,
      }))),
      ...(quotes.length === 2 ? [{ tokenA: quotes[0], tokenB: quotes[1] }] : []),
    ];
  }, [vault.allocations]);
  const {
    pools: discoveredExecutionPools,
    isLoading: executionRouteDiscoveryLoading,
    isError: executionRouteDiscoveryError,
    discoveryComplete: executionRouteDiscoveryComplete,
  } = useDiscoveredV3Pools(executionDiscoveryPairs, isRegisteredEntryAdapter && isLive);
  const alternateSettlementToken = routedSettlementMode === "weth"
    ? robinhoodTestnetAddresses.usdg
    : robinhoodTestnetAddresses.weth;
  const executionRouteFor = (asset: string) => configuredSettlementToken
    ? selectExecutionRoute(
        discoveredExecutionPools,
        asset,
        configuredSettlementToken,
        alternateSettlementToken,
      )
    : undefined;
  const exactInputRouteFor = (asset: string, assetToSettlement = false) => {
    if (!isRegisteredEntryAdapter || !configuredSettlementToken) return undefined;
    const route = executionRouteFor(asset);
    return route ? packedExecutionRoute(route, assetToSettlement) : undefined;
  };
  const exactOutputRouteFor = (asset: string) => {
    if (!isRegisteredEntryAdapter || !configuredSettlementToken) return undefined;
    const route = executionRouteFor(asset);
    return route ? packedExecutionRoute(route, true) : undefined;
  };
  const executionRoutesDiscovered = !isRegisteredEntryAdapter || vault.allocations.every(
    (asset) => asset.address.toLowerCase() === configuredSettlementToken?.toLowerCase() ||
      Boolean(exactInputRouteFor(asset.address)),
  );
  const vaultAssetsVerified = vault.allocations.length > 0
    && vault.allocations.every((asset) => assetIsVerifiedForAddress(testnetCreateAssets, asset.address));
  const depositsPausedForAssetRemoval = vault.allocations.some(
    (asset) => asset.targetWeightBps === 0,
  );
  const vaultDepositsBlocked = primaryDepositsBlocked({
    sunset: vault.sunset,
    globalPause: vault.protocolDepositsPaused,
    localPause: vault.vaultDepositsPaused,
    pauseStatusAvailable: !vault.depositPauseStatusUnavailable,
    retiringAsset: depositsPausedForAssetRemoval,
  });

  useEffect(() => {
    if (!vault.sunset || activeAction !== "deposit") return;
    setActiveAction("redeem");
    setTradeAmount("");
    setSelectedRoute(undefined);
    setTradeReceipt(undefined);
    setEntryState("idle");
    setRedeemState("idle");
    setMarketState("idle");
    setEntryError(undefined);
    setRedeemError(undefined);
    setMarketError(undefined);
  }, [activeAction, vault.sunset]);
  const entryContractsConfigured = Boolean(
    entryRouterAddress && entryAdapterAddress && uniswapV3QuoterAddress,
  );
  const parsedSlippage = Number(maxSlippage);
  const slippageBps = Number.isFinite(parsedSlippage)
    ? Math.round(parsedSlippage * 100)
    : 0;
  const slippageValid = slippageBps >= 1 && slippageBps <= 2_000;
  let requestedRedeemShares: bigint | undefined;
  try {
    requestedRedeemShares = activeAction === "redeem" && Number(tradeAmount) > 0
      ? parseUnits(tradeAmount, 18)
      : undefined;
  } catch {
    requestedRedeemShares = undefined;
  }
  let requestedDirectMintShares: bigint | undefined;
  try {
    requestedDirectMintShares = !isRoutedMode && activeAction === "deposit" && Number(tradeAmount) > 0
      ? parseUnits(tradeAmount, 18)
      : undefined;
  } catch {
    requestedDirectMintShares = undefined;
  }
  const entrySlippageBps = slippageBps;
  const entrySlippageValid = slippageValid;
  const redeemSlippageBps = slippageBps;
  const redeemSlippageValid = slippageValid;
  const settlementToken = configuredSettlementToken;
  const exactOutputQuoteContract = (asset: string, amountOut: bigint) => {
    const path = exactOutputRouteFor(asset);
    if (!path || !uniswapV3QuoterAddress) throw new Error("Execution route unavailable");
    return {
      address: uniswapV3QuoterAddress as `0x${string}`,
      abi: uniswapV3QuoterAbi,
      functionName: "quoteExactOutput" as const,
      args: [path, amountOut] as const,
      chainId: robinhoodChainTestnet.id,
    };
  };
  const exactInputQuoteContract = (asset: string, amountIn: bigint, assetToSettlement = false) => {
    const path = exactInputRouteFor(asset, assetToSettlement);
    if (!path || !uniswapV3QuoterAddress) throw new Error("Execution route unavailable");
    return {
      address: uniswapV3QuoterAddress as `0x${string}`,
      abi: uniswapV3QuoterAbi,
      functionName: "quoteExactInput" as const,
      args: [path, amountIn] as const,
      chainId: robinhoodChainTestnet.id,
    };
  };
  const constituentLiquidityLoading = executionRouteDiscoveryLoading;
  const constituentPoolStates = vault.allocations.map((asset) => {
    const isSettlement = asset.address.toLowerCase() === settlementToken?.toLowerCase();
    const route = isSettlement ? undefined : executionRouteFor(asset.address);
    const pools = executionRoutePools(route);
    return {
      asset: asset.address,
      isSettlement,
      route,
      pools,
      readFailed: pools.some((pool) => pool?.readFailed),
      ready: isSettlement || Boolean(route && pools.every(
        (pool) => pool?.liquidity !== undefined && pool.liquidity > 0n && !pool.readFailed,
      )),
    };
  });
  const constituentRoutesDiscovered = Boolean(
    settlementToken && executionRouteDiscoveryComplete && executionRoutesDiscovered,
  );
  const constituentRoutesReady = Boolean(
    settlementToken && constituentPoolStates.every((state) => state.ready),
  );
  const constituentLiquidityReadFailed = constituentPoolStates.some(
    (state) => state.readFailed,
  ) || executionRouteDiscoveryError;
  const emptyConstituentPoolSymbols = constituentPoolStates.flatMap((state) => {
    if (state.isSettlement || !state.route || state.ready) return [];
    const allocation = vault.allocations.find(
      (asset) => asset.address.toLowerCase() === state.asset.toLowerCase(),
    );
    return [allocation?.symbol ?? shortAddress(state.asset)];
  });
  const { data: settlementDecimalsRead } = useReadContract({
    address: settlementToken,
    abi: erc20BalanceAbi,
    functionName: "decimals",
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(settlementToken) },
  });
  const settlementDecimals = Number(settlementDecimalsRead ?? 18);
  let requestedSettlementAmount: bigint | undefined;
  try {
    requestedSettlementAmount = isRoutedMode && activeAction === "deposit" && Number(tradeAmount) > 0
      ? parseUnits(tradeAmount, settlementDecimals)
      : undefined;
  } catch {
    requestedSettlementAmount = undefined;
  }
  const settlementSizingSeedValue = requestedSettlementAmount === undefined
    ? undefined
    : requestedSettlementAmount * 10n ** 18n / 10n ** BigInt(settlementDecimals);
  const entrySizingSeedShares = settlementSizingSeedValue && vault.navPerShareValue
    ? settlementSizingSeedValue * 10n ** 18n / vault.navPerShareValue
    : undefined;
  const navEstimatedShares = isWethMode ? undefined : entrySizingSeedShares;
  let navRequestedEntryShares: bigint | undefined;
  if (activeAction === "deposit" && entrySizingSeedShares && slippageValid) {
    navRequestedEntryShares = entrySizingSeedShares * 10_000n / BigInt(10_000 + slippageBps);
  }
  const { data: entryAdapterApproved } = useReadContract({
    address: vault.factoryAddress,
    abi: otfFactoryAbi,
    functionName: "isEntryAdapterApproved",
    args: entryAdapterAddress ? [entryAdapterAddress] : undefined,
    chainId: robinhoodChainTestnet.id,
    query: { enabled: entryContractsConfigured && isLive },
  });
  const { data: exitAdapterApproved } = useReadContract({
    address: vault.factoryAddress,
    abi: otfFactoryAbi,
    functionName: "isExitAdapterApproved",
    args: entryAdapterAddress ? [entryAdapterAddress] : undefined,
    chainId: robinhoodChainTestnet.id,
    query: { enabled: entryContractsConfigured && isLive },
  });
  const canQuoteEntry = Boolean(
    isLive &&
    !vaultDepositsBlocked &&
    vault.address &&
    navRequestedEntryShares &&
    navRequestedEntryShares > 0n &&
    settlementToken &&
    entryAdapterApproved &&
    entrySlippageValid,
  );
  const {
    data: previewEntryAmounts,
    error: previewEntryError,
    isLoading: previewEntryLoading,
    refetch: refetchEntryPreview,
  } = useReadContract({
    address: vault.address,
    abi: vaultDepositAbi,
    functionName: "previewMint",
    args: navRequestedEntryShares ? [navRequestedEntryShares] : undefined,
    chainId: robinhoodChainTestnet.id,
    query: { enabled: canQuoteEntry },
  });
  const entryQuoteContracts = canQuoteEntry && constituentRoutesReady && previewEntryAmounts && settlementToken && uniswapV3QuoterAddress
    ? vault.allocations.flatMap((asset, index) => {
        if (asset.address.toLowerCase() === settlementToken.toLowerCase()) return [];
        const amountOut = previewEntryAmounts[index];
        if (amountOut === undefined || amountOut === 0n) return [];
        return [exactOutputQuoteContract(asset.address, amountOut)];
      })
    : [];
  const {
    data: entryQuoteResults,
    isLoading: entryQuotesLoading,
    refetch: refetchEntryQuotes,
  } = useReadContracts({
    contracts: entryQuoteContracts as readonly MulticallRead[],
    query: { enabled: entryQuoteContracts.length > 0 },
  });
  function deriveEntryLegs(
    previewAmounts: readonly bigint[] | undefined,
    quoteResults: typeof entryQuoteResults,
  ) {
    let quoteIndex = 0;
    return vault.allocations.map((asset, index) => {
      const requiredAmount = previewAmounts?.[index];
      const isSettlement = Boolean(
        settlementToken && asset.address.toLowerCase() === settlementToken.toLowerCase(),
      );
      let quotedSettlement: bigint | undefined;
      let quoteFailed = false;
      let quoteError: string | undefined;
      if (isSettlement) {
        quotedSettlement = requiredAmount;
      } else if (requiredAmount !== undefined && requiredAmount > 0n) {
        const result = quoteResults?.[quoteIndex];
        quoteIndex += 1;
        const quote = result?.result as readonly [bigint, bigint, number, bigint] | undefined;
        quotedSettlement = quote?.[0];
        quoteFailed = result?.status === "failure";
        quoteError = quoteFailed ? errorMessage(result?.error) : undefined;
      }
      const maximumSettlement = quotedSettlement !== undefined && !isSettlement
        ? (quotedSettlement * BigInt(10_000 + entrySlippageBps) + 9_999n) / 10_000n
        : isSettlement ? 0n : undefined;
      return {
        ...asset,
        requiredAmount,
        isSettlement,
        quotedSettlement,
        maximumSettlement,
        quoteFailed,
        quoteError,
      };
    });
  }

  const initialEntryLegs = deriveEntryLegs(previewEntryAmounts, entryQuoteResults);
  const initialEntryQuoteReady = Boolean(
    navRequestedEntryShares &&
    previewEntryAmounts?.length === vault.allocations.length &&
    initialEntryLegs.every((leg) =>
      leg.requiredAmount !== undefined &&
      leg.quotedSettlement !== undefined &&
      leg.maximumSettlement !== undefined,
    ),
  );
  const initialMaximumSettlementTotal = initialEntryQuoteReady
    ? initialEntryLegs.reduce(
        (sum, leg) => sum + (leg.isSettlement ? leg.requiredAmount ?? 0n : leg.maximumSettlement ?? 0n),
        0n,
      )
    : undefined;
  const adjustedEntryShares =
    navRequestedEntryShares &&
    requestedSettlementAmount !== undefined &&
    initialMaximumSettlementTotal !== undefined &&
    initialMaximumSettlementTotal > 0n &&
    initialMaximumSettlementTotal !== requestedSettlementAmount
      ? navRequestedEntryShares * requestedSettlementAmount / initialMaximumSettlementTotal
      : undefined;
  const canQuoteAdjustedEntry = Boolean(
    canQuoteEntry && adjustedEntryShares && adjustedEntryShares > 0n,
  );
  const {
    data: adjustedPreviewEntryAmounts,
    error: adjustedPreviewEntryError,
    isLoading: adjustedPreviewEntryLoading,
  } = useReadContract({
    address: vault.address,
    abi: vaultDepositAbi,
    functionName: "previewMint",
    args: adjustedEntryShares ? [adjustedEntryShares] : undefined,
    chainId: robinhoodChainTestnet.id,
    query: { enabled: canQuoteAdjustedEntry },
  });
  const adjustedEntryQuoteContracts = canQuoteAdjustedEntry && constituentRoutesReady && adjustedPreviewEntryAmounts && settlementToken && uniswapV3QuoterAddress
    ? vault.allocations.flatMap((asset, index) => {
        if (asset.address.toLowerCase() === settlementToken.toLowerCase()) return [];
        const amountOut = adjustedPreviewEntryAmounts[index];
        if (amountOut === undefined || amountOut === 0n) return [];
        return [exactOutputQuoteContract(asset.address, amountOut)];
      })
    : [];
  const {
    data: adjustedEntryQuoteResults,
    isLoading: adjustedEntryQuotesLoading,
  } = useReadContracts({
    contracts: adjustedEntryQuoteContracts as readonly MulticallRead[],
    query: { enabled: adjustedEntryQuoteContracts.length > 0 },
  });
  const adjustedEntryLegs = deriveEntryLegs(adjustedPreviewEntryAmounts, adjustedEntryQuoteResults);
  const adjustedEntryQuoteReady = Boolean(
    adjustedEntryShares &&
    adjustedPreviewEntryAmounts?.length === vault.allocations.length &&
    adjustedEntryLegs.every((leg) =>
      leg.requiredAmount !== undefined &&
      leg.quotedSettlement !== undefined &&
      leg.maximumSettlement !== undefined,
    ),
  );
  const adjustedMaximumSettlementTotal = adjustedEntryQuoteReady
    ? adjustedEntryLegs.reduce(
        (sum, leg) => sum + (leg.isSettlement ? leg.requiredAmount ?? 0n : leg.maximumSettlement ?? 0n),
        0n,
      )
    : undefined;
  let refinedEntryShares: bigint | undefined;
  if (
    navRequestedEntryShares &&
    adjustedEntryShares &&
    initialMaximumSettlementTotal !== undefined &&
    adjustedMaximumSettlementTotal !== undefined &&
    requestedSettlementAmount !== undefined
  ) {
    const initialIsLower = initialMaximumSettlementTotal < requestedSettlementAmount;
    const adjustedIsLower = adjustedMaximumSettlementTotal < requestedSettlementAmount;
    if (initialIsLower !== adjustedIsLower) {
      const lowerShares = initialIsLower ? navRequestedEntryShares : adjustedEntryShares;
      const lowerCost = initialIsLower ? initialMaximumSettlementTotal : adjustedMaximumSettlementTotal;
      const upperShares = initialIsLower ? adjustedEntryShares : navRequestedEntryShares;
      const upperCost = initialIsLower ? adjustedMaximumSettlementTotal : initialMaximumSettlementTotal;
      const interpolatedShares = lowerShares +
        (upperShares - lowerShares) * (requestedSettlementAmount - lowerCost) / (upperCost - lowerCost);
      if (interpolatedShares > lowerShares && interpolatedShares < upperShares) {
        refinedEntryShares = interpolatedShares;
      }
    }
  }
  const canQuoteRefinedEntry = Boolean(
    canQuoteEntry && refinedEntryShares && refinedEntryShares > 0n,
  );
  const {
    data: refinedPreviewEntryAmounts,
    error: refinedPreviewEntryError,
    isLoading: refinedPreviewEntryLoading,
  } = useReadContract({
    address: vault.address,
    abi: vaultDepositAbi,
    functionName: "previewMint",
    args: refinedEntryShares ? [refinedEntryShares] : undefined,
    chainId: robinhoodChainTestnet.id,
    query: { enabled: canQuoteRefinedEntry },
  });
  const refinedEntryQuoteContracts = canQuoteRefinedEntry && constituentRoutesReady && refinedPreviewEntryAmounts && settlementToken && uniswapV3QuoterAddress
    ? vault.allocations.flatMap((asset, index) => {
        if (asset.address.toLowerCase() === settlementToken.toLowerCase()) return [];
        const amountOut = refinedPreviewEntryAmounts[index];
        if (amountOut === undefined || amountOut === 0n) return [];
        return [exactOutputQuoteContract(asset.address, amountOut)];
      })
    : [];
  const {
    data: refinedEntryQuoteResults,
    isLoading: refinedEntryQuotesLoading,
  } = useReadContracts({
    contracts: refinedEntryQuoteContracts as readonly MulticallRead[],
    query: { enabled: refinedEntryQuoteContracts.length > 0 },
  });
  const requestedEntryShares = refinedEntryShares ?? adjustedEntryShares ?? navRequestedEntryShares;
  const finalPreviewEntryAmounts = refinedEntryShares
    ? refinedPreviewEntryAmounts
    : adjustedEntryShares
      ? adjustedPreviewEntryAmounts
      : previewEntryAmounts;
  const finalEntryQuoteResults = refinedEntryShares
    ? refinedEntryQuoteResults
    : adjustedEntryShares
      ? adjustedEntryQuoteResults
      : entryQuoteResults;
  const finalPreviewEntryLoading = refinedEntryShares
    ? refinedPreviewEntryLoading
    : adjustedEntryShares
      ? adjustedPreviewEntryLoading
      : previewEntryLoading;
  const finalEntryQuotesLoading = refinedEntryShares
    ? refinedEntryQuotesLoading
    : adjustedEntryShares
      ? adjustedEntryQuotesLoading
      : entryQuotesLoading;
  const finalPreviewEntryError = refinedEntryShares
    ? refinedPreviewEntryError
    : adjustedEntryShares
      ? adjustedPreviewEntryError
      : previewEntryError;
  const entryAuthorizationContracts = ([
        {
          address: settlementToken ?? zeroAddress,
          abi: erc20BalanceAbi,
          functionName: "balanceOf" as const,
          args: [(connectedAddress ?? zeroAddress) as `0x${string}`],
          chainId: robinhoodChainTestnet.id,
        },
        {
          address: settlementToken ?? zeroAddress,
          abi: erc20BalanceAbi,
          functionName: "allowance" as const,
          args: [
            (connectedAddress ?? zeroAddress) as `0x${string}`,
            (entryRouterAddress ?? zeroAddress) as `0x${string}`,
          ],
          chainId: robinhoodChainTestnet.id,
        },
        {
          address: settlementToken ?? zeroAddress,
          abi: erc20BalanceAbi,
          functionName: "decimals" as const,
          chainId: robinhoodChainTestnet.id,
        },
      ] as const);
  const {
    data: entryAuthorizationResults,
    isLoading: entryAuthorizationLoading,
    refetch: refetchEntryAuthorization,
  } = useReadContracts({
    contracts: entryAuthorizationContracts,
    query: { enabled: Boolean(settlementToken && connectedAddress) },
  });
  const canPreviewRedeem = Boolean(
    isLive && vault.address && requestedRedeemShares && requestedRedeemShares > 0n,
  );
  const {
    data: previewRedeemAmounts,
    error: previewRedeemError,
    isLoading: previewRedeemLoading,
    refetch: refetchRedeemPreview,
  } = useReadContract({
    address: vault.address,
    abi: vaultDepositAbi,
    functionName: "previewRedeem",
    args: requestedRedeemShares ? [requestedRedeemShares] : undefined,
    chainId: robinhoodChainTestnet.id,
    query: { enabled: canPreviewRedeem },
  });
  const redeemQuoteContracts = previewRedeemAmounts && settlementToken && constituentRoutesReady && uniswapV3QuoterAddress && redeemSlippageValid
    ? vault.allocations.flatMap((asset, index) => {
        if (asset.address.toLowerCase() === settlementToken.toLowerCase()) return [];
        const amountIn = previewRedeemAmounts[index];
        if (amountIn === undefined || amountIn === 0n) return [];
        return [exactInputQuoteContract(asset.address, amountIn, true)];
      })
    : [];
  const {
    data: redeemQuoteResults,
    isLoading: redeemQuotesLoading,
    refetch: refetchRedeemQuotes,
  } = useReadContracts({
    contracts: redeemQuoteContracts as readonly MulticallRead[],
    query: { enabled: redeemQuoteContracts.length > 0 },
  });
  const redeemAuthorizationContracts = ([
    {
      address: vault.address ?? zeroAddress,
      abi: erc20BalanceAbi,
      functionName: "balanceOf" as const,
      args: [(connectedAddress ?? zeroAddress) as `0x${string}`],
      chainId: robinhoodChainTestnet.id,
    },
    {
      address: vault.address ?? zeroAddress,
      abi: erc20BalanceAbi,
      functionName: "allowance" as const,
      args: [
        (connectedAddress ?? zeroAddress) as `0x${string}`,
        (entryRouterAddress ?? zeroAddress) as `0x${string}`,
      ],
      chainId: robinhoodChainTestnet.id,
    },
  ] as const);
  const {
    data: redeemAuthorizationResults,
    isLoading: redeemAuthorizationLoading,
    refetch: refetchRedeemAuthorization,
  } = useReadContracts({
    contracts: redeemAuthorizationContracts,
    query: { enabled: Boolean(vault.address && connectedAddress) },
  });
  const redeemShareBalance = redeemAuthorizationResults?.[0]?.result as bigint | undefined;
  const redeemShareAllowance = redeemAuthorizationResults?.[1]?.result as bigint | undefined;
  const basketAuthorizationContracts = vault.address
    ? vault.allocations.flatMap((asset) => ([
        {
          address: asset.address as `0x${string}`,
          abi: erc20BalanceAbi,
          functionName: "balanceOf" as const,
          args: [connectedAddress ?? zeroAddress],
          chainId: robinhoodChainTestnet.id,
        },
        {
          address: asset.address as `0x${string}`,
          abi: erc20BalanceAbi,
          functionName: "allowance" as const,
          args: [connectedAddress ?? zeroAddress, vault.address as `0x${string}`],
          chainId: robinhoodChainTestnet.id,
        },
        {
          address: asset.address as `0x${string}`,
          abi: erc20BalanceAbi,
          functionName: "decimals" as const,
          chainId: robinhoodChainTestnet.id,
        },
      ] as const))
    : [];
  const {
    data: basketAuthorizationResults,
    isLoading: basketAuthorizationLoading,
    refetch: refetchBasketAuthorization,
  } = useReadContracts({
    contracts: basketAuthorizationContracts,
    query: {
      enabled: basketAuthorizationContracts.length > 0,
      refetchInterval: 12_000,
    },
  });
  const {
    data: directMintPreviewAmounts,
    error: directMintPreviewError,
    isLoading: directMintPreviewLoading,
    refetch: refetchDirectMintPreview,
  } = useReadContract({
    address: vault.address,
    abi: vaultDepositAbi,
    functionName: "previewMint",
    args: requestedDirectMintShares ? [requestedDirectMintShares] : undefined,
    chainId: robinhoodChainTestnet.id,
    query: {
      enabled: Boolean(
        !isRoutedMode && activeAction === "deposit" && requestedDirectMintShares && isLive && !vaultDepositsBlocked,
      ),
    },
  });
  const {
    data: ownedUnderlyingAmounts,
    isLoading: ownedUnderlyingLoading,
    refetch: refetchOwnedUnderlying,
  } = useReadContract({
    address: vault.address,
    abi: vaultDepositAbi,
    functionName: "previewRedeem",
    args: redeemShareBalance && redeemShareBalance > 0n ? [redeemShareBalance] : undefined,
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(isLive && vault.address && redeemShareBalance && redeemShareBalance > 0n) },
  });
  const {
    data: perShareUnderlyingAmounts,
    isLoading: perShareUnderlyingLoading,
  } = useReadContract({
    address: vault.address,
    abi: vaultDepositAbi,
    functionName: "previewRedeem",
    args: [10n ** 18n],
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(isLive && vault.address) },
  });
  const directBasketLegs = vault.allocations.map((asset, index) => {
    const balanceResult = basketAuthorizationResults?.[index * 3];
    const allowanceResult = basketAuthorizationResults?.[index * 3 + 1];
    const decimalsResult = basketAuthorizationResults?.[index * 3 + 2];
    const requiredAmount = directMintPreviewAmounts?.[index];
    const maximumAmount = requiredAmount !== undefined
      ? (requiredAmount * BigInt(10_000 + slippageBps) + 9_999n) / 10_000n
      : undefined;
    return {
      ...asset,
      balance: balanceResult?.result as bigint | undefined,
      allowance: allowanceResult?.result as bigint | undefined,
      decimals: Number(decimalsResult?.result ?? 18),
      readFailed: balanceResult?.status === "failure" ||
        allowanceResult?.status === "failure" || decimalsResult?.status === "failure",
      requiredAmount,
      maximumAmount,
    };
  });
  const directBasketReady = Boolean(
    requestedDirectMintShares && directMintPreviewAmounts?.length === vault.allocations.length &&
    directBasketLegs.every((leg) => leg.requiredAmount !== undefined && leg.maximumAmount !== undefined),
  );
  const directBasketBalanceSufficient = directBasketReady && directBasketLegs.every(
    (leg) => leg.balance !== undefined && leg.requiredAmount !== undefined && leg.balance >= leg.requiredAmount,
  );
  const directBasketAllowanceSufficient = directBasketReady && directBasketLegs.every(
    (leg) => leg.allowance !== undefined && leg.maximumAmount !== undefined && leg.allowance >= leg.maximumAmount,
  );
  const entryLegs = deriveEntryLegs(finalPreviewEntryAmounts, finalEntryQuoteResults);
  const entrySizingQuoteReady = Boolean(
    requestedEntryShares &&
    finalPreviewEntryAmounts?.length === vault.allocations.length &&
    entryLegs.every((leg) =>
      leg.requiredAmount !== undefined &&
      leg.quotedSettlement !== undefined &&
      leg.maximumSettlement !== undefined,
    ),
  );
  const quotedSettlementTotal = entrySizingQuoteReady
    ? entryLegs.reduce((sum, leg) => sum + (leg.quotedSettlement ?? 0n), 0n)
    : undefined;
  const entrySettlementInputs = (() => {
    const inputs = new Array<bigint | undefined>(entryLegs.length).fill(undefined);
    if (
      !entrySizingQuoteReady || requestedSettlementAmount === undefined ||
      quotedSettlementTotal === undefined || quotedSettlementTotal === 0n
    ) return inputs;

    let remainingInput = requestedSettlementAmount;
    let remainingQuote = quotedSettlementTotal;
    for (let index = 0; index < entryLegs.length; index += 1) {
      const quoted = entryLegs[index]?.quotedSettlement ?? 0n;
      const allocation = remainingQuote === quoted
        ? remainingInput
        : remainingInput * quoted / remainingQuote;
      inputs[index] = allocation;
      remainingInput -= allocation;
      remainingQuote -= quoted;
    }
    return inputs;
  })();
  const exactInputEntryQuoteContracts = entrySizingQuoteReady && settlementToken && uniswapV3QuoterAddress
    ? entryLegs.flatMap((leg, index) => {
        const settlementIn = entrySettlementInputs[index];
        if (leg.isSettlement || settlementIn === undefined || settlementIn === 0n) return [];
        return [exactInputQuoteContract(leg.address, settlementIn)];
      })
    : [];
  const {
    data: exactInputEntryQuoteResults,
    isLoading: exactInputEntryQuotesLoading,
    refetch: refetchExactInputEntryQuotes,
  } = useReadContracts({
    contracts: exactInputEntryQuoteContracts as readonly MulticallRead[],
    query: { enabled: exactInputEntryQuoteContracts.length > 0 },
  });
  let exactInputEntryQuoteIndex = 0;
  const exactInputEntryLegs = entryLegs.map((leg, index) => {
    const settlementIn = entrySettlementInputs[index];
    let quotedAssetOut: bigint | undefined;
    let quoteFailed = false;
    let quoteError: string | undefined;
    if (leg.isSettlement) {
      quotedAssetOut = settlementIn;
    } else if (settlementIn !== undefined && settlementIn > 0n) {
      const result = exactInputEntryQuoteResults?.[exactInputEntryQuoteIndex];
      exactInputEntryQuoteIndex += 1;
      const quote = result?.result as readonly [bigint, bigint, number, bigint] | undefined;
      quotedAssetOut = quote?.[0];
      quoteFailed = result?.status === "failure";
      quoteError = quoteFailed ? errorMessage(result?.error) : undefined;
    } else if (settlementIn === 0n) {
      quotedAssetOut = 0n;
    }
    const minimumAssetOut = quotedAssetOut === undefined
      ? undefined
      : leg.isSettlement
        ? quotedAssetOut
        : quotedAssetOut * BigInt(10_000 - entrySlippageBps) / 10_000n;
    return {
      ...leg,
      settlementIn,
      quotedAssetOut,
      minimumAssetOut,
      quoteFailed,
      quoteError,
    };
  });
  const entryRefundRateQuoteContracts = settlementToken && uniswapV3QuoterAddress
    ? exactInputEntryLegs.flatMap((leg) => {
        if (leg.isSettlement || leg.quotedAssetOut === undefined || leg.quotedAssetOut === 0n) return [];
        return [exactInputQuoteContract(leg.address, leg.quotedAssetOut, true)];
      })
    : [];
  const {
    data: entryRefundRateQuoteResults,
    isLoading: entryRefundRateQuotesLoading,
    refetch: refetchEntryRefundRateQuotes,
  } = useReadContracts({
    contracts: entryRefundRateQuoteContracts as readonly MulticallRead[],
    query: { enabled: entryRefundRateQuoteContracts.length > 0 },
  });
  let entryRefundRateQuoteIndex = 0;
  const protectedExactInputEntryLegs = exactInputEntryLegs.map((leg) => {
    if (leg.isSettlement) return { ...leg, minimumRefundSettlementRate: 0n };
    const result = entryRefundRateQuoteResults?.[entryRefundRateQuoteIndex];
    entryRefundRateQuoteIndex += 1;
    const quote = result?.result as readonly [bigint, bigint, number, bigint] | undefined;
    const quotedRefundSettlement = quote?.[0];
    const refundRateQuoteFailed = result?.status === "failure";
    const minimumRefundSettlementRate = quotedRefundSettlement !== undefined && leg.quotedAssetOut
      ? quotedRefundSettlement * BigInt(10_000 - entrySlippageBps) / 10_000n
        * 10n ** 18n / leg.quotedAssetOut
      : undefined;
    return {
      ...leg,
      minimumRefundSettlementRate,
      quoteFailed: leg.quoteFailed || refundRateQuoteFailed,
      quoteError: leg.quoteError ?? (refundRateQuoteFailed ? errorMessage(result?.error) : undefined),
    };
  });
  const entryAssetQuotesReady = Boolean(
    entrySizingQuoteReady &&
    protectedExactInputEntryLegs.every((leg) =>
      leg.settlementIn !== undefined &&
      leg.quotedAssetOut !== undefined &&
      leg.minimumAssetOut !== undefined &&
      leg.minimumRefundSettlementRate !== undefined &&
      (leg.isSettlement || leg.minimumRefundSettlementRate > 0n) &&
      !leg.quoteFailed,
    ),
  );
  const estimatedEntryAssetAmounts = entryAssetQuotesReady
    ? protectedExactInputEntryLegs.map((leg) => leg.quotedAssetOut as bigint)
    : undefined;
  const minimumEntryAssetAmounts = entryAssetQuotesReady
    ? protectedExactInputEntryLegs.map((leg) => leg.minimumAssetOut as bigint)
    : undefined;
  function deriveEntrySharesFromAmounts(amounts: readonly bigint[] | undefined) {
    if (!amounts || !requestedEntryShares || finalPreviewEntryAmounts?.length !== amounts.length) {
      return undefined;
    }
    let shares: bigint | undefined;
    for (let index = 0; index < amounts.length; index += 1) {
      const requiredAmount = finalPreviewEntryAmounts[index];
      if (requiredAmount === undefined || requiredAmount === 0n) continue;
      const candidate = requestedEntryShares * amounts[index] / requiredAmount;
      shares = shares === undefined || candidate < shares ? candidate : shares;
    }
    return shares;
  }
  const estimatedEntryShares = deriveEntrySharesFromAmounts(estimatedEntryAssetAmounts);
  const minimumEntryShares = deriveEntrySharesFromAmounts(minimumEntryAssetAmounts);
  const entryQuoteReady = Boolean(
    entryAssetQuotesReady && estimatedEntryShares && estimatedEntryShares > 0n &&
    minimumEntryShares && minimumEntryShares > 0n,
  );
  const entrySettlementInput = entryQuoteReady ? requestedSettlementAmount : undefined;
  const settlementBalance = entryAuthorizationResults?.[0]?.result as bigint | undefined;
  const settlementAllowance = entryAuthorizationResults?.[1]?.result as bigint | undefined;
  const otfMarketPairs = useMemo<V3TokenPair[]>(
    () => vault.address && configuredSettlementToken
      ? [{ tokenA: vault.address, tokenB: configuredSettlementToken }]
      : [],
    [configuredSettlementToken, vault.address],
  );
  const {
    pools: discoveredOtfMarkets,
    isLoading: marketPoolChecking,
  } = useDiscoveredV3Pools(otfMarketPairs, isLive && isRoutedMode);
  const selectedMarketPool = vault.address && configuredSettlementToken
    ? selectV3Pool(discoveredOtfMarkets, vault.address, configuredSettlementToken)
    : undefined;
  const marketFee = selectedMarketPool?.fee;
  const marketLiquidityReady = Boolean(
    selectedMarketPool && !selectedMarketPool.readFailed &&
    selectedMarketPool.liquidity !== undefined && selectedMarketPool.liquidity > 0n,
  );
  const marketInputAmount = isRoutedMode
    ? activeAction === "deposit" ? requestedSettlementAmount : requestedRedeemShares
    : undefined;
  const marketInputToken = activeAction === "deposit" ? settlementToken : vault.address;
  const marketOutputToken = activeAction === "deposit" ? vault.address : settlementToken;
  const {
    data: marketQuoteResult,
    error: marketQuoteError,
    isLoading: marketQuoteLoading,
    refetch: refetchMarketQuote,
  } = useReadContract({
    address: uniswapV3QuoterAddress,
    abi: uniswapV3QuoterAbi,
    functionName: "quoteExactInputSingle",
    args: marketInputAmount && marketInputToken && marketOutputToken && marketFee !== undefined
      ? [{
          tokenIn: marketInputToken,
          tokenOut: marketOutputToken,
          amountIn: marketInputAmount,
          fee: marketFee,
          sqrtPriceLimitX96: 0n,
        }]
      : undefined,
    chainId: robinhoodChainTestnet.id,
    query: {
      enabled: Boolean(
        uniswapV3QuoterAddress && marketLiquidityReady && marketInputAmount &&
        marketInputAmount > 0n && marketInputToken && marketOutputToken && slippageValid,
      ),
    },
  });
  const marketQuotedOutput = (marketQuoteResult as readonly [bigint, bigint, number, bigint] | undefined)?.[0];
  const marketMinimumOutput = marketQuotedOutput === undefined || !slippageValid
    ? undefined
    : marketQuotedOutput * BigInt(10_000 - slippageBps) / 10_000n;
  const navRedeemValue = requestedRedeemShares && vault.navPerShareValue
    ? requestedRedeemShares * vault.navPerShareValue / 10n ** 18n
    : undefined;
  const marketQuotedSlippageBps = quotedSlippageBps(
    marketQuotedOutput,
    activeAction === "deposit" ? navEstimatedShares : navRedeemValue,
  );
  const marketRequiredInput = marketInputAmount;
  const marketAuthorizationContracts = ([
    {
      address: marketInputToken ?? zeroAddress,
      abi: erc20BalanceAbi,
      functionName: "balanceOf" as const,
      args: [(connectedAddress ?? zeroAddress) as `0x${string}`],
      chainId: robinhoodChainTestnet.id,
    },
    {
      address: marketInputToken ?? zeroAddress,
      abi: erc20BalanceAbi,
      functionName: "allowance" as const,
      args: [
        (connectedAddress ?? zeroAddress) as `0x${string}`,
        (uniswapV3SwapRouterAddress ?? zeroAddress) as `0x${string}`,
      ],
      chainId: robinhoodChainTestnet.id,
    },
  ] as const);
  const {
    data: marketAuthorizationResults,
    refetch: refetchMarketAuthorization,
  } = useReadContracts({
    contracts: marketAuthorizationContracts,
    query: { enabled: Boolean(marketInputToken && connectedAddress && uniswapV3SwapRouterAddress) },
  });
  const marketInputBalance = marketAuthorizationResults?.[0]?.result as bigint | undefined;
  const marketInputAllowance = marketAuthorizationResults?.[1]?.result as bigint | undefined;
  const marketBalanceSufficient = marketRequiredInput !== undefined && marketInputBalance !== undefined &&
    marketInputBalance >= marketRequiredInput;
  const marketAllowanceSufficient = marketRequiredInput !== undefined && marketInputAllowance !== undefined &&
    marketInputAllowance >= marketRequiredInput;
  const marketQuoteReady = Boolean(
    marketLiquidityReady && marketInputAmount && marketQuotedOutput && marketMinimumOutput && !marketQuoteError,
  );
  const marketRouteAvailable = Boolean(
    isRoutedMode &&
    marketLiquidityReady && uniswapV3QuoterAddress && uniswapV3SwapRouterAddress &&
    !(vault.sunset && activeAction === "deposit"),
  );
  const entryBalanceSufficient = entrySettlementInput !== undefined &&
    settlementBalance !== undefined && settlementBalance >= entrySettlementInput;
  const entryAllowanceSufficient = entrySettlementInput !== undefined &&
    settlementAllowance !== undefined && settlementAllowance >= entrySettlementInput;
  const entryBusy = entryState === "pending" || entryState === "submitted";
  const redeemBalanceSufficient = requestedRedeemShares !== undefined && redeemShareBalance !== undefined &&
    redeemShareBalance >= requestedRedeemShares;
  const redeemAllowanceSufficient = requestedRedeemShares !== undefined && redeemShareAllowance !== undefined &&
    redeemShareAllowance >= requestedRedeemShares;
  let redeemQuoteIndex = 0;
  const redeemLegs = vault.allocations.map((asset, index) => {
    const amountIn = previewRedeemAmounts?.[index];
    const isSettlement = Boolean(
      settlementToken && asset.address.toLowerCase() === settlementToken.toLowerCase(),
    );
    let quotedSettlement: bigint | undefined;
    let quoteFailed = false;
    let quoteError: string | undefined;
    if (isSettlement) {
      quotedSettlement = amountIn;
    } else if (amountIn !== undefined && amountIn > 0n) {
      const result = redeemQuoteResults?.[redeemQuoteIndex];
      redeemQuoteIndex += 1;
      const quote = result?.result as readonly [bigint, bigint, number, bigint] | undefined;
      quotedSettlement = quote?.[0];
      quoteFailed = result?.status === "failure";
      quoteError = quoteFailed ? errorMessage(result?.error) : undefined;
    } else if (amountIn === 0n) {
      quotedSettlement = 0n;
    }
    const minimumSettlement = quotedSettlement !== undefined && !isSettlement
      ? quotedSettlement * BigInt(10_000 - redeemSlippageBps) / 10_000n
      : isSettlement ? 0n : undefined;
    return {
      ...asset,
      amountIn,
      isSettlement,
      quotedSettlement,
      minimumSettlement,
      quoteFailed,
      quoteError,
    };
  });
  const redeemBasketReady = Boolean(
    requestedRedeemShares && previewRedeemAmounts?.length === vault.allocations.length,
  );
  const redeemQuoteReady = Boolean(
    redeemBasketReady && settlementToken && redeemLegs.every((leg) =>
      leg.amountIn !== undefined && leg.quotedSettlement !== undefined && leg.minimumSettlement !== undefined,
    ),
  );
  const quotedRedeemSettlement = redeemQuoteReady
    ? redeemLegs.reduce((sum, leg) => sum + (leg.quotedSettlement ?? 0n), 0n)
    : undefined;
  const minimumRedeemSettlement = redeemQuoteReady
    ? redeemLegs.reduce(
        (sum, leg) => sum + (leg.isSettlement ? leg.amountIn ?? 0n : leg.minimumSettlement ?? 0n),
        0n,
      )
    : undefined;
  const normalizedRedeemNavOutput = quotedRedeemSettlement === undefined
    ? undefined
    : isWethMode
      ? undefined
      : quotedRedeemSettlement * 10n ** 18n / 10n ** BigInt(settlementDecimals);
  const redeemBusy = redeemState === "pending" || redeemState === "submitted";
  const marketBusy = marketState === "pending" || marketState === "submitted";
  const inputTokenSymbol = activeAction === "deposit" && isRoutedMode ? settlementSymbol : vault.symbol;
  const inputTokenDecimals = activeAction === "deposit" && isRoutedMode ? settlementDecimals : 18;
  const walletInputBalance = activeAction === "deposit"
    ? isRoutedMode ? settlementBalance : undefined
    : redeemShareBalance;
  const walletInputBalanceLoading = activeAction === "deposit"
    ? isRoutedMode ? entryAuthorizationLoading : basketAuthorizationLoading
    : redeemAuthorizationLoading;
  const showWalletInputBalance = isRoutedMode || activeAction === "redeem";
  const walletInputBalanceLabel = !connectedAddress
    ? "Connect wallet"
    : walletInputBalanceLoading
      ? "Checking..."
      : walletInputBalance === undefined
        ? "Unavailable"
        : `${formatWalletTokenBalance(
            walletInputBalance,
            inputTokenDecimals,
            activeAction === "redeem" ? 12 : 6,
          )} ${inputTokenSymbol}`;
  const ownedSharesLabel = !connectedAddress
    ? "Connect wallet"
    : redeemAuthorizationLoading
      ? "Checking..."
      : redeemShareBalance === undefined
        ? "Unavailable"
        : `${formatWalletTokenBalance(redeemShareBalance, 18, 12)} ${vault.symbol}`;
  const redeemAmountExceedsBalance = activeAction === "redeem" &&
    requestedRedeemShares !== undefined &&
    redeemShareBalance !== undefined &&
    requestedRedeemShares > redeemShareBalance;

  useEffect(() => {
    if (redeemAmountExceedsBalance) setSelectedRoute(undefined);
  }, [redeemAmountExceedsBalance]);

  const routedInputAmount = activeAction === "deposit" ? requestedSettlementAmount : requestedRedeemShares;
  const routeInputsReady = Boolean(isRoutedMode && routedInputAmount && routedInputAmount > 0n && slippageValid);
  const directInputsReady = Boolean(
    !isRoutedMode && slippageValid && (
      activeAction === "deposit" ? requestedDirectMintShares : requestedRedeemShares
    ),
  );
  const activeAdapterApproved = activeAction === "deposit"
    ? entryAdapterApproved
    : exitAdapterApproved;
  const underlyingRouteAvailable = entryContractsConfigured &&
    activeAdapterApproved !== false &&
    constituentRoutesReady &&
    (activeAction === "redeem" || !vaultDepositsBlocked);
  const underlyingRouteChecking = Boolean(
    entryContractsConfigured && constituentRoutesDiscovered && constituentLiquidityLoading,
  );
  const underlyingQuoteReady = activeAction === "deposit"
    ? entryQuoteReady
    : redeemQuoteReady;
  const underlyingQuoteLoading = activeAction === "deposit"
    ? constituentLiquidityLoading || finalPreviewEntryLoading || finalEntryQuotesLoading ||
      exactInputEntryQuotesLoading || entryRefundRateQuotesLoading
    : constituentLiquidityLoading || previewRedeemLoading || redeemQuotesLoading;
  const underlyingQuotedOutput = activeAction === "deposit"
    ? estimatedEntryShares
    : quotedRedeemSettlement;
  const underlyingQuotedSlippageBps = quotedSlippageBps(
    activeAction === "deposit" ? underlyingQuotedOutput : normalizedRedeemNavOutput,
    activeAction === "deposit" ? navEstimatedShares : navRedeemValue,
  );
  const marketQuoteProblem = routeInputsReady && marketRouteAvailable && !marketQuoteLoading && !marketQuoteReady
    ? marketQuoteError
      ? {
          title: "Liquidity-pool quote unavailable",
          detail: `The OTF / ${settlementSymbol} pool rejected this ${activeAction} quote: ${errorMessage(marketQuoteError)}`,
        }
      : {
          title: "Liquidity-pool quote incomplete",
          detail: `The OTF / ${settlementSymbol} pool did not return a usable output for this amount. Try a smaller amount or confirm that the pool has active liquidity.`,
        }
    : undefined;
  const failedUnderlyingLegs = (activeAction === "deposit" ? protectedExactInputEntryLegs : redeemLegs)
    .filter((leg) => leg.quoteFailed);
  const underlyingQuoteProblem = routeInputsReady && underlyingRouteAvailable && !underlyingQuoteLoading && !underlyingQuoteReady
    ? activeAction === "deposit" && finalPreviewEntryError
      ? {
          title: "Basket preview unavailable",
          detail: `The vault could not calculate the RWA amounts needed for this deposit: ${errorMessage(finalPreviewEntryError)}`,
        }
      : activeAction === "redeem" && previewRedeemError
        ? {
            title: "Basket preview unavailable",
            detail: `The vault could not calculate the RWA amounts returned by this redemption: ${errorMessage(previewRedeemError)}`,
          }
        : failedUnderlyingLegs.length > 0
          ? {
              title: `${failedUnderlyingLegs.map((leg) => leg.symbol).join(", ")} pool quote failed`,
              detail: failedUnderlyingLegs
                .map((leg) => `${leg.symbol}: ${leg.quoteError ?? "the constituent pool rejected the quote"}`)
                .join(" "),
            }
          : {
                title: "Underlying quote incomplete",
                detail: "At least one constituent pool did not return a usable quote. Try a smaller amount or check that every RWA pool has active liquidity.",
              }
    : undefined;
  const directQuoteProblem = directInputsReady && !(
    activeAction === "deposit" ? directMintPreviewLoading : previewRedeemLoading
  ) && !(activeAction === "deposit" ? directBasketReady : redeemBasketReady)
    ? activeAction === "deposit" && directMintPreviewError
      ? {
          title: "Basket preview unavailable",
          detail: `The vault could not calculate the RWA amounts needed for this deposit: ${errorMessage(directMintPreviewError)}`,
        }
      : activeAction === "redeem" && previewRedeemError
        ? {
            title: "Basket preview unavailable",
            detail: `The vault could not calculate the RWA amounts returned by this redemption: ${errorMessage(previewRedeemError)}`,
          }
        : {
            title: "Basket preview incomplete",
            detail: `The vault did not return every constituent amount for this ${activeAction}. Try a smaller amount and refresh the quote.`,
          }
    : undefined;

  useEffect(() => {
    if (!routeInputsReady) return;
    if (selectedRoute === "market" && !marketQuoteLoading && !marketQuoteReady) {
      setSelectedRoute(undefined);
    }
    if (selectedRoute === "underlying" && !underlyingQuoteLoading && !underlyingQuoteReady) {
      setSelectedRoute(undefined);
    }
  }, [
    marketQuoteLoading,
    marketQuoteReady,
    routeInputsReady,
    selectedRoute,
    underlyingQuoteLoading,
    underlyingQuoteReady,
  ]);

  async function approveSettlementToken() {
    if (
      !settlementToken ||
      !entryRouterAddress ||
      !publicClient ||
      entrySettlementInput === undefined ||
      settlementAllowance === undefined
    ) return;
    setEntryError(undefined);
    setTradeReceipt(undefined);
    try {
      setEntryState("pending");
      if (settlementAllowance > 0n) {
        const resetHash = await writeContractAsync({
          address: settlementToken,
          abi: erc20BalanceAbi,
          functionName: "approve",
          args: [entryRouterAddress, 0n],
          chainId: robinhoodChainTestnet.id,
        });
        setEntryState("submitted");
        const resetReceipt = await publicClient.waitForTransactionReceipt({ hash: resetHash });
        if (resetReceipt.status !== "success") throw new Error(`The ${settlementSymbol} approval reset reverted.`);
      }
      setEntryState("pending");
      const hash = await writeContractAsync({
        address: settlementToken,
        abi: erc20BalanceAbi,
        functionName: "approve",
        args: [entryRouterAddress, entrySettlementInput],
        chainId: robinhoodChainTestnet.id,
      });
      setEntryState("submitted");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`The ${settlementSymbol} approval reverted.`);
      await refetchEntryAuthorization();
      setEntryState("confirmed");
    } catch (error) {
      setEntryError(errorMessage(error));
      setEntryState("reverted");
    }
  }

  async function enterWithToken() {
    if (
      vaultDepositsBlocked ||
      !vault.address ||
      !connectedAddress ||
      !publicClient ||
      !entryRouterAddress ||
      !entryAdapterAddress ||
      !settlementToken ||
      requestedSettlementAmount === undefined ||
      !minimumEntryShares ||
      !entryQuoteReady ||
      !entryBalanceSufficient ||
      !entryAllowanceSufficient
    ) return;
    const swaps = protectedExactInputEntryLegs.map((leg) => leg.isSettlement
      ? {
          adapter: zeroAddress,
          inputAmount: leg.settlementIn as bigint,
          minAssetOut: leg.settlementIn as bigint,
          minRefundInputRate: 0n,
          adapterData: "0x" as `0x${string}`,
          refundAdapterData: "0x" as `0x${string}`,
        }
      : {
          adapter: entryAdapterAddress,
          inputAmount: leg.settlementIn as bigint,
          minAssetOut: leg.minimumAssetOut as bigint,
          minRefundInputRate: leg.minimumRefundSettlementRate as bigint,
          adapterData: isRegisteredEntryAdapter
            ? exactInputRouteFor(leg.address) ?? "0x"
            : encodeAbiParameters(
                [{ type: "address[]" }],
                [[settlementToken, leg.address as `0x${string}`]],
              ),
          refundAdapterData: isRegisteredEntryAdapter
            ? exactInputRouteFor(leg.address, true) ?? "0x"
            : encodeAbiParameters(
                [{ type: "address[]" }],
                [[leg.address as `0x${string}`, settlementToken]],
              ),
        });
    setEntryError(undefined);
    try {
      setEntryState("pending");
      const hash = await writeContractAsync({
        address: entryRouterAddress,
        abi: otfEntryExitRouterAbi,
        functionName: "enterWithToken",
        args: [
          vault.address,
          settlementToken,
          requestedSettlementAmount,
          minimumEntryShares,
          connectedAddress,
          BigInt(Math.floor(Date.now() / 1_000) + 20 * 60),
          swaps,
        ],
        chainId: robinhoodChainTestnet.id,
      });
      setEntryState("submitted");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`The ${settlementSymbol} entry transaction reverted.`);
      const entryEvents = parseEventLogs({
        abi: otfEntryExitRouterAbi,
        eventName: "EnteredWithToken",
        logs: receipt.logs,
      });
      const mintedShares = entryEvents[0]?.args.shares;
      const settlementRefunded = entryEvents[0]?.args.inputRefunded ?? 0n;
      await Promise.all([
        refetchEntryAuthorization(),
        refetchEntryPreview(),
        refetchEntryQuotes(),
        refetchExactInputEntryQuotes(),
        refetchEntryRefundRateQuotes(),
      ]);
      setEntryState("confirmed");
      setTradeReceipt({
        action: "deposit",
        detail: `${formatWalletTokenBalance(mintedShares, 18)} ${vault.symbol} minted through the underlying asset pools.${settlementRefunded > 0n ? ` ${formatWalletTokenBalance(settlementRefunded, settlementDecimals)} ${settlementSymbol} refunded.` : ""}`,
        transactionHash: hash,
      });
      setTradeAmount("");
    } catch (error) {
      setEntryError(errorMessage(error));
      setEntryState("reverted");
    }
  }

  async function approveBasketAssets() {
    if (vaultDepositsBlocked || !vault.address || !connectedAddress || !publicClient || !directBasketReady) return;
    setEntryError(undefined);
    setTradeReceipt(undefined);
    try {
      for (const leg of directBasketLegs) {
        if (leg.maximumAmount === undefined || leg.allowance === undefined) return;
        if (leg.allowance >= leg.maximumAmount) continue;
        if (leg.allowance > 0n) {
          setEntryState("pending");
          const resetHash = await writeContractAsync({
            address: leg.address as `0x${string}`,
            abi: erc20BalanceAbi,
            functionName: "approve",
            args: [vault.address, 0n],
            chainId: robinhoodChainTestnet.id,
          });
          setEntryState("submitted");
          const resetReceipt = await publicClient.waitForTransactionReceipt({ hash: resetHash });
          if (resetReceipt.status !== "success") throw new Error(`${leg.symbol} approval reset reverted.`);
        }
        setEntryState("pending");
        const approvalHash = await writeContractAsync({
          address: leg.address as `0x${string}`,
          abi: erc20BalanceAbi,
          functionName: "approve",
          args: [vault.address, leg.maximumAmount],
          chainId: robinhoodChainTestnet.id,
        });
        setEntryState("submitted");
        const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash });
        if (approvalReceipt.status !== "success") throw new Error(`${leg.symbol} approval reverted.`);
      }
      await refetchBasketAuthorization();
      setEntryState("confirmed");
    } catch (error) {
      setEntryError(errorMessage(error));
      setEntryState("reverted");
    }
  }

  async function mintWithBasket() {
    if (
      vaultDepositsBlocked ||
      !vault.address || !connectedAddress || !publicClient || !requestedDirectMintShares ||
      !directBasketReady || !directBasketBalanceSufficient || !directBasketAllowanceSufficient
    ) return;
    const maximumAmounts = directBasketLegs.map((leg) => leg.maximumAmount as bigint);
    setEntryError(undefined);
    setTradeReceipt(undefined);
    try {
      setEntryState("pending");
      const hash = await writeContractAsync({
        address: vault.address,
        abi: vaultDepositAbi,
        functionName: "mintWithBasket",
        args: [requestedDirectMintShares, connectedAddress, maximumAmounts],
        chainId: robinhoodChainTestnet.id,
      });
      setEntryState("submitted");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The direct RWA deposit reverted.");
      await Promise.all([
        refetchBasketAuthorization(),
        refetchDirectMintPreview(),
        refetchRedeemAuthorization(),
        refetchOwnedUnderlying(),
      ]);
      setTradeReceipt({
        action: "deposit",
        detail: `${formatWalletTokenBalance(requestedDirectMintShares, 18)} ${vault.symbol} minted from your RWA basket.`,
        transactionHash: hash,
      });
      setTradeAmount("");
      setEntryState("confirmed");
    } catch (error) {
      setEntryError(errorMessage(error));
      setEntryState("reverted");
    }
  }

  async function redeemToBasket() {
    if (
      !vault.address || !connectedAddress || !publicClient || !requestedRedeemShares ||
      !redeemBasketReady || !redeemBalanceSufficient || !previewRedeemAmounts
    ) return;
    const minimumAmounts = previewRedeemAmounts.map(
      (amount) => amount * BigInt(10_000 - slippageBps) / 10_000n,
    );
    setRedeemError(undefined);
    setTradeReceipt(undefined);
    try {
      setRedeemState("pending");
      const hash = await writeContractAsync({
        address: vault.address,
        abi: vaultDepositAbi,
        functionName: "redeem",
        args: [requestedRedeemShares, connectedAddress, connectedAddress, minimumAmounts],
        chainId: robinhoodChainTestnet.id,
      });
      setRedeemState("submitted");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The direct RWA redemption reverted.");
      await Promise.all([
        refetchRedeemAuthorization(),
        refetchRedeemPreview(),
        refetchBasketAuthorization(),
        refetchOwnedUnderlying(),
      ]);
      setTradeReceipt({
        action: "redeem",
        detail: `${formatWalletTokenBalance(requestedRedeemShares, 18)} ${vault.symbol} redeemed directly for the underlying RWAs.`,
        transactionHash: hash,
      });
      setTradeAmount("");
      setRedeemState("confirmed");
    } catch (error) {
      setRedeemError(errorMessage(error));
      setRedeemState("reverted");
    }
  }

  async function approveSharesForSettlementExit() {
    if (!vault.address || !entryRouterAddress || !publicClient || !requestedRedeemShares || redeemShareAllowance === undefined) return;
    setRedeemError(undefined);
    setTradeReceipt(undefined);
    try {
      setRedeemState("pending");
      if (redeemShareAllowance > 0n) {
        const resetHash = await writeContractAsync({
          address: vault.address,
          abi: erc20BalanceAbi,
          functionName: "approve",
          args: [entryRouterAddress, 0n],
          chainId: robinhoodChainTestnet.id,
        });
        setRedeemState("submitted");
        const resetReceipt = await publicClient.waitForTransactionReceipt({ hash: resetHash });
        if (resetReceipt.status !== "success") throw new Error("The OTF share approval reset reverted.");
      }
      setRedeemState("pending");
      const hash = await writeContractAsync({
        address: vault.address,
        abi: erc20BalanceAbi,
        functionName: "approve",
        args: [entryRouterAddress, requestedRedeemShares],
        chainId: robinhoodChainTestnet.id,
      });
      setRedeemState("submitted");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The OTF share approval reverted.");
      await refetchRedeemAuthorization();
      setRedeemState("confirmed");
    } catch (error) {
      setRedeemError(errorMessage(error));
      setRedeemState("reverted");
    }
  }

  async function redeemToToken() {
    if (
      !vault.address || !connectedAddress || !publicClient || !entryRouterAddress || !entryAdapterAddress ||
      !settlementToken || !requestedRedeemShares || !minimumRedeemSettlement || !redeemQuoteReady ||
      !redeemBalanceSufficient || !redeemAllowanceSufficient
    ) return;
    const swaps = redeemLegs.map((leg) => leg.isSettlement
      ? { adapter: zeroAddress, minOutputAmount: 0n, adapterData: "0x" as `0x${string}` }
      : {
          adapter: entryAdapterAddress,
          minOutputAmount: leg.minimumSettlement as bigint,
          adapterData: isRegisteredEntryAdapter
            ? exactInputRouteFor(leg.address, true) ?? "0x"
            : encodeAbiParameters(
                [{ type: "address[]" }],
                [[leg.address as `0x${string}`, settlementToken]],
              ),
        });
    setRedeemError(undefined);
    try {
      setRedeemState("pending");
      const hash = await writeContractAsync({
        address: entryRouterAddress,
        abi: otfEntryExitRouterAbi,
        functionName: "redeemToToken",
        args: [
          vault.address,
          settlementToken,
          requestedRedeemShares,
          connectedAddress,
          minimumRedeemSettlement,
          BigInt(Math.floor(Date.now() / 1_000) + 20 * 60),
          swaps,
        ],
        chainId: robinhoodChainTestnet.id,
      });
      setRedeemState("submitted");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`The ${settlementSymbol} redemption reverted.`);
      await Promise.all([refetchRedeemAuthorization(), refetchRedeemPreview(), refetchRedeemQuotes()]);
      setTradeReceipt({
        action: "redeem",
        detail: `${formatWalletTokenBalance(requestedRedeemShares, 18)} ${vault.symbol} redeemed through the underlying RWA pools.`,
        transactionHash: hash,
      });
      setTradeAmount("");
      setRedeemState("confirmed");
    } catch (error) {
      setRedeemError(errorMessage(error));
      setRedeemState("reverted");
    }
  }

  async function approveMarketInput() {
    if (
      !marketInputToken ||
      !uniswapV3SwapRouterAddress ||
      !marketRequiredInput ||
      !publicClient
    ) return;
    setMarketError(undefined);
    setTradeReceipt(undefined);
    try {
      setMarketState("pending");
      if ((marketInputAllowance ?? 0n) > 0n) {
        const resetHash = await writeContractAsync({
          address: marketInputToken,
          abi: erc20BalanceAbi,
          functionName: "approve",
          args: [uniswapV3SwapRouterAddress, 0n],
          chainId: robinhoodChainTestnet.id,
        });
        setMarketState("submitted");
        const resetReceipt = await publicClient.waitForTransactionReceipt({ hash: resetHash });
        if (resetReceipt.status !== "success") throw new Error("The market approval reset reverted.");
      }
      setMarketState("pending");
      const hash = await writeContractAsync({
        address: marketInputToken,
        abi: erc20BalanceAbi,
        functionName: "approve",
        args: [uniswapV3SwapRouterAddress, marketRequiredInput],
        chainId: robinhoodChainTestnet.id,
      });
      setMarketState("submitted");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The market approval reverted.");
      await refetchMarketAuthorization();
      setMarketState("confirmed");
    } catch (error) {
      setMarketError(errorMessage(error));
      setMarketState("reverted");
    }
  }

  async function executeMarketTrade() {
    if (
      !uniswapV3SwapRouterAddress ||
      !vault.address ||
      !settlementToken ||
      !marketInputToken ||
      !marketOutputToken ||
      !connectedAddress ||
      !publicClient ||
      !marketInputAmount ||
      !marketMinimumOutput ||
      !marketQuoteReady ||
      !marketBalanceSufficient ||
      !marketAllowanceSufficient
    ) return;
    const executionAction = activeAction;
    const executionAmount = formatWalletTokenBalance(marketInputAmount, inputTokenDecimals);
    const executionSymbol = inputTokenSymbol;
    setMarketError(undefined);
    setTradeReceipt(undefined);
    try {
      setMarketState("pending");
      const hash = await writeContractAsync({
        address: uniswapV3SwapRouterAddress,
        abi: uniswapV3SwapRouterAbi,
        functionName: "exactInputSingle",
        args: [{
          tokenIn: marketInputToken,
          tokenOut: marketOutputToken,
          fee: marketFee!,
          recipient: connectedAddress,
          amountIn: marketInputAmount,
          amountOutMinimum: marketMinimumOutput,
          sqrtPriceLimitX96: 0n,
        }],
        chainId: robinhoodChainTestnet.id,
      });
      setMarketState("submitted");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The open-market trade reverted.");
      await Promise.all([refetchMarketAuthorization(), refetchMarketQuote()]);
      setTradeReceipt({
        action: executionAction,
        detail: `${executionAmount} ${executionSymbol} executed through the ${vault.symbol} pool.`,
        transactionHash: hash,
      });
      setTradeAmount("");
      setMarketState("confirmed");
    } catch (error) {
      setMarketError(errorMessage(error));
      setMarketState("reverted");
    }
  }

  function updateTradeAmount(nextAmount: string) {
    setTradeAmount(nextAmount);
    setTradeReceipt(undefined);
    setEntryState("idle");
    setRedeemState("idle");
    setMarketState("idle");
    setEntryError(undefined);
    setRedeemError(undefined);
    setMarketError(undefined);
  }

  function useMaximumAmount() {
    if (walletInputBalance === undefined || walletInputBalance <= 0n) return;
    updateTradeAmount(formatUnits(walletInputBalance, inputTokenDecimals));
  }

  function changeAction(nextAction: "deposit" | "redeem") {
    if (nextAction === activeAction) return;
    setActiveAction(nextAction);
    setTradeAmount("");
    setSelectedRoute(undefined);
    setTradeReceipt(undefined);
    setEntryState("idle");
    setRedeemState("idle");
    setMarketState("idle");
    setEntryError(undefined);
    setRedeemError(undefined);
    setMarketError(undefined);
  }

  function changeSettlementMode(nextMode: RoutedSettlementMode | "rwas") {
    if (nextMode === settlementMode) return;
    setSettlementMode(nextMode);
    setTradeAmount("");
    setSelectedRoute(undefined);
    setTradeReceipt(undefined);
    setEntryState("idle");
    setRedeemState("idle");
    setMarketState("idle");
    setEntryError(undefined);
    setRedeemError(undefined);
    setMarketError(undefined);
  }

  return (
    <SectionCard
      title="Your position"
      subtitle={isRoutedMode
        ? activeAction === "deposit" ? `Buy ${vault.symbol} with ${settlementSymbol}` : `Redeem ${vault.symbol} for ${settlementSymbol}`
        : activeAction === "deposit" ? `Mint ${vault.symbol} with the underlying basket` : `Receive the underlying basket directly`}
      icon={<Wallet size={15} />}
    >
      <div className="positionTradeTicket">
        <div className="positionOwnershipSummary">
          <span>Your shares</span>
          <strong>{ownedSharesLabel}</strong>
        </div>
        <div className="positionUnderlyingTableWrap">
          <table className="positionUnderlyingTable">
            <thead>
              <tr>
                <th>Underlying</th>
                <th>Per OTF share</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {vault.allocations.map((asset, index) => {
                const decimals = directBasketLegs[index]?.decimals ?? 18;
                const perShareAmount = perShareUnderlyingAmounts?.[index];
                const ownedAmount = ownedUnderlyingAmounts?.[index];
                return (
                  <tr key={asset.address}>
                    <td data-label="Underlying"><span className="assetNameWithLogo"><AssetLogo logoUrl={asset.logoUrl} symbol={asset.symbol} compact /><strong>{asset.symbol}</strong></span></td>
                    <td data-label="Per OTF share">{perShareUnderlyingLoading ? "Loading" : formatWalletTokenBalance(perShareAmount, decimals, 8)}</td>
                    <td data-label="Amount">
                      {!connectedAddress
                        ? "Connect wallet"
                        : redeemShareBalance === 0n
                          ? "0"
                          : ownedUnderlyingLoading
                            ? "Loading"
                            : formatWalletTokenBalance(ownedAmount, decimals, 8)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="positionTicketControls">
          <div className="positionActionSelector" role="tablist" aria-label="OTF position action">
            <button
              className={activeAction === "deposit" ? "active" : ""}
              type="button"
              aria-pressed={activeAction === "deposit"}
              disabled={vault.sunset}
              onClick={() => changeAction("deposit")}
            >
              Deposit
            </button>
            <button
              className={activeAction === "redeem" ? "active" : ""}
              type="button"
              aria-pressed={activeAction === "redeem"}
              onClick={() => changeAction("redeem")}
            >
              Redeem
            </button>
          </div>
          <div className="positionSettlementControl">
            <span>Settle in</span>
            <div className="positionSettlementSelector" role="radiogroup" aria-label="Deposit and redemption asset mode">
              <button
                className={settlementMode === "usdg" ? "active" : ""}
                type="button"
                role="radio"
                aria-checked={settlementMode === "usdg"}
                onClick={() => changeSettlementMode("usdg")}
              >
                USDG
              </button>
              <button
                className={settlementMode === "weth" ? "active" : ""}
                type="button"
                role="radio"
                aria-checked={settlementMode === "weth"}
                disabled={!configuredEntryRouterAddress("weth") || !configuredEntryAdapterAddress("weth") || !configuredSettlementTokenAddress("weth")}
                title={!configuredEntryRouterAddress("weth") ? "WETH settlement is not deployed on this network" : undefined}
                onClick={() => changeSettlementMode("weth")}
              >
                WETH
              </button>
              <button
                className={settlementMode === "rwas" ? "active" : ""}
                type="button"
                role="radio"
                aria-checked={settlementMode === "rwas"}
                onClick={() => changeSettlementMode("rwas")}
              >
                RWAs
              </button>
            </div>
          </div>
        </div>

        <div className={`validationSummary ${vaultAssetsVerified ? "success" : "warning"}`} role="status">
            {vaultAssetsVerified ? <ShieldCheck size={15} /> : <Info size={15} />}
            <div>
              <strong>{vaultAssetsVerified ? "Verified assets" : "Unverified assets"}</strong>
              <span>{vaultAssetsVerified
                ? "Every current constituent appears in the verified asset registry."
                : "At least one current constituent does not appear in the verified asset registry. This does not change contract permissions."}</span>
            </div>
          </div>

        {vault.sunset ? (
          <div className="validationSummary danger" role="status">
            <Sun size={15} />
            <div><strong>New positions are closed</strong><span>This OTF is in permanent wind-down mode. Proportional redemptions remain available.</span></div>
          </div>
        ) : vault.depositPauseStatusUnavailable && activeAction === "deposit" ? (
          <div className="validationSummary warning" role="status">
            <RefreshCw size={15} />
            <div>
              <strong>Deposit-pause status unavailable</strong>
              <span>Primary contribution routes stay disabled until both the global and per-OTF pause states can be verified. Redemptions remain available.</span>
            </div>
          </div>
        ) : (vault.protocolDepositsPaused || vault.vaultDepositsPaused) && activeAction === "deposit" ? (
          <div className="validationSummary warning" role="status">
            <ShieldCheck size={15} />
            <div>
              <strong>{vault.protocolDepositsPaused && vault.vaultDepositsPaused
                ? "Deposits paused protocol-wide and for this OTF"
                : vault.protocolDepositsPaused
                  ? "Deposits paused protocol-wide"
                  : "Deposits paused for this OTF"}</strong>
              <span>Primary contribution and mint routes are temporarily disabled. Redemptions, transfers, strategy operations, challenges, and fee accrual remain available.</span>
            </div>
          </div>
        ) : null}

        <div className="positionTicketInputs">
          <label>
            <span className="positionFieldHeading">
              <span>
                {activeAction === "deposit" && isRoutedMode
                  ? `${settlementSymbol} to spend`
                  : !isRoutedMode && activeAction === "deposit"
                    ? "Shares to mint"
                    : `${inputTokenSymbol} amount`}
              </span>
              {showWalletInputBalance ? <span className="positionWalletBalance">Balance: {walletInputBalanceLabel}</span> : null}
            </span>
            <div className="positionAmountInput">
              <input
                value={tradeAmount}
                onChange={(event) => updateTradeAmount(event.target.value)}
                type="number"
                min="0"
                inputMode="decimal"
                placeholder="0.00"
                aria-label={activeAction === "deposit" && isRoutedMode ? `${settlementSymbol} to spend` : `${inputTokenSymbol} amount`}
                disabled={!isLive || entryBusy || redeemBusy || marketBusy}
              />
              {isRoutedMode || activeAction === "redeem" ? (
                <button
                  className="positionMaxButton"
                  type="button"
                  disabled={
                    !isLive ||
                    entryBusy ||
                    redeemBusy ||
                    marketBusy ||
                    walletInputBalance === undefined ||
                    walletInputBalance <= 0n
                  }
                  onClick={useMaximumAmount}
                  aria-label={`Use maximum ${inputTokenSymbol} balance`}
                >
                  Max
                </button>
              ) : null}
              <strong>{inputTokenSymbol}</strong>
            </div>
          </label>
          <label>
            <span>Maximum slippage</span>
            <div className="positionSlippageInput">
              <input
                value={maxSlippage}
                onChange={(event) => {
                  setMaxSlippage(event.target.value);
                  setTradeReceipt(undefined);
                  setEntryState("idle");
                  setRedeemState("idle");
                  setMarketState("idle");
                }}
                type="text"
                inputMode="decimal"
                disabled={entryBusy || redeemBusy || marketBusy}
              />
              <strong>%</strong>
            </div>
          </label>
        </div>

        {!slippageValid ? (
          <span className="fieldError">Enter a slippage limit between 0.01% and 20%.</span>
        ) : null}

        {redeemAmountExceedsBalance ? (
          <div className="validationSummary danger" role="alert">
            <AlertTriangle size={15} />
            <div>
              <strong>Insufficient OTF shares</strong>
              <span>Enter no more than {formatWalletTokenBalance(redeemShareBalance, 18, 12)} {vault.symbol}, or choose Max.</span>
            </div>
          </div>
        ) : null}

        {routeInputsReady ? (
          <div className="positionRouteStage">
            <div className="positionRouteHeading">
              <strong>Choose how to execute</strong>
              <span>
                {activeAction === "deposit"
                  ? `Compare estimated shares for the same ${settlementSymbol} spend.`
                  : `Compare estimated ${settlementSymbol} proceeds for the same OTF shares.`}
              </span>
            </div>
            <div className="positionRouteChoices" role="radiogroup" aria-label="Execution route">
              <button
                className={`positionRouteOption ${selectedRoute === "market" ? "selected" : ""}`}
                type="button"
                role="radio"
                aria-checked={selectedRoute === "market"}
                disabled={!marketRouteAvailable || marketQuoteLoading || !marketQuoteReady || redeemAmountExceedsBalance}
                onClick={() => setSelectedRoute("market")}
              >
                <span className="positionRouteIcon"><Droplets size={18} /></span>
                <span className="positionRouteName">Liquidity pool</span>
                <strong className="positionRouteQuote">
                  {marketPoolChecking
                    ? <Loader2 className="spin" size={18} />
                    : !marketRouteAvailable
                      ? "Unavailable"
                      : marketQuoteLoading
                        ? <Loader2 className="spin" size={18} />
                        : !marketQuoteReady
                          ? "No quote"
                          : marketQuotedOutput
                            ? formatWalletTokenBalance(
                                marketQuotedOutput,
                                activeAction === "deposit" ? 18 : settlementDecimals,
                              )
                            : "—"}
                </strong>
                <small>
                  {!marketRouteAvailable
                    ? marketLiquidityReady ? "V3 trade route is not configured" : `No funded OTF / ${settlementSymbol} pool`
                    : marketQuoteProblem
                      ? marketQuoteProblem.title
                    : activeAction === "deposit"
                      ? `${vault.symbol} shares bought`
                      : "USDG received"}
                </small>
              </button>

              <button
                className={`positionRouteOption ${selectedRoute === "underlying" ? "selected" : ""}`}
                type="button"
                role="radio"
                aria-checked={selectedRoute === "underlying"}
                disabled={!underlyingRouteAvailable || underlyingQuoteLoading || !underlyingQuoteReady || redeemAmountExceedsBalance}
                onClick={() => setSelectedRoute("underlying")}
              >
                <span className="positionRouteIcon"><Landmark size={18} /></span>
                <span className="positionRouteName">Underlying RWA pools</span>
                <strong className="positionRouteQuote">
                  {underlyingRouteChecking
                    ? <Loader2 className="spin" size={18} />
                    : !underlyingRouteAvailable
                    ? "Unavailable"
                    : underlyingQuoteLoading
                      ? <Loader2 className="spin" size={18} />
                      : !underlyingQuoteReady
                        ? "No quote"
                        : underlyingQuotedOutput
                          ? formatWalletTokenBalance(
                              underlyingQuotedOutput,
                              activeAction === "deposit" ? 18 : settlementDecimals,
                            )
                          : "—"}
                </strong>
                <small>
                  {!entryContractsConfigured || activeAdapterApproved === false
                    ? "Settlement route not configured"
                    : activeAction === "deposit" && vault.sunset
                      ? "OTF sunset — new positions closed"
                    : activeAction === "deposit" && vault.depositPauseStatusUnavailable
                      ? "Checking deposit-pause status"
                    : activeAction === "deposit" && vault.protocolDepositsPaused
                      ? "Deposits paused protocol-wide"
                    : activeAction === "deposit" && vault.vaultDepositsPaused
                      ? "Deposits paused for this OTF"
                    : activeAction === "deposit" && depositsPausedForAssetRemoval
                      ? "Paused while an asset is removed"
                    : constituentLiquidityLoading
                      ? "Discovering V3 liquidity routes"
                      : !constituentRoutesDiscovered
                        ? "No V3 route found for every constituent"
                      : constituentLiquidityReadFailed
                        ? "Could not verify constituent liquidity"
                      : emptyConstituentPoolSymbols.length
                        ? `${emptyConstituentPoolSymbols.join(", ")} pool${emptyConstituentPoolSymbols.length === 1 ? " has" : "s have"} no active liquidity`
                      : !constituentRoutesReady
                        ? "Constituent liquidity unavailable"
                    : underlyingQuoteProblem
                      ? underlyingQuoteProblem.title
                    : activeAction === "deposit"
                      ? `${vault.symbol} shares minted`
                      : `${settlementSymbol} received`}
                </small>
              </button>
            </div>
            {marketQuoteProblem ? (
              <div className="validationSummary warning" role="status">
                <AlertTriangle size={15} />
                <div><strong>{marketQuoteProblem.title}</strong><span>{marketQuoteProblem.detail}</span></div>
              </div>
            ) : null}
            {underlyingQuoteProblem ? (
              <div className="validationSummary warning" role="status">
                <AlertTriangle size={15} />
                <div><strong>{underlyingQuoteProblem.title}</strong><span>{underlyingQuoteProblem.detail}</span></div>
              </div>
            ) : null}
          </div>
        ) : !isRoutedMode && directInputsReady ? null : tradeReceipt ? (
          <div className="positionTradeSuccess" role="status" aria-live="polite">
            <span className="positionTradeSuccessMark" aria-hidden="true">
              <Check size={20} strokeWidth={2.6} />
            </span>
            <div className="positionTradeSuccessCopy">
              <strong>{tradeReceipt.action === "deposit" ? "Deposit confirmed" : "Redemption confirmed"}</strong>
              <span>{tradeReceipt.detail}</span>
            </div>
            <a
              className="positionTradeSuccessLink"
              href={`${robinhoodChainTestnet.blockExplorers.default.url}/tx/${tradeReceipt.transactionHash}`}
              target="_blank"
              rel="noreferrer"
            >
              View transaction
              <ExternalLink size={13} />
            </a>
          </div>
        ) : (
          <div className="positionRoutePrompt">
            <ArrowDownToLine size={17} />
            <div>
              <strong>{isRoutedMode ? activeAction === "deposit" ? `Enter a ${settlementSymbol} amount to compare routes` : "Enter an amount to compare routes" : "Enter shares to preview the asset basket"}</strong>
              <span>
                {isRoutedMode
                  ? activeAction === "deposit"
                    ? `Both routes spend the entered ${inputTokenSymbol} amount and protect you with a minimum share output.`
                    : `Both execution paths use the same ${inputTokenSymbol} amount and slippage limit.`
                  : activeAction === "deposit"
                    ? `You will supply each underlying asset required to mint ${vault.symbol}.`
                    : "You will receive each underlying asset directly in your wallet."}
              </span>
            </div>
          </div>
        )}

        {!isRoutedMode && directInputsReady ? (
          <div className="positionExecutionPanel">
            <div className="positionExecutionHeader">
              <div>
                <span className="positionRouteIcon"><Landmark size={16} /></span>
                <div>
                  <strong>Direct RWA basket</strong>
                  <span>
                    {activeAction === "deposit"
                      ? `Supply the proportional basket and mint ${vault.symbol}.`
                      : `Burn ${vault.symbol} and receive every constituent directly.`}
                  </span>
                </div>
              </div>
              <span className="stateBadge success">RWAs</span>
            </div>

            <div className="positionBasketPreview">
              <div className="positionBasketHeader">
                <span>Asset</span>
                <span>{activeAction === "deposit" ? "Required" : "Expected"}</span>
                <span>{activeAction === "deposit" ? "Wallet" : "Minimum"}</span>
              </div>
              {vault.allocations.map((asset, index) => {
                const leg = directBasketLegs[index];
                const decimals = leg?.decimals ?? 18;
                const previewAmount = activeAction === "deposit"
                  ? leg?.requiredAmount
                  : previewRedeemAmounts?.[index];
                const redeemPreviewAmount = previewRedeemAmounts?.[index];
                const minimumAmount = redeemPreviewAmount !== undefined
                  ? (redeemPreviewAmount * BigInt(10_000 - slippageBps)) / 10_000n
                  : undefined;
                const walletSufficient = activeAction !== "deposit" || (
                  leg?.balance !== undefined && leg.requiredAmount !== undefined && leg.balance >= leg.requiredAmount
                );
                return (
                  <div className="positionBasketRow" key={asset.address}>
                    <span className="assetNameWithLogo"><AssetLogo logoUrl={asset.logoUrl} symbol={asset.symbol} compact /><strong>{asset.symbol}</strong></span>
                    <span>{formatWalletTokenBalance(previewAmount, decimals, 8)}</span>
                    <span className={walletSufficient ? "" : "dangerText"}>
                      {activeAction === "deposit"
                        ? formatWalletTokenBalance(leg?.balance, decimals, 8)
                        : formatWalletTokenBalance(minimumAmount, decimals, 8)}
                    </span>
                  </div>
                );
              })}
            </div>

            {directQuoteProblem ? (
              <div className="validationSummary danger">
                <AlertTriangle size={15} />
                <div><strong>{directQuoteProblem.title}</strong><span>{directQuoteProblem.detail}</span></div>
              </div>
            ) : null}
            {activeAction === "deposit" && directBasketReady && !directBasketBalanceSufficient ? (
              <div className="validationSummary danger">
                <AlertTriangle size={15} />
                <div><strong>Insufficient RWA balance</strong><span>Your wallet needs every asset shown in the required column.</span></div>
              </div>
            ) : null}
            {activeAction === "redeem" && requestedRedeemShares && !redeemBalanceSufficient ? (
              <div className="validationSummary danger">
                <AlertTriangle size={15} />
                <div><strong>Insufficient OTF shares</strong><span>Your wallet does not hold the requested share amount.</span></div>
              </div>
            ) : null}
            {(activeAction === "deposit" ? entryError : redeemError) ? (
              <div className="validationSummary danger">
                <AlertTriangle size={15} />
                <div>
                  <strong>{activeAction === "deposit" ? "Direct deposit failed" : "Direct redemption failed"}</strong>
                  <span>{activeAction === "deposit" ? entryError : redeemError}</span>
                </div>
              </div>
            ) : null}
            <TxStatus state={activeAction === "deposit" ? entryState : redeemState} />
            <div className="buttonRow">
              {activeAction === "deposit" ? (
                <>
                  <button
                    className="secondaryAction"
                    type="button"
                    disabled={!connectedAddress || entryBusy || directMintPreviewLoading || !directBasketReady || !directBasketBalanceSufficient || directBasketAllowanceSufficient}
                    onClick={approveBasketAssets}
                  >
                    <ShieldCheck size={14} />
                    {directBasketAllowanceSufficient ? "RWAs approved" : "Approve RWAs"}
                  </button>
                  <button
                    className="primaryAction"
                    type="button"
                    disabled={!connectedAddress || entryBusy || !directBasketReady || !directBasketBalanceSufficient || !directBasketAllowanceSufficient}
                    onClick={mintWithBasket}
                  >
                    {entryBusy ? <Loader2 className="spin" size={14} /> : <ArrowDownToLine size={14} />}
                    Mint {vault.symbol}
                  </button>
                </>
              ) : (
                <button
                  className="dangerAction"
                  type="button"
                  disabled={!connectedAddress || redeemBusy || previewRedeemLoading || !redeemBasketReady || !redeemBalanceSufficient}
                  onClick={redeemToBasket}
                >
                  {redeemBusy ? <Loader2 className="spin" size={14} /> : <ArrowRight size={14} />}
                  Redeem for RWAs
                </button>
              )}
            </div>
            <div className="routeExecutionNote">
              <Info size={14} />
              <span>No swaps are used. Amounts come directly from or go directly into the OTF vault.</span>
            </div>
          </div>
        ) : null}

        {selectedRoute === "market" && routeInputsReady ? (
          <div className="positionExecutionPanel">
            <div className="positionExecutionHeader">
              <div>
                <span className="positionRouteIcon"><Droplets size={16} /></span>
                <div>
                  <strong>Liquidity pool</strong>
                  <span>{activeAction === "deposit" ? `Buy existing shares from the OTF / ${settlementSymbol} pool.` : `Sell shares into the OTF / ${settlementSymbol} pool.`}</span>
                </div>
              </div>
              <span className="stateBadge success">Selected</span>
            </div>
            <div className="positionExecutionQuote positionExecutionQuoteFour">
              <div>
                <span>{activeAction === "deposit" ? "USDG spent" : "Shares sold"}</span>
                <strong>
                  {marketInputAmount
                    ? formatWalletTokenBalance(marketInputAmount, inputTokenDecimals)
                    : "—"} {inputTokenSymbol}
                </strong>
              </div>
              <div>
                <span>{activeAction === "deposit" ? "Estimated shares" : "Estimated proceeds"}</span>
                <strong>
                  {marketQuotedOutput
                    ? formatWalletTokenBalance(
                        marketQuotedOutput,
                        activeAction === "deposit" ? 18 : settlementDecimals,
                      )
                    : "—"} {activeAction === "deposit" ? vault.symbol : "USDG"}
                </strong>
              </div>
              <div>
                <span>{activeAction === "deposit" ? "Minimum shares" : "Minimum received"}</span>
                <strong>
                  {marketMinimumOutput
                    ? formatWalletTokenBalance(
                        marketMinimumOutput,
                        activeAction === "deposit" ? 18 : settlementDecimals,
                      )
                    : "—"} {activeAction === "deposit" ? vault.symbol : "USDG"}
                </strong>
              </div>
              <div>
                <span>Quoted slippage vs NAV</span>
                <strong>{formatQuotedSlippage(marketQuotedSlippageBps)}</strong>
              </div>
            </div>
            {marketRequiredInput && !marketBalanceSufficient ? (
              <div className="validationSummary danger">
                <AlertTriangle size={15} />
                <div><strong>Insufficient balance</strong><span>Your wallet does not hold enough {activeAction === "deposit" ? "USDG" : vault.symbol} for this route.</span></div>
              </div>
            ) : null}
            {marketError ? (
              <div className="validationSummary danger">
                <AlertTriangle size={15} />
                <div><strong>Open-market trade failed</strong><span>{marketError}</span></div>
              </div>
            ) : null}
            <TxStatus state={marketState} />
            <div className="buttonRow">
              <button
                className="secondaryAction"
                type="button"
                disabled={marketBusy || !marketQuoteReady || !marketBalanceSufficient || marketAllowanceSufficient}
                onClick={approveMarketInput}
              >
                <ShieldCheck size={14} />
                {marketAllowanceSufficient ? "Approved" : `Approve ${activeAction === "deposit" ? "USDG" : vault.symbol}`}
              </button>
              <button
                className={activeAction === "deposit" ? "primaryAction" : "dangerAction"}
                type="button"
                disabled={marketBusy || !marketQuoteReady || !marketBalanceSufficient || !marketAllowanceSufficient}
                onClick={executeMarketTrade}
              >
                {marketBusy ? <Loader2 className="spin" size={14} /> : activeAction === "deposit" ? <ArrowDownToLine size={14} /> : <ArrowRight size={14} />}
                {activeAction === "deposit" ? `Buy ${vault.symbol}` : `Redeem for USDG`}
              </button>
            </div>
            <div className="routeExecutionNote">
              <Info size={14} />
              <span>The open-market price comes from the direct OTF / {settlementSymbol} pool and can differ from portfolio value.</span>
            </div>
          </div>
        ) : null}

        {selectedRoute === "underlying" && routeInputsReady ? (
          <div className="positionExecutionPanel">
            <div className="positionExecutionHeader">
              <div>
                <span className="positionRouteIcon"><Landmark size={16} /></span>
                <div>
                  <strong>Underlying RWA pools</strong>
                  <span>
                    {activeAction === "deposit"
                      ? `Spend ${settlementSymbol} across the portfolio pools and mint a proportional basket.`
                      : `Burn OTF shares and sell the portfolio assets for ${settlementSymbol}.`}
                  </span>
                </div>
              </div>
              <span className="stateBadge success">Selected</span>
            </div>

            {activeAction === "deposit" ? (
              <>
                <div className="positionExecutionQuote positionExecutionQuoteFour">
                  <div><span>{settlementSymbol} supplied</span><strong>{requestedSettlementAmount !== undefined ? formatWalletTokenBalance(requestedSettlementAmount, settlementDecimals) : "—"} {settlementSymbol}</strong></div>
                  <div><span>Estimated shares</span><strong>{estimatedEntryShares ? formatWalletTokenBalance(estimatedEntryShares, 18) : "—"} {vault.symbol}</strong></div>
                  <div><span>Minimum shares</span><strong>{minimumEntryShares ? formatWalletTokenBalance(minimumEntryShares, 18) : "—"} {vault.symbol}</strong></div>
                  <div><span>Quoted slippage vs NAV</span><strong>{formatQuotedSlippage(underlyingQuotedSlippageBps)}</strong></div>
                </div>
                {entryQuoteReady && !entryBalanceSufficient ? (
                  <div className="validationSummary danger">
                    <AlertTriangle size={15} />
                    <div><strong>Insufficient {settlementSymbol}</strong><span>Your wallet balance is below this route&apos;s maximum spend.</span></div>
                  </div>
                ) : null}
                {entryError ? (
                  <div className="validationSummary danger">
                    <AlertTriangle size={15} />
                    <div><strong>Underlying entry failed</strong><span>{entryError}</span></div>
                  </div>
                ) : null}
                <TxStatus state={entryState} />
                <div className="buttonRow">
                  <button
                    className="secondaryAction"
                    type="button"
                    disabled={entryBusy || !underlyingQuoteReady || !entryBalanceSufficient || entryAllowanceSufficient}
                    onClick={approveSettlementToken}
                  >
                    <ShieldCheck size={14} />
                    {entryAllowanceSufficient ? `${settlementSymbol} approved` : `Approve ${settlementSymbol}`}
                  </button>
                  <button
                    className="primaryAction"
                    type="button"
                    disabled={entryBusy || !underlyingQuoteReady || !entryBalanceSufficient || !entryAllowanceSufficient}
                    onClick={enterWithToken}
                  >
                    {entryBusy ? <Loader2 className="spin" size={14} /> : <ArrowDownToLine size={14} />}
                    Mint {vault.symbol}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="positionExecutionQuote positionExecutionQuoteFour">
                  <div><span>Shares redeemed</span><strong>{requestedRedeemShares ? formatWalletTokenBalance(requestedRedeemShares, 18) : "—"} {vault.symbol}</strong></div>
                  <div><span>Expected proceeds</span><strong>{quotedRedeemSettlement !== undefined ? formatWalletTokenBalance(quotedRedeemSettlement, settlementDecimals) : "—"} {settlementSymbol}</strong></div>
                  <div><span>Minimum received</span><strong>{minimumRedeemSettlement !== undefined ? formatWalletTokenBalance(minimumRedeemSettlement, settlementDecimals) : "—"} {settlementSymbol}</strong></div>
                  <div><span>Quoted slippage vs NAV</span><strong>{formatQuotedSlippage(underlyingQuotedSlippageBps)}</strong></div>
                </div>
                {requestedRedeemShares && !redeemBalanceSufficient ? (
                  <div className="validationSummary danger">
                    <AlertTriangle size={15} />
                    <div><strong>Insufficient OTF shares</strong><span>Your wallet balance is below the amount required for this route.</span></div>
                  </div>
                ) : null}
                {redeemError ? (
                  <div className="validationSummary danger">
                    <AlertTriangle size={15} />
                    <div><strong>Underlying redemption failed</strong><span>{redeemError}</span></div>
                  </div>
                ) : null}
                <TxStatus state={redeemState} />
                <div className="buttonRow">
                  <button
                    className="secondaryAction"
                    type="button"
                    disabled={redeemBusy || !underlyingQuoteReady || !redeemBalanceSufficient || redeemAllowanceSufficient}
                    onClick={approveSharesForSettlementExit}
                  >
                    <ShieldCheck size={14} />
                    {redeemAllowanceSufficient ? "Shares approved" : `Approve ${vault.symbol}`}
                  </button>
                  <button
                    className="dangerAction"
                    type="button"
                    disabled={redeemBusy || !underlyingQuoteReady || !minimumRedeemSettlement || !redeemBalanceSufficient || !redeemAllowanceSufficient}
                    onClick={redeemToToken}
                  >
                    {redeemBusy ? <Loader2 className="spin" size={14} /> : <ArrowRight size={14} />}
                    Redeem for {settlementSymbol}
                  </button>
                </div>
              </>
            )}

            <div className="routeExecutionNote">
              <Info size={14} />
              <span>
                {activeAction === "deposit"
                  ? `The OTF receives only a proportional basket. Surplus tokens are sold back under your slippage limit and refunded as ${settlementSymbol}.`
                  : `Underlying execution uses live V3 pools discovered from the canonical factory. Final ${settlementSymbol} depends on liquidity and price impact.`}
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}

function configuredUniswapV3SwapRouterAddress(): `0x${string}` | undefined {
  return robinhoodTestnetAddresses.uniswapV3SwapRouter;
}

function configuredUniswapV3QuoterAddress(): `0x${string}` | undefined {
  return robinhoodTestnetAddresses.uniswapV3Quoter;
}

function TxStatus({ state, persistent = false }: { state: TxState; persistent?: boolean }) {
  if (state === "idle" && !persistent) return null;
  const status = txStateLabel(state);
  return (
    <div className={`txStatus ${status.tone} ${persistent ? "persistent" : ""}`}>
      {persistent ? <span>Status</span> : null}
      <strong>
        {state === "pending" || state === "submitted" || state === "simulating" ? <Loader2 size={13} className="spin" /> : null}
        {state === "confirmed" || state === "ready" ? <CheckCircle size={13} /> : null}
        {state === "reverted" ? <XCircle size={13} /> : null}
        {status.label}
      </strong>
    </div>
  );
}

function PortfolioBandStatus({
  vault,
  context,
  proposalCooldownRemaining = 0,
}: {
  vault: VaultView;
  context: "targets" | "rebalance" | "fees";
  proposalCooldownRemaining?: number;
}) {
  const completionBand = bpsToPercent(vault.maxWeightDeviationBps);
  const withinBands = vault.withinCompletionBands;
  const beyondChallengeBands = !vault.withinChallengeBands;
  const targetProposalBlockers = context === "targets"
    ? [
        vault.challengeActive
          ? "Resolve the active challenge before proposing new targets."
          : undefined,
        vault.strategyProposalPending
          ? "Activate or cancel the pending target proposal first."
          : undefined,
        vault.strategicRebalanceActive
          ? "Complete the active strategic rebalance first."
          : undefined,
        proposalCooldownRemaining > 0
          ? `The strategy cooldown ends in ${formatCooldown(proposalCooldownRemaining)}, on ${formatTimestamp(vault.nextStrategyChange)}.`
          : undefined,
        !withinBands
          ? `Return every constituent to within ${completionBand} of its active target.`
          : undefined,
      ].filter((reason): reason is string => Boolean(reason))
    : [];
  if (context === "targets" && vault.dataMode === "live" && !vault.canProposeStrategy && targetProposalBlockers.length === 0) {
    targetProposalBlockers.push("Target proposals are not currently available. Refresh the onchain data to check the latest strategy state.");
  }
  const status = context === "rebalance"
    ? withinBands
      ? {
          title: "Portfolio is healthy — rebalance optional",
          detail: "Every constituent is within its target band.",
          tone: "success",
        }
      : {
          title: "Portfolio is outside target bands",
          detail: `At least one constituent is more than ${completionBand} from its target. Rebalance toward the active weights before the current strategy can complete.`,
          tone: "warning",
        }
    : context === "targets"
      ? targetProposalBlockers.length === 0
        ? {
            title: "Portfolio is ready for a target proposal",
            detail: "The portfolio is within its completion bands, the cooldown has ended, and no challenge or strategy change is active.",
            tone: "success",
          }
        : {
            title: "Target proposals are currently blocked",
            detail: targetProposalBlockers.join(" "),
            tone: vault.challengeActive ? "danger" : "warning",
          }
      : !vault.challengeActive
        ? beyondChallengeBands
          ? {
              title: "Fees are withdrawable; this also opens a challenge",
              detail: `Fees earned before the challenge are paid normally. This withdrawal records the ${bpsToPercent(vault.challengeWeightDeviationBps)} challenge-band breach, after which new fees are escrowed until recovery.`,
              tone: "warning",
            }
          : {
              title: "Manager fees are withdrawable",
              detail: withinBands
                ? "The portfolio is healthy and no challenge is active."
                : `The portfolio is outside its ${completionBand} completion bands but remains inside the wider challenge bands, so fees continue normally.`,
              tone: withinBands ? "success" : "warning",
            }
        : withinBands
          ? {
              title: "Portfolio restored — escrowed fees can be released",
              detail: "Withdrawing now resolves the active challenge and releases eligible manager fees.",
              tone: "success",
            }
          : {
              title: "Fee withdrawal is blocked by the active challenge",
              detail: `New fees remain escrowed until every constituent returns within its ${completionBand} completion band.`,
              tone: "danger",
            };

  return (
    <div className={`riskCallout portfolioBandStatus ${status.tone}`} role="status">
      {status.tone === "success" ? <CheckCircle size={15} /> : <AlertTriangle size={15} />}
      <div><strong>{status.title}</strong><span>{status.detail}</span></div>
    </div>
  );
}

function TargetWeightsBuilder({ vault, onRefresh }: { vault: VaultView; onRefresh: () => Promise<unknown> }) {
  const testnetCreateAssets = useVerifiedAssetCatalog();
  const activeTargetsKey = `${vault.address ?? "unconfigured"}|${vault.allocations
    .map((asset) => `${asset.address.toLowerCase()}:${asset.symbol}:${asset.targetWeightBps}`)
    .join("|")}`;
  const [targets, setTargets] = useState<StrategyTargetAsset[]>(() =>
    vault.allocations.map((asset) => ({
      ticker: asset.symbol,
      name: asset.name,
      address: asset.address,
      verified: assetIsVerifiedForAddress(testnetCreateAssets, asset.address),
      pricingConfig: emptyPricingConfig(),
      targetWeight: String(asset.targetWeightBps / 100),
      initialAmount: "",
    })),
  );
  const initializedTargetsKey = useRef(activeTargetsKey);
  const [rationale, setRationale] = useState("");
  const [txState, setTxState] = useState<TxState>("idle");
  const [txError, setTxError] = useState<string>();
  const [manualTargetAsset, setManualTargetAsset] = useState("");
  const [manualTargetPricingSource, setManualTargetPricingSource] = useState<PricingSource>(0);
  const [manualTargetQuoteToken, setManualTargetQuoteToken] = useState("");
  const [manualTargetPrimarySource, setManualTargetPrimarySource] = useState("");
  const [manualTargetSecondarySource, setManualTargetSecondarySource] = useState("");
  const [manualTargetPrimaryMaxStaleness, setManualTargetPrimaryMaxStaleness] = useState(DEFAULT_ORACLE_STALENESS_SECONDS);
  const [manualTargetSecondaryMaxStaleness, setManualTargetSecondaryMaxStaleness] = useState(0);
  const [manualTargetState, setManualTargetState] = useState<TxState>("idle");
  const [manualTargetError, setManualTargetError] = useState<string>();
  const publicClient = usePublicClient({ chainId: robinhoodChainTestnet.id });
  const { writeContractAsync } = useWriteContract();
  const activationRemaining = useLiveCountdown(vault.pendingStrategyActivationTime);
  const proposalCooldownRemaining = useLiveCountdown(vault.nextStrategyChange);
  const { data: pendingRationale } = useReadContract({
    address: vault.address,
    abi: managedOtfVaultAbi,
    functionName: "pendingStrategyRationale",
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(vault.address && vault.strategyProposalPending), refetchInterval: 12_000 },
  });
  const { data: factoryPricingResolver, isError: factoryPricingResolverReadFailed } = useReadContract({
    address: vault.factoryAddress,
    abi: otfFactoryAbi,
    functionName: "pricingResolver",
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(vault.factoryAddress) },
  });
  const pricingResolverAddress = isAddress(factoryPricingResolver ?? "")
    ? factoryPricingResolver as `0x${string}`
    : undefined;
  const { data: activeTargetPricingResults } = useReadContracts({
    contracts: vault.address
      ? vault.allocations.map((asset) => ({
          address: vault.address as `0x${string}`,
          abi: managedOtfVaultAbi,
          functionName: "pricingConfigForAsset" as const,
          args: [asset.address as `0x${string}`] as const,
          chainId: robinhoodChainTestnet.id,
        }))
      : [],
    query: { enabled: Boolean(vault.address && vault.allocations.length) },
  });

  useEffect(() => {
    if (initializedTargetsKey.current === activeTargetsKey) return;
    initializedTargetsKey.current = activeTargetsKey;
    setTargets(vault.allocations.map((asset) => ({
      ticker: asset.symbol,
      name: asset.name,
      address: asset.address,
      verified: assetIsVerifiedForAddress(testnetCreateAssets, asset.address),
      pricingConfig: emptyPricingConfig(),
      targetWeight: String(asset.targetWeightBps / 100),
      initialAmount: "",
    })));
  }, [activeTargetsKey, vault.allocations]);

  useEffect(() => {
    if (!activeTargetPricingResults || activeTargetPricingResults.length !== vault.allocations.length) return;
    setTargets((current) => current.map((target) => {
      const allocationIndex = vault.allocations.findIndex(
        (asset) => asset.address.toLowerCase() === target.address.toLowerCase(),
      );
      if (allocationIndex < 0) return target;
      const pricingResult = activeTargetPricingResults[allocationIndex];
      if (pricingResult?.status !== "success") return target;
      const [
        configured,
        source,
        quoteToken,
        primarySource,
        secondarySource,
        ,
        primaryMaxStaleness,
        secondaryMaxStaleness,
      ] = pricingResult.result;
      if (!configured || (source !== 0 && source !== 1 && source !== 2 && source !== 3)) return target;
      return {
        ...target,
        verified: assetIsVerifiedForAddress(testnetCreateAssets, target.address),
        pricingConfig: {
          source,
          quoteToken,
          primarySource,
          secondarySource,
          primaryMaxStaleness,
          secondaryMaxStaleness,
        },
      };
    }));
  }, [activeTargetPricingResults, vault.allocations]);

  const incumbentPricingReadsReady = vault.allocations.length === 0 || Boolean(
    activeTargetPricingResults &&
    activeTargetPricingResults.length === vault.allocations.length &&
    activeTargetPricingResults.every((result) =>
      result.status === "success" && Boolean(result.result[0]),
    ),
  );
  const incumbentPricingReadFailed = factoryPricingResolverReadFailed || Boolean(
    activeTargetPricingResults?.some((result) =>
      result.status === "failure" || (result.status === "success" && !result.result[0]),
    ),
  );

  const totalWeight = targets.reduce((sum, asset) => sum + Number(asset.targetWeight || 0), 0);
  const targetChanges = targets.map((asset) => {
    const currentAllocation = vault.allocations.find(
      (allocation) => allocation.address.toLowerCase() === asset.address.toLowerCase(),
    );
    const current = (currentAllocation?.actualWeightBps ?? 0) / 100;
    const activeTarget = (currentAllocation?.targetWeightBps ?? 0) / 100;
    return { ...asset, current, activeTarget, delta: Number(asset.targetWeight || 0) - current };
  });
  const targetWeightBps = targets.map((asset) => Math.round(Number(asset.targetWeight) * 100));
  const weightSumValid = targetWeightBps.reduce((sum, weight) => sum + weight, 0) === 10_000;
  const protocolMinimumTargetWeightBps = vault.minTargetWeightBps;
  const belowMinimumTargets = targetWeightBps.flatMap((weight, index) =>
    !Number.isFinite(weight) || protocolMinimumTargetWeightBps === undefined || weight < protocolMinimumTargetWeightBps
      ? [targets[index].ticker]
      : [],
  );
  const targetMinimumValid = protocolMinimumTargetWeightBps !== undefined && belowMinimumTargets.length === 0;
  const targetMinimumGuidance = protocolMinimumTargetWeightBps === undefined
    ? "Wait for the protocol minimum target weight to load."
    : `Increase each listed target to at least ${(protocolMinimumTargetWeightBps / 100).toFixed(2)}%, or remove that asset from the proposal.`;
  const weightsValid = weightSumValid && targetMinimumValid;
  const addressesValid = targets.length > 0 && targets.every((asset) => isAddress(asset.address));
  const targetsUnique = new Set(targets.map((asset) => asset.address.toLowerCase())).size === targets.length;
  const trackedUnionCount = trackedAssetUnionCount(
    vault.allocations.map((asset) => asset.address),
    targets.map((asset) => asset.address),
  );
  const trackedUnionWithinFrontendCap = trackedUnionCount <= FRONTEND_MAX_TRACKED_ASSETS;
  const unverifiedTargets = targets.filter((asset) => !asset.verified);
  const targetPricingValid = incumbentPricingReadsReady && targets.every(
    (asset) => pricingConfigIsComplete(asset.pricingConfig),
  );
  const targetsChanged = targets.length !== vault.allocations.length || targets.some((target) => {
    const current = vault.allocations.find(
      (allocation) => allocation.address.toLowerCase() === target.address.toLowerCase(),
    );
    return !current || Math.round(Number(target.targetWeight) * 100) !== current.targetWeightBps;
  });
  const normalizedRationale = rationale.trim();
  const rationaleBytes = new TextEncoder().encode(normalizedRationale).length;
  const rationaleValid = rationaleBytes > 0 && rationaleBytes <= MAX_STRATEGY_RATIONALE_BYTES;
  const targetEditorLocked = vault.strategyProposalPending
    || (vault.connectedIsManager && !vault.canProposeStrategy);
  const targetEditorLockMessage = vault.challengeActive
    ? "New target proposals resume after the active challenge is resolved."
    : vault.strategyProposalPending
      ? "Activate or cancel the pending proposal before editing another one."
      : vault.strategicRebalanceActive
        ? "New target proposals resume after the active strategic rebalance is completed."
        : proposalCooldownRemaining > 0
          ? `New target proposals resume when the cooldown ends in ${formatCooldown(proposalCooldownRemaining)}.`
          : !vault.withinCompletionBands
            ? "New target proposals resume after every constituent returns within its completion band."
            : "New target proposals are temporarily unavailable. Refresh the onchain data to check again.";
  const selectedTargetAddresses = new Set(targets.map((target) => target.address.toLowerCase()));
  const nextAvailableTargetAsset = testnetCreateAssets.find(
    (asset) => !selectedTargetAddresses.has(asset.address.toLowerCase()),
  );
  const indexedTargetWouldExceedCap = nextAvailableTargetAsset
    ? trackedAssetUnionCount(
        vault.allocations.map((asset) => asset.address),
        [...targets.map((asset) => asset.address), nextAvailableTargetAsset.address],
      ) > FRONTEND_MAX_TRACKED_ASSETS
    : false;
  const manualTargetWouldExceedCap = isAddress(manualTargetAsset)
    && trackedAssetUnionCount(
      vault.allocations.map((asset) => asset.address),
      [...targets.map((asset) => asset.address), manualTargetAsset],
    ) > FRONTEND_MAX_TRACKED_ASSETS;

  function formatDraftWeight(weightBps: number) {
    return (weightBps / 100).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  }

  function distributeWeight(totalBps: number, weights: number[]) {
    if (weights.length === 0) return [];
    const nonnegativeWeights = weights.map((weight) => Math.max(0, weight));
    const effectivelyEqual =
      Math.max(...nonnegativeWeights) - Math.min(...nonnegativeWeights) <= 1;
    const normalizedWeights = effectivelyEqual || !nonnegativeWeights.some((weight) => weight > 0)
      ? nonnegativeWeights.map(() => 1)
      : nonnegativeWeights;
    const weightTotal = normalizedWeights.reduce((sum, weight) => sum + weight, 0);
    const portions = normalizedWeights.map((weight, index) => {
      const numerator = totalBps * weight;
      return { index, bps: Math.floor(numerator / weightTotal), remainder: numerator % weightTotal };
    });
    let unassigned = totalBps - portions.reduce((sum, portion) => sum + portion.bps, 0);
    portions
      .slice()
      .sort((left, right) => right.remainder - left.remainder || left.index - right.index)
      .forEach((portion) => {
        if (unassigned <= 0) return;
        portions[portion.index].bps += 1;
        unassigned -= 1;
      });
    return portions.map((portion) => portion.bps);
  }

  function updateTargetWeight(index: number, rawWeight: string) {
    setTargets((current) => {
      if (rawWeight.trim() === "" || !Number.isFinite(Number(rawWeight))) {
        return current.map((asset, itemIndex) => itemIndex === index ? { ...asset, targetWeight: rawWeight } : asset);
      }
      const editedBps = Math.max(0, Math.min(10_000, Math.round(Number(rawWeight) * 100)));
      const otherIndexes = current.map((_, itemIndex) => itemIndex).filter((itemIndex) => itemIndex !== index);
      if (otherIndexes.length === 0) {
        return current.map((asset, itemIndex) => itemIndex === index ? { ...asset, targetWeight: "100" } : asset);
      }
      const redistributed = distributeWeight(
        10_000 - editedBps,
        otherIndexes.map((itemIndex) => Math.max(0, Math.round(Number(current[itemIndex].targetWeight || 0) * 100))),
      );
      return current.map((asset, itemIndex) => {
        if (itemIndex === index) return { ...asset, targetWeight: formatDraftWeight(editedBps) };
        const redistributedIndex = otherIndexes.indexOf(itemIndex);
        return { ...asset, targetWeight: formatDraftWeight(redistributed[redistributedIndex]) };
      });
    });
    setTxState("idle");
    setTxError(undefined);
  }

  function removeTarget(index: number) {
    setTargets((current) => {
      if (current.length <= 1) return current;
      const remaining = current.filter((_, itemIndex) => itemIndex !== index);
      const redistributed = distributeWeight(
        10_000,
        remaining.map((asset) => Math.max(0, Math.round(Number(asset.targetWeight || 0) * 100))),
      );
      return remaining.map((asset, itemIndex) => ({
        ...asset,
        targetWeight: formatDraftWeight(redistributed[itemIndex]),
      }));
    });
    setTxState("idle");
    setTxError(undefined);
  }

  function updateTarget(index: number, patch: Partial<StrategyTargetAsset>) {
    setTargets((current) => current.map((asset, itemIndex) => itemIndex === index ? { ...asset, ...patch } : asset));
    setTxState("idle");
    setTxError(undefined);
  }

  function addTarget() {
    const nextAsset = nextAvailableTargetAsset;
    if (!nextAsset || indexedTargetWouldExceedCap) return;
    const pricingConfig = configuredPricingConfig(nextAsset.address) ?? emptyPricingConfig();
    setTargets((current) => {
      if (
        trackedAssetUnionCount(
          vault.allocations.map((asset) => asset.address),
          [...current.map((asset) => asset.address), nextAsset.address],
        ) > FRONTEND_MAX_TRACKED_ASSETS
      ) return current;
      return [...current, {
        ticker: nextAsset.symbol,
        name: nextAsset.name,
        address: nextAsset.address,
        poolAddress: pricingConfig.source === 2 ? pricingConfig.primarySource : undefined,
        verified: nextAsset.verified,
        pricingConfig,
        targetWeight: "",
        initialAmount: "",
      }];
    });
    setTxState("idle");
  }

  async function validateAndAddTarget() {
    if (
      !publicClient || !vault.connectedIsManager || !pricingResolverAddress ||
      !isAddress(manualTargetAsset) || !isAddress(manualTargetPrimarySource) ||
      protocolMinimumTargetWeightBps === undefined
    ) return;
    if (manualTargetWouldExceedCap) {
      setManualTargetError(`This proposal would track more than the ${FRONTEND_MAX_TRACKED_ASSETS}-asset frontend safety cap. Remove a newly proposed asset or wait for a retiring asset to be pruned.`);
      return;
    }
    const assetAddress = manualTargetAsset as `0x${string}`;
    const pricingConfig: AssetPricingConfig = {
      source: manualTargetPricingSource,
      quoteToken: (manualTargetPricingSource === 1 || manualTargetPricingSource === 2) && isAddress(manualTargetQuoteToken)
        ? manualTargetQuoteToken as `0x${string}`
        : zeroAddress,
      primarySource: manualTargetPrimarySource as `0x${string}`,
      secondarySource: (manualTargetPricingSource === 1 || manualTargetPricingSource === 2) && isAddress(manualTargetSecondarySource)
        ? manualTargetSecondarySource as `0x${string}`
        : zeroAddress,
      primaryMaxStaleness: manualTargetPrimaryMaxStaleness,
      secondaryMaxStaleness: manualTargetPricingSource === 1 || manualTargetPricingSource === 2 ? manualTargetSecondaryMaxStaleness : 0,
    };
    if (!pricingConfigIsComplete(pricingConfig)) {
      setManualTargetError("Complete the selected pricing route before validating it.");
      return;
    }
    if (targets.some((target) => target.address.toLowerCase() === assetAddress.toLowerCase())) {
      setManualTargetError("This token contract is already in the proposal.");
      return;
    }
    setManualTargetError(undefined);
    setManualTargetState("pending");
    try {
      const [decimals, tokenName, tokenSymbol] = await Promise.all([
        publicClient.readContract({ address: assetAddress, abi: erc20MetadataReadAbi, functionName: "decimals" }),
        publicClient.readContract({ address: assetAddress, abi: erc20MetadataReadAbi, functionName: "name" }).catch(() => "Unindexed token"),
        publicClient.readContract({ address: assetAddress, abi: erc20MetadataReadAbi, functionName: "symbol" }).catch(() => "TOKEN"),
      ]);
      if (Number(decimals) !== 18) throw new Error("Constituents must use exactly 18 decimals.");
      await publicClient.simulateContract({
        account: vault.manager as `0x${string}`,
        address: pricingResolverAddress,
        abi: assetPricingResolverAbi,
        functionName: "validateAndQuotePrice",
        args: [assetAddress, pricingConfig],
      });

      const symbol = String(tokenSymbol).trim().slice(0, 16) || "TOKEN";
      setTargets((current) => {
        if (
          trackedAssetUnionCount(
            vault.allocations.map((asset) => asset.address),
            [...current.map((asset) => asset.address), assetAddress],
          ) > FRONTEND_MAX_TRACKED_ASSETS
        ) return current;
        const existingWeights = distributeWeight(
          10_000 - protocolMinimumTargetWeightBps,
          current.map((target) => Math.max(0, Math.round(Number(target.targetWeight || 0) * 100))),
        );
        return [
          ...current.map((target, index) => ({
            ...target,
            targetWeight: formatDraftWeight(existingWeights[index]),
          })),
          {
            ticker: symbol,
            name: String(tokenName).trim().slice(0, 80) || "Unindexed token",
            address: assetAddress,
            poolAddress: pricingConfig.source === 2 ? pricingConfig.primarySource : undefined,
            verified: false,
            pricingConfig,
            targetWeight: formatDraftWeight(protocolMinimumTargetWeightBps),
            initialAmount: "",
          },
        ];
      });
      setManualTargetAsset("");
      setManualTargetPrimarySource("");
      setManualTargetSecondarySource("");
      setManualTargetPrimaryMaxStaleness(DEFAULT_ORACLE_STALENESS_SECONDS);
      setManualTargetSecondaryMaxStaleness(0);
      setManualTargetState("confirmed");
      setTxState("idle");
    } catch (error) {
      setManualTargetError(errorMessage(error));
      setManualTargetState("reverted");
    }
  }

  async function submitTargets() {
    if (
      !vault.address || !vault.connectedIsManager || !publicClient || !weightsValid ||
      !addressesValid || !targetsUnique || !targetsChanged || !rationaleValid ||
      !targetPricingValid || !incumbentPricingReadsReady || !trackedUnionWithinFrontendCap
    ) return;
    setTxError(undefined);
    try {
      setTxState("simulating");
      const addresses = targets.map((target) => target.address as `0x${string}`);
      const weights = targetWeightBps.map(BigInt);
      const args = [
        addresses,
        weights,
        targets.map((target) => target.pricingConfig),
        normalizedRationale,
      ] as const;
      await publicClient.simulateContract({
        account: vault.manager as `0x${string}`,
        address: vault.address,
        abi: managedOtfVaultAbi,
        functionName: "proposeStrategyWithPricing",
        args,
      });
      setTxState("pending");
      const hash = await writeContractAsync({
        address: vault.address,
        abi: managedOtfVaultAbi,
        functionName: "proposeStrategyWithPricing",
        args,
        chainId: robinhoodChainTestnet.id,
      });
      setTxState("submitted");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The target update reverted.");
      await onRefresh();
      setRationale("");
      setTxState("confirmed");
    } catch (error) {
      setTxError(errorMessage(error));
      setTxState("reverted");
    }
  }

  async function submitPendingAction(action: "activatePendingStrategy" | "cancelPendingStrategy") {
    if (!vault.address || !vault.connectedIsManager || !publicClient) return;
    setTxError(undefined);
    try {
      setTxState("pending");
      const hash = await writeContractAsync({
        address: vault.address,
        abi: managedOtfVaultAbi,
        functionName: action,
        chainId: robinhoodChainTestnet.id,
      });
      setTxState("submitted");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The strategy transaction reverted.");
      await onRefresh();
      setTxState("confirmed");
    } catch (error) {
      setTxError(errorMessage(error));
      setTxState("reverted");
    }
  }

  return (
    <SectionCard
      title="Update target weights"
      subtitle="Set the target first; execute constrained partial trades afterward"
      icon={<Scale size={15} />}
      action={<span className={`stateBadge ${vault.connectedIsManager ? "success" : "muted"}`}>{vault.connectedIsManager ? "Manager connected" : "Draft mode"}</span>}
    >
      <PortfolioBandStatus vault={vault} context="targets" proposalCooldownRemaining={proposalCooldownRemaining} />
      {vault.strategyProposalPending ? (
        <div className="pendingStrategyNotice">
          <div className="subHeader">
            <span>Pending strategy</span>
            <small>{activationRemaining > 0 ? `Activates in ${formatCooldown(activationRemaining)}` : "Ready to activate"}</small>
          </div>
          <p>Current targets remain active during the 48-hour notice period, and holders may redeem before activation.</p>
          <blockquote>{pendingRationale || "Reading the locked strategy rationale..."}</blockquote>
        </div>
      ) : null}
      <div className={`targetEditorSurface ${targetEditorLocked ? "locked" : ""}`} aria-disabled={targetEditorLocked}>
      <div className="builderBlock">
        <div className="subHeader">
          <span>Target weights</span>
          <small className={weightsValid && trackedUnionWithinFrontendCap ? "successText" : "warningText"}>Tracked union: {trackedUnionCount} / {FRONTEND_MAX_TRACKED_ASSETS} · Total: {totalWeight.toFixed(1)}%</small>
        </div>
        <div className="targetCardGrid">
          {targets.map((target, index) => (
            <div className="targetCard" key={`${target.ticker}-${index}`}>
              <div className="targetCardHeader">
                <div className="assetSelectWithLogo">
                  <AssetLogo symbol={target.ticker} compact />
                  <select
                    className="targetTicker"
                    value={target.address}
                    disabled={targetEditorLocked}
                    onChange={(event) => {
                      const selected = testnetCreateAssets.find((asset) => asset.address === event.target.value);
                      if (selected) {
                        const pricingConfig = configuredPricingConfig(selected.address) ?? emptyPricingConfig();
                        updateTarget(index, {
                          ticker: selected.symbol,
                          name: selected.name,
                          address: selected.address,
                          poolAddress: pricingConfig.source === 2 ? pricingConfig.primarySource : undefined,
                          verified: selected.verified,
                          pricingConfig,
                        });
                      }
                    }}
                  >
                    {testnetCreateAssets.map((asset) => (
                      <option key={asset.address} value={asset.address}>{asset.symbol}</option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  title={targets.length <= 1 ? "An OTF must retain at least one asset" : `Remove ${target.ticker || "asset"}`}
                  disabled={targetEditorLocked || targets.length <= 1}
                  onClick={() => removeTarget(index)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <label>
                <span>Target weight</span>
                <div className="inputWithSuffix">
                  <input
                    value={target.targetWeight}
                    onChange={(event) => updateTargetWeight(index, event.target.value)}
                    type="number"
                    min={protocolMinimumTargetWeightBps === undefined ? undefined : protocolMinimumTargetWeightBps / 100}
                    max={100}
                    step={0.01}
                    placeholder={protocolMinimumTargetWeightBps === undefined ? "Loading" : String(protocolMinimumTargetWeightBps / 100)}
                    disabled={targetEditorLocked}
                    aria-label={`${target.ticker || "Asset"} draft target weight`}
                  />
                  <span>%</span>
                </div>
              </label>
              <small>Active target {targetChanges[index]?.activeTarget.toFixed(1) ?? "0.0"}% · Live holding {targetChanges[index]?.current.toFixed(1) ?? "0.0"}%</small>
              <span className={`stateBadge ${target.verified ? "success" : "warning"}`}>
                {target.verified ? "Verified" : "Unverified"} · {pricingSourceLabel(target.pricingConfig.source)}
              </span>
              <PricingConfigurationFields
                chainId={robinhoodChainTestnet.id}
                assetAddress={target.address}
                assetTicker={target.ticker}
                config={target.pricingConfig}
                disabled={targetEditorLocked || vault.allocations.some((asset) => asset.address.toLowerCase() === target.address.toLowerCase())}
                onChange={(pricingConfig) => updateTarget(index, {
                  pricingConfig,
                  poolAddress: pricingConfig.source === 2 ? pricingConfig.primarySource : undefined,
                })}
              />
              {vault.allocations.some((asset) => asset.address.toLowerCase() === target.address.toLowerCase()) ? (
                <small>Pricing is already pinned for this constituent and cannot be replaced.</small>
              ) : null}
            </div>
          ))}
        </div>
        <button className="ghostAction addAssetAction" type="button" onClick={addTarget} disabled={targetEditorLocked || !nextAvailableTargetAsset || indexedTargetWouldExceedCap}>
          <Plus size={13} />
          Add asset
        </button>
        <div className="manualAssetRegistration strategyManualAsset">
            <div className="manualAssetRegistrationIntro">
              <div>
                <strong>Add an unindexed token</strong>
              <span>Submit the 18-decimal token with its exact Chainlink or Uniswap V3 pricing configuration.</span>
              </div>
              <span className="stateBadge warning">Unverified</span>
            </div>
            <div className="manualAssetRegistrationFields">
              <label>
                <span>Token contract</span>
                <input
                  value={manualTargetAsset}
                  onChange={(event) => setManualTargetAsset(event.target.value.trim())}
                  placeholder="0x ERC-20 address"
                  disabled={targetEditorLocked}
                />
              </label>
              <PricingConfigurationFields
                chainId={robinhoodChainTestnet.id}
                assetAddress={manualTargetAsset}
                config={{
                  source: manualTargetPricingSource,
                  quoteToken: (manualTargetQuoteToken || zeroAddress) as `0x${string}`,
                  primarySource: (manualTargetPrimarySource || zeroAddress) as `0x${string}`,
                  secondarySource: (manualTargetSecondarySource || zeroAddress) as `0x${string}`,
                  primaryMaxStaleness: manualTargetPrimaryMaxStaleness,
                  secondaryMaxStaleness: manualTargetSecondaryMaxStaleness,
                }}
                disabled={targetEditorLocked}
                onChange={(pricingConfig) => {
                  setManualTargetPricingSource(pricingConfig.source);
                  setManualTargetQuoteToken(pricingConfig.quoteToken === zeroAddress ? "" : pricingConfig.quoteToken);
                  setManualTargetPrimarySource(pricingConfig.primarySource === zeroAddress ? "" : pricingConfig.primarySource);
                  setManualTargetSecondarySource(pricingConfig.secondarySource === zeroAddress ? "" : pricingConfig.secondarySource);
                  setManualTargetPrimaryMaxStaleness(pricingConfig.primaryMaxStaleness);
                  setManualTargetSecondaryMaxStaleness(pricingConfig.secondaryMaxStaleness);
                }}
              />
              <button
                type="button"
                className="secondaryAction"
                onClick={validateAndAddTarget}
                disabled={
                  targetEditorLocked || !vault.connectedIsManager ||
                  manualTargetState === "pending" || manualTargetState === "submitted" ||
                  !isAddress(manualTargetAsset) || !isAddress(manualTargetPrimarySource) ||
                  ((manualTargetPricingSource === 1 || manualTargetPricingSource === 2) && !isAddress(manualTargetSecondarySource)) ||
                  protocolMinimumTargetWeightBps === undefined || manualTargetWouldExceedCap
                }
              >
                {manualTargetState === "pending" || manualTargetState === "submitted"
                  ? <Loader2 className="spin" size={14} />
                  : <Plus size={14} />}
                Validate and add
              </button>
            </div>
            <div className="manualAssetRiskNotice" role="note">
              <AlertTriangle size={15} />
              <span>The contract validates feed orientation, freshness, pause behavior, or canonical V3 history. No fallback source is installed if the selected source later fails.</span>
            </div>
            {manualTargetError ? <span className="fieldError">{manualTargetError}</span> : null}
            <TxStatus state={manualTargetState} persistent />
          </div>
      </div>

      <div className="builderBlock strategyRationaleComposer">
        <div className="subHeader">
          <span>Strategy rationale</span>
          <small className={rationaleValid ? "successText" : rationaleBytes > MAX_STRATEGY_RATIONALE_BYTES ? "dangerText" : "warningText"}>{rationaleBytes.toLocaleString()} / {MAX_STRATEGY_RATIONALE_BYTES.toLocaleString()} bytes</small>
        </div>
        <textarea
          value={rationale}
          onChange={(event) => {
            setRationale(event.target.value);
            setTxState("idle");
            setTxError(undefined);
          }}
          rows={4}
          placeholder="Explain why these target changes advance the investment strategy."
          disabled={targetEditorLocked}
          aria-invalid={rationaleBytes > MAX_STRATEGY_RATIONALE_BYTES}
        />
        <p>This rationale is locked with the target proposal, becomes permanent when the targets activate, and cannot be edited.</p>
      </div>
      <div className="previewBlock">
        <div className="subHeader">
          <span>Live portfolio vs targets</span>
        </div>
        <div className="weightPreviewList">
          {targetChanges.map((target, index) => (
            <div className="weightPreviewRow" key={`${target.ticker}-preview-${index}`}>
              <span className="assetNameWithLogo"><AssetLogo symbol={target.ticker || "Asset"} compact /><strong>{target.ticker || "Asset"}</strong></span>
              <div className="weightTrack" aria-label={`${target.ticker} live holding ${target.current.toFixed(1)}%, active target ${target.activeTarget.toFixed(1)}%, draft target ${Number(target.targetWeight || 0).toFixed(1)}%`}>
                <span style={{ width: `${Math.min(target.current, 100)}%` }} />
                <i className="active" style={{ left: `${Math.min(target.activeTarget, 100)}%` }} />
                <i className="draft" style={{ left: `${Math.min(Number(target.targetWeight || 0), 100)}%` }} />
              </div>
              <div className="weightPreviewValues">
                <span><small>Live</small>{target.current.toFixed(1)}%</span>
                <span><small>Active</small>{target.activeTarget.toFixed(1)}%</span>
                <strong><small>Draft</small>{Number(target.targetWeight || 0).toFixed(1)}%</strong>
              </div>
            </div>
          ))}
        </div>
        <div className="weightPreviewLegend" aria-hidden="true">
          <span className="live">Live holding</span>
          <span className="active">Active target</span>
          <span className="draft">Draft target</span>
        </div>
      </div>

      <div className="builderWarnings">
        {!targetEditorLocked ? <>
        {!weightSumValid ? (
          <div className="riskCallout warning"><AlertTriangle size={15} /><div><strong>Target weights must sum to exactly 100%</strong><span>Weights are submitted to the contract in whole basis points.</span></div></div>
        ) : null}
        {!targetMinimumValid ? (
          <div className="riskCallout warning"><AlertTriangle size={15} /><div>
            <strong>{belowMinimumTargets.join(", ")} {belowMinimumTargets.length === 1 ? "is" : "are"} below the minimum target</strong>
            <span>{targetMinimumGuidance}</span>
          </div></div>
        ) : null}
        {!targetsUnique ? (
          <div className="riskCallout danger"><XCircle size={15} /><div><strong>Each asset may appear only once</strong><span>Select a different supported asset or remove the duplicate.</span></div></div>
        ) : null}
        {!trackedUnionWithinFrontendCap ? (
          <div className="riskCallout danger"><XCircle size={15} /><div><strong>Tracked union exceeds the frontend safety cap</strong><span>This proposal would track {trackedUnionCount} unique assets, including zero-target retiring assets. Remove newly proposed assets until the union is {FRONTEND_MAX_TRACKED_ASSETS} or fewer.</span></div></div>
        ) : null}
        {trackedUnionCount === FRONTEND_MAX_TRACKED_ASSETS ? (
          <div className="riskCallout warning"><AlertTriangle size={15} /><div><strong>Frontend tracked-asset cap reached</strong><span>The tracked union includes current holdings and zero-target retiring assets. Remove or fully prune one before adding a new asset beyond this {FRONTEND_MAX_TRACKED_ASSETS}-asset safety cap.</span></div></div>
        ) : null}
        {!targetPricingValid ? (
          <div className="riskCallout danger"><XCircle size={15} /><div>
            <strong>{incumbentPricingReadFailed ? "Pinned pricing could not be loaded" : incumbentPricingReadsReady ? "Every constituent needs a complete pricing configuration" : "Loading pinned pricing"}</strong>
            <span>{incumbentPricingReadFailed
              ? "Refresh the OTF before proposing targets. Existing source addresses are never replaced with frontend defaults."
              : incumbentPricingReadsReady
                ? "Choose Chainlink, Chainlink Composed, or an initialized canonical Uniswap V3 TWAP pool. Trading routes are configured independently."
                : "The exact onchain tuples for every incumbent constituent must load before this proposal can be signed."}</span>
          </div></div>
        ) : null}
        {unverifiedTargets.length > 0 ? (
          <div className="riskCallout"><Info size={15} /><div>
            <strong>Unverified constituents</strong>
            <span>{unverifiedTargets.map((target) => target.ticker).join(", ")} do not appear in the verified asset registry. This does not change proposal eligibility or contract behavior.</span>
          </div></div>
        ) : null}
        {!targetsChanged ? (
          <div className="riskCallout warning"><AlertTriangle size={15} /><div><strong>Change at least one target</strong><span>Reordering the same assets or submitting identical weights does not create a new strategy.</span></div></div>
        ) : null}
        {!rationaleValid ? (
          <div className={`riskCallout ${rationaleBytes > MAX_STRATEGY_RATIONALE_BYTES ? "danger" : "warning"}`}><BookOpen size={15} /><div><strong>{rationaleBytes > MAX_STRATEGY_RATIONALE_BYTES ? "Strategy rationale is too long" : "Strategy rationale required"}</strong><span>{rationaleBytes > MAX_STRATEGY_RATIONALE_BYTES ? `Shorten it to ${MAX_STRATEGY_RATIONALE_BYTES.toLocaleString()} bytes or fewer.` : "Explain the target change before submitting the proposal."}</span></div></div>
        ) : null}
        </> : null}
        {txError ? (
          <div className="riskCallout danger"><XCircle size={15} /><div><strong>Target update failed</strong><span>{txError}</span></div></div>
        ) : null}
      </div>

      <TxStatus state={txState} persistent />
      {targetEditorLocked ? (
        <div className="targetEditorLockOverlay" role="note">
          <div className="targetEditorLockMessage">
            <LockKeyhole size={18} />
            <strong>Target editor locked</strong>
            <span>{targetEditorLockMessage}</span>
          </div>
        </div>
      ) : null}
      </div>
      <div className="builderActions">
        {vault.strategyProposalPending ? <>
          <button className="secondaryAction" type="button" disabled={!vault.connectedIsManager || txState === "pending" || txState === "submitted"} onClick={() => submitPendingAction("cancelPendingStrategy")}>
            <XCircle size={14} /> Cancel proposal
          </button>
          <button className="primaryAction" type="button" disabled={!vault.connectedIsManager || activationRemaining > 0 || txState === "pending" || txState === "submitted"} onClick={() => submitPendingAction("activatePendingStrategy")}>
            <CheckCircle size={14} /> {activationRemaining > 0 ? `Available in ${formatCooldown(activationRemaining)}` : "Activate strategy"}
          </button>
        </> : <button
            className="primaryAction"
            type="button"
            disabled={!vault.connectedIsManager || !vault.canProposeStrategy || !weightsValid || !addressesValid || !targetsUnique || !trackedUnionWithinFrontendCap || !targetsChanged || !rationaleValid || !targetPricingValid || txState === "pending" || txState === "submitted" || txState === "simulating"}
            onClick={submitTargets}
          >
            <RefreshCw size={14} />
            {txState === "simulating" ? "Checking onchain rules" : txState === "pending" ? "Confirm in wallet" : txState === "submitted" ? "Submitting proposal" : "Propose target update"}
          </button>}
      </div>
      <p className="builderFootnote">A proposal waits 48 hours before activation. Once active, the manager or an authorized executor may perform constrained trades; neither has a portfolio withdrawal path.</p>
    </SectionCard>
  );
}

function RebalanceTradesPanel({
  vault,
  oraclePrices,
  onRefresh,
}: {
  vault: VaultView;
  oraclePrices: CatalogOraclePrices;
  onRefresh: () => Promise<unknown>;
}) {
  const sellOptions = useMemo(
    () => vault.allocations.filter((asset) => asset.actualWeightBps > asset.targetWeightBps),
    [vault.allocations],
  );
  const buyOptions = useMemo(
    () => vault.allocations.filter((asset) => asset.actualWeightBps < asset.targetWeightBps),
    [vault.allocations],
  );
  const recommendedTrades = useMemo(() => {
    const remainingSells = sellOptions
      .map((asset) => ({ asset, remainingBps: asset.actualWeightBps - asset.targetWeightBps }))
      .sort((left, right) => right.remainingBps - left.remainingBps);
    const remainingBuys = buyOptions
      .map((asset) => ({ asset, remainingBps: asset.targetWeightBps - asset.actualWeightBps }))
      .sort((left, right) => right.remainingBps - left.remainingBps);
    const trades: Array<{ sell: Allocation; buy: Allocation; transferBps: number }> = [];
    let sellIndex = 0;
    let buyIndex = 0;
    while (sellIndex < remainingSells.length && buyIndex < remainingBuys.length) {
      const sell = remainingSells[sellIndex];
      const buy = remainingBuys[buyIndex];
      const transferBps = Math.min(sell.remainingBps, buy.remainingBps);
      if (transferBps > 0) trades.push({ sell: sell.asset, buy: buy.asset, transferBps });
      sell.remainingBps -= transferBps;
      buy.remainingBps -= transferBps;
      if (sell.remainingBps === 0) sellIndex += 1;
      if (buy.remainingBps === 0) buyIndex += 1;
    }
    return trades;
  }, [buyOptions, sellOptions]);
  const recommendedTradeNavBps = recommendedTrades.reduce(
    (total, trade) => total + trade.transferBps,
    0,
  );
  const [tokenIn, setTokenIn] = useState(recommendedTrades[0]?.sell.address ?? "");
  const [tokenOut, setTokenOut] = useState(recommendedTrades[0]?.buy.address ?? "");
  const [tradeSize, setTradeSize] = useState<10 | 25 | 50 | 100>(100);
  const [amountInText, setAmountInText] = useState("");
  const [slippageText, setSlippageText] = useState("1.0");
  const [routeText, setRouteText] = useState("");
  const [txState, setTxState] = useState<TxState>("idle");
  const [txError, setTxError] = useState<string>();
  const { address: connectedAddress } = useAccount();
  const publicClient = usePublicClient({ chainId: robinhoodChainTestnet.id });
  const { writeContractAsync } = useWriteContract();
  const adapterAddress = configuredEntryAdapterAddress();
  const quoterAddress = configuredUniswapV3QuoterAddress();
  const isRegisteredRebalanceAdapter = Boolean(adapterAddress);
  const rebalanceSettlementToken = robinhoodTestnetAddresses.usdg;
  const rebalanceAlternateQuote = robinhoodTestnetAddresses.weth;
  const rebalanceDiscoveryPairs = useMemo<V3TokenPair[]>(() => {
    const quotes = [rebalanceSettlementToken, rebalanceAlternateQuote]
      .filter((address): address is `0x${string}` => Boolean(address));
    return [
      ...vault.allocations.flatMap((asset) => quotes.map((quote) => ({
        tokenA: asset.address,
        tokenB: quote,
      }))),
      ...(quotes.length === 2 ? [{ tokenA: quotes[0], tokenB: quotes[1] }] : []),
      ...(isAddress(tokenIn) && isAddress(tokenOut) ? [{ tokenA: tokenIn, tokenB: tokenOut }] : []),
    ];
  }, [rebalanceAlternateQuote, rebalanceSettlementToken, tokenIn, tokenOut, vault.allocations]);
  const {
    pools: discoveredRebalancePools,
    isLoading: rebalanceRouteDiscoveryLoading,
  } = useDiscoveredV3Pools(rebalanceDiscoveryPairs, isRegisteredRebalanceAdapter);
  const executionRouteFor = (asset: string) => rebalanceSettlementToken
    ? selectExecutionRoute(
        discoveredRebalancePools,
        asset,
        rebalanceSettlementToken,
        rebalanceAlternateQuote,
      )
    : undefined;
  const registeredRebalancePathFor = (asset: string, assetToSettlement: boolean) => {
    if (!isRegisteredRebalanceAdapter) return undefined;
    const route = executionRouteFor(asset);
    return route ? packedExecutionRoute(route, assetToSettlement) : undefined;
  };
  const hasAllowedTrade = recommendedTrades.length > 0;

  useEffect(() => {
    const selectedTradeStillAvailable = recommendedTrades.some(
      (trade) => trade.sell.address === tokenIn && trade.buy.address === tokenOut,
    );
    if (selectedTradeStillAvailable) return;
    setTokenIn(recommendedTrades[0]?.sell.address ?? "");
    setTokenOut(recommendedTrades[0]?.buy.address ?? "");
    setTradeSize(100);
    setRouteText("");
  }, [recommendedTrades, tokenIn, tokenOut]);

  const { data: tokenInDecimalsResult } = useReadContract({
    address: isAddress(tokenIn) ? tokenIn : undefined,
    abi: erc20BalanceAbi,
    functionName: "decimals",
    chainId: robinhoodChainTestnet.id,
    query: { enabled: isAddress(tokenIn) },
  });
  const tokenInDecimals = Number(tokenInDecimalsResult ?? 18);
  const {
    data: tokenInVaultBalance,
    refetch: refetchTokenInVaultBalance,
  } = useReadContract({
    address: isAddress(tokenIn) ? tokenIn : undefined,
    abi: erc20BalanceAbi,
    functionName: "balanceOf",
    args: vault.address ? [vault.address] : undefined,
    chainId: robinhoodChainTestnet.id,
    query: {
      enabled: Boolean(isAddress(tokenIn) && vault.address),
      refetchInterval: 12_000,
      refetchOnWindowFocus: true,
    },
  });
  const { data: tokenOutDecimalsResult } = useReadContract({
    address: isAddress(tokenOut) ? tokenOut : undefined,
    abi: erc20BalanceAbi,
    functionName: "decimals",
    chainId: robinhoodChainTestnet.id,
    query: { enabled: isAddress(tokenOut) },
  });
  const tokenOutDecimals = Number(tokenOutDecimalsResult ?? 18);
  const {
    data: tokenOutVaultBalance,
    refetch: refetchTokenOutVaultBalance,
  } = useReadContract({
    address: isAddress(tokenOut) ? tokenOut : undefined,
    abi: erc20BalanceAbi,
    functionName: "balanceOf",
    args: vault.address ? [vault.address] : undefined,
    chainId: robinhoodChainTestnet.id,
    query: {
      enabled: Boolean(isAddress(tokenOut) && vault.address),
      refetchInterval: 12_000,
      refetchOnWindowFocus: true,
    },
  });
  let amountIn: bigint | undefined;
  try {
    amountIn = Number(amountInText) > 0 ? parseUnits(amountInText, tokenInDecimals) : undefined;
  } catch {
    amountIn = undefined;
  }
  const slippageBps = Math.round(Number(slippageText) * 100);
  const slippageValid = Number.isFinite(slippageBps) && slippageBps >= 1 && slippageBps <= 2_000;
  const sellExecutionRoute = tokenIn ? executionRouteFor(tokenIn) : undefined;
  const buyExecutionRoute = tokenOut ? executionRouteFor(tokenOut) : undefined;
  const registeredSellPath = tokenIn ? registeredRebalancePathFor(tokenIn, true) : undefined;
  const registeredBuyPath = tokenOut ? registeredRebalancePathFor(tokenOut, false) : undefined;
  const directRebalancePool = tokenIn && tokenOut
    ? selectV3Pool(discoveredRebalancePools, tokenIn, tokenOut)
    : undefined;
  const directRebalanceReady = Boolean(
    directRebalancePool?.liquidity !== undefined
      && directRebalancePool.liquidity > 0n
      && !directRebalancePool.readFailed,
  );
  const directRebalancePath = directRebalancePool && directRebalanceReady
    ? encodePacked(
        ["address", "uint24", "address"],
        [tokenIn as `0x${string}`, directRebalancePool.fee, tokenOut as `0x${string}`],
      )
    : undefined;
  const settlementRebalancePath = joinPackedV3Paths(registeredSellPath, registeredBuyPath);
  const automaticPackedPath = directRebalancePath ?? settlementRebalancePath;
  const customRoute = routeText.trim();
  const packedRoute = parsePackedV3Path(customRoute || automaticPackedPath, tokenIn, tokenOut);
  const routeValid = Boolean(packedRoute && tokenIn !== tokenOut);
  const routeLabel = packedRoute?.tokens.map((token) => {
    const constituent = vault.allocations.find(
      (asset) => asset.address.toLowerCase() === token.toLowerCase(),
    );
    if (constituent) return constituent.symbol;
    if (token.toLowerCase() === robinhoodTestnetAddresses.weth?.toLowerCase()) return "WETH";
    if (token.toLowerCase() === robinhoodTestnetAddresses.usdg?.toLowerCase()) return "USDG";
    return shortAddress(token);
  }).join(" → ");
  const rebalancePools = (directRebalancePath
    ? [directRebalancePool]
    : [...executionRoutePools(sellExecutionRoute), ...executionRoutePools(buyExecutionRoute)])
    .filter((pool, index, pools) => pool && pools.findIndex(
      (candidate) => candidate?.address.toLowerCase() === pool.address.toLowerCase(),
    ) === index);
  const rebalanceLiquidityLoading = rebalanceRouteDiscoveryLoading;
  const rebalancePoolsConfigured = Boolean(
    automaticPackedPath && rebalancePools.length > 0,
  );
  const configuredRouteLiquidityReady = Boolean(
    rebalancePoolsConfigured && rebalancePools.every(
      (pool) => pool?.liquidity !== undefined && pool.liquidity > 0n && !pool.readFailed,
    ),
  );
  const routeLiquidityReady = customRoute ? true : configuredRouteLiquidityReady;
  const quoteEnabled = Boolean(
    quoterAddress && packedRoute && amountIn && amountIn > 0n && routeLiquidityReady,
  );
  const {
    data: quoteResult,
    error: quoteError,
    isLoading: quoteLoading,
    refetch: refetchRouteQuote,
  } = useReadContract({
    address: quoterAddress,
    abi: uniswapV3QuoterAbi,
    functionName: "quoteExactInput",
    args: amountIn && packedRoute ? [packedRoute.path, amountIn] : undefined,
    chainId: robinhoodChainTestnet.id,
    query: { enabled: quoteEnabled },
  });
  const quotedAmountOut =
    (quoteResult as readonly [bigint, readonly bigint[], readonly number[], bigint] | undefined)?.[0];
  const poolMinimumAmountOut = quotedAmountOut && slippageValid
    ? quotedAmountOut * BigInt(10_000 - slippageBps) / 10_000n
    : undefined;
  const outputAsset = vault.allocations.find((asset) => asset.address === tokenOut);
  const inputAsset = vault.allocations.find((asset) => asset.address === tokenIn);
  const submitFullRetiringBalance = Boolean(
    inputAsset?.targetWeightBps === 0
      && tokenInVaultBalance !== undefined
      && amountIn === tokenInVaultBalance,
  );
  const inputOraclePrice = oraclePrices[tokenIn.toLowerCase()];
  const outputOraclePrice = oraclePrices[tokenOut.toLowerCase()];
  const inputBalanceValue = oracleTokenValue(tokenInVaultBalance, tokenInDecimals, inputOraclePrice);
  const outputBalanceValue = oracleTokenValue(tokenOutVaultBalance, tokenOutDecimals, outputOraclePrice);
  const inputTradeValue = oracleTokenValue(amountIn, tokenInDecimals, inputOraclePrice);
  const quotedOutputValue = oracleTokenValue(quotedAmountOut, tokenOutDecimals, outputOraclePrice);
  const quotedOracleSlippageBps = quotedSlippageBps(quotedOutputValue, inputTradeValue);
  const minimumOracleOutputValue = inputTradeValue !== undefined
    ? inputTradeValue * BigInt(10_000 - vault.maxNavLossBps) / 10_000n
    : undefined;
  const minimumOracleOutputAmountBase = tokenAmountForOracleValue(
    minimumOracleOutputValue,
    tokenOutDecimals,
    outputOraclePrice,
  );
  const minimumOracleOutputAmount = minimumOracleOutputAmountBase !== undefined
    ? minimumOracleOutputAmountBase + 1n
    : undefined;
  const minAmountOut = poolMinimumAmountOut !== undefined && minimumOracleOutputAmount !== undefined
    ? poolMinimumAmountOut > minimumOracleOutputAmount ? poolMinimumAmountOut : minimumOracleOutputAmount
    : undefined;
  const oracleValueLossTooHigh = Boolean(
    quotedOutputValue !== undefined
      && minimumOracleOutputValue !== undefined
      && quotedOutputValue < minimumOracleOutputValue,
  );
  const quotedOracleLossBps = inputTradeValue !== undefined
    && inputTradeValue > 0n
    && quotedOutputValue !== undefined
    && inputTradeValue > quotedOutputValue
    ? Number((inputTradeValue - quotedOutputValue) * 10_000n / inputTradeValue)
    : 0;
  const quotedPortfolioLossBps = inputTradeValue !== undefined
    && quotedOutputValue !== undefined
    && inputTradeValue > quotedOutputValue
    && vault.navValue !== undefined
    && vault.navValue > 0n
    ? Number(((inputTradeValue - quotedOutputValue) * 10_000n + vault.navValue - 1n) / vault.navValue)
    : 0;
  const remainingNavLossBps = Math.max(0, vault.maxNavLossBps - vault.navLossBudgetUsedBps);
  const navLossBudgetTooHigh = quotedPortfolioLossBps > remainingNavLossBps;
  const inputTargetValue = vault.navValue !== undefined && inputAsset
    ? vault.navValue * BigInt(inputAsset.targetWeightBps) / 10_000n
    : undefined;
  const outputIdealTargetValue = vault.navValue !== undefined && outputAsset
    ? vault.navValue * BigInt(outputAsset.targetWeightBps) / 10_000n
    : undefined;
  const inputExcessValue = inputBalanceValue !== undefined && inputTargetValue !== undefined
    ? inputBalanceValue > inputTargetValue ? inputBalanceValue - inputTargetValue : 0n
    : undefined;
  const outputDeficitValue = outputBalanceValue !== undefined && outputIdealTargetValue !== undefined
    ? outputIdealTargetValue > outputBalanceValue ? outputIdealTargetValue - outputBalanceValue : 0n
    : undefined;
  const recommendedTradeValue = inputExcessValue !== undefined && outputDeficitValue !== undefined
    ? inputExcessValue < outputDeficitValue ? inputExcessValue : outputDeficitValue
    : undefined;
  const oracleBalancedTradeAmount = tokenAmountForOracleValue(
    recommendedTradeValue,
    tokenInDecimals,
    inputOraclePrice,
  );
  const weightScale = 1_000_000n;
  const outputCurrentWeightScaled = vault.navValue !== undefined && vault.navValue > 0n && outputBalanceValue !== undefined
    ? outputBalanceValue * weightScale / vault.navValue
    : undefined;
  const outputTargetWeightScaled = outputAsset
    ? BigInt(outputAsset.targetWeightBps) * 100n
    : undefined;
  const outputCurrentDeviationScaled = outputCurrentWeightScaled !== undefined && outputTargetWeightScaled !== undefined
    ? outputCurrentWeightScaled >= outputTargetWeightScaled
      ? outputCurrentWeightScaled - outputTargetWeightScaled
      : outputTargetWeightScaled - outputCurrentWeightScaled
    : undefined;
  const outputMirroredUpperWeightScaled = outputTargetWeightScaled !== undefined && outputCurrentDeviationScaled !== undefined
    ? [weightScale, outputTargetWeightScaled + outputCurrentDeviationScaled].reduce(
        (smallest, value) => value < smallest ? value : smallest,
      )
    : undefined;
  const outputMirroredUpperValue = vault.navValue !== undefined && outputMirroredUpperWeightScaled !== undefined
    ? vault.navValue * outputMirroredUpperWeightScaled / weightScale
    : undefined;
  const outputTargetCapacity = outputMirroredUpperValue !== undefined && outputBalanceValue !== undefined
    ? outputMirroredUpperValue > outputBalanceValue ? outputMirroredUpperValue - outputBalanceValue : 0n
    : undefined;
  const buySideMaxAmount = tokenAmountForOracleValue(
    outputTargetCapacity,
    tokenInDecimals,
    inputOraclePrice,
  );
  const mirroredLowerWeightBps = inputAsset
    ? Math.max(0, (2 * inputAsset.targetWeightBps) - inputAsset.actualWeightBps)
    : 0;
  const sellSideMaxAmount = tokenInVaultBalance !== undefined && inputAsset?.actualWeightBps
    ? tokenInVaultBalance
      * BigInt(inputAsset.actualWeightBps - mirroredLowerWeightBps)
      / BigInt(inputAsset.actualWeightBps)
    : undefined;
  const recommendedTradeAmount = tokenInVaultBalance !== undefined
    && oracleBalancedTradeAmount !== undefined
    ? [tokenInVaultBalance, oracleBalancedTradeAmount].reduce(
        (smallest, value) => value < smallest ? value : smallest,
      )
    : undefined;
  const maxSellAmount = tokenInVaultBalance !== undefined
    && sellSideMaxAmount !== undefined
    && buySideMaxAmount !== undefined
    ? [tokenInVaultBalance, sellSideMaxAmount, buySideMaxAmount].reduce(
        (smallest, value) => value < smallest ? value : smallest,
      )
    : undefined;
  const amountWithinSellLimit = Boolean(
    amountIn && maxSellAmount !== undefined && amountIn <= maxSellAmount,
  );
  const predictedNavValue = vault.navValue !== undefined
    && inputTradeValue !== undefined
    && quotedOutputValue !== undefined
    && vault.navValue >= inputTradeValue
    ? vault.navValue - inputTradeValue + quotedOutputValue
    : undefined;
  const predictedInputValue = inputBalanceValue !== undefined && inputTradeValue !== undefined
    ? inputBalanceValue > inputTradeValue ? inputBalanceValue - inputTradeValue : 0n
    : undefined;
  const predictedOutputValue = outputBalanceValue !== undefined && quotedOutputValue !== undefined
    ? outputBalanceValue + quotedOutputValue
    : undefined;
  const predictedInputWeight = weightPercentFromValue(predictedInputValue, predictedNavValue);
  const predictedOutputWeight = weightPercentFromValue(predictedOutputValue, predictedNavValue);
  const predictedOutputWeightScaled = predictedOutputValue !== undefined
    && predictedNavValue !== undefined
    && predictedNavValue > 0n
    ? predictedOutputValue * weightScale / predictedNavValue
    : undefined;
  const predictedOutputDeviationScaled = predictedOutputWeightScaled !== undefined && outputTargetWeightScaled !== undefined
    ? predictedOutputWeightScaled >= outputTargetWeightScaled
      ? predictedOutputWeightScaled - outputTargetWeightScaled
      : outputTargetWeightScaled - predictedOutputWeightScaled
    : undefined;
  const buyWouldMoveFartherFromTarget = Boolean(
    predictedOutputDeviationScaled !== undefined
      && outputCurrentDeviationScaled !== undefined
      && predictedOutputDeviationScaled > outputCurrentDeviationScaled,
  );
  const predictedWeightsReady = predictedInputWeight !== undefined && predictedOutputWeight !== undefined;
  const tradeWeightPreview = [
    inputAsset ? { asset: inputAsset, predicted: predictedInputWeight } : undefined,
    outputAsset ? { asset: outputAsset, predicted: predictedOutputWeight } : undefined,
  ].filter((item): item is { asset: Allocation; predicted: number | undefined } => Boolean(item));

  const resetTradeState = useCallback(() => {
    setTxState((current) => current === "idle" ? current : "idle");
    setTxError(undefined);
  }, []);

  useEffect(() => {
    const presetAmount = recommendedTradeAmount !== undefined
      ? recommendedTradeAmount * BigInt(tradeSize) / 100n
      : undefined;
    setAmountInText(presetAmount !== undefined ? formatUnits(presetAmount, tokenInDecimals) : "");
    resetTradeState();
  }, [recommendedTradeAmount, resetTradeState, tokenInDecimals, tradeSize]);

  const contractsConfigured = Boolean(adapterAddress && quoterAddress);
  const busy = txState === "simulating" || txState === "pending" || txState === "submitted";
  const canSubmit = Boolean(
    vault.address && vault.connectedIsManager && connectedAddress && publicClient && contractsConfigured &&
    hasAllowedTrade && amountWithinSellLimit && minAmountOut && routeValid && slippageValid &&
    routeLiquidityReady && predictedWeightsReady && !buyWouldMoveFartherFromTarget &&
    !oracleValueLossTooHigh && !navLossBudgetTooHigh,
  );

  async function executeTrade() {
    if (!canSubmit || !vault.address || !adapterAddress || !connectedAddress || !publicClient || !amountIn || !minAmountOut) return;
    setTxError(undefined);
    try {
      setTxState("simulating");
      if (!packedRoute) return;
      const trades = [{
        adapter: adapterAddress,
        tokenIn: tokenIn as `0x${string}`,
        tokenOut: tokenOut as `0x${string}`,
        amountIn: submitFullRetiringBalance ? maxUint256 : amountIn,
        minAmountOut,
        adapterData: packedRoute.path,
      }];
      await publicClient.simulateContract({
        account: connectedAddress,
        address: vault.address,
        abi: managedOtfVaultAbi,
        functionName: "executeRebalanceTrades",
        args: [trades],
      });
      setTxState("pending");
      const hash = await writeContractAsync({
        address: vault.address,
        abi: managedOtfVaultAbi,
        functionName: "executeRebalanceTrades",
        args: [trades],
        chainId: robinhoodChainTestnet.id,
      });
      setTxState("submitted");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The rebalance trade reverted.");
      await Promise.all([
        onRefresh(),
        refetchTokenInVaultBalance(),
        refetchTokenOutVaultBalance(),
      ]);
      await refetchRouteQuote();
      setTxState("confirmed");
      setAmountInText("");
    } catch (error) {
      setTxError(errorMessage(error));
      setTxState("reverted");
    }
  }

  return (
    <SectionCard
      title="Execute an allowed rebalance trade"
      subtitle="Sell an overweight constituent to buy an underweight constituent"
      icon={<RefreshCw size={15} />}
      action={<span className={`stateBadge ${hasAllowedTrade ? vault.strategicRebalanceActive ? "warning" : "success" : "muted"}`}>{hasAllowedTrade ? vault.strategicRebalanceActive ? "Target active" : "Trade available" : "No trade needed"}</span>}
    >
      <div className="rebalanceTradeForm">
        <PortfolioBandStatus vault={vault} context="rebalance" />
        <NavLossBudgetStatus vault={vault} />
        {!hasAllowedTrade ? (
          <div className="inlineEmptyState rebalanceEmptyState">
            <CheckCircle size={16} />
            <div><strong>No constrained trade is available</strong><span>The live basket has no overweight-to-underweight pair. Rebalance choices appear here only when a trade can move the portfolio closer to its active targets.</span></div>
          </div>
        ) : null}
        <div className="recommendedTradePlan">
          <div className="subHeader">
            <span>Recommended sequence</span>
            <small>{recommendedTrades.length} {recommendedTrades.length === 1 ? "trade" : "trades"} · {bpsToCompactPercent(recommendedTradeNavBps)} NAV planned · largest drift first</small>
          </div>
          <div className="recommendedTradeList" role="radiogroup" aria-label="Recommended rebalance trades">
            {recommendedTrades.map((trade) => {
              const selected = trade.sell.address === tokenIn && trade.buy.address === tokenOut;
              return (
                <button
                  className={selected ? "selected" : ""}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  key={`${trade.sell.address}-${trade.buy.address}`}
                  onClick={() => {
                    setTokenIn(trade.sell.address);
                    setTokenOut(trade.buy.address);
                    setTradeSize(100);
                    setRouteText("");
                    resetTradeState();
                  }}
                >
                  <span className="recommendedTradeAsset">
                    <AssetLogo logoUrl={trade.sell.logoUrl} symbol={trade.sell.symbol} compact />
                    <span><small>Sell</small><strong>{trade.sell.symbol}</strong></span>
                  </span>
                  <ArrowRight size={14} />
                  <span className="recommendedTradeAsset">
                    <AssetLogo logoUrl={trade.buy.logoUrl} symbol={trade.buy.symbol} compact />
                    <span><small>Buy</small><strong>{trade.buy.symbol}</strong></span>
                  </span>
                  <span className="recommendedTradeWeight">{bpsToCompactPercent(trade.transferBps)} NAV</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="tradeSizeControl">
          <div className="subHeader">
            <span>Trade size</span>
          </div>
          <div className="tradeSizeOptions" role="radiogroup" aria-label="Trade size">
            {([10, 25, 50, 100] as const).map((size) => (
              <button
                className={tradeSize === size ? "active" : ""}
                type="button"
                role="radio"
                aria-checked={tradeSize === size}
                key={size}
                onClick={() => {
                  setTradeSize(size);
                  resetTradeState();
                }}
              >
                {size}%
              </button>
            ))}
          </div>
        </div>

        <div className="tradeInputGrid">
          <label>
            <span>Amount to sell</span>
            <div className="inputWithSuffix tradeAmountInput">
              <input
                type="number"
                min="0"
                inputMode="decimal"
                value={amountInText}
                disabled={!hasAllowedTrade}
                readOnly
                placeholder="0.00"
              />
              <span>{inputAsset?.symbol ?? "Asset"}</span>
            </div>
          </label>
          <label>
            <span>Maximum pool slippage</span>
            <div className="inputWithSuffix">
              <input type="number" min="0.01" max="20" step="0.1" value={slippageText} disabled={!hasAllowedTrade} onChange={(event) => { setSlippageText(event.target.value); resetTradeState(); }} />
              <span>%</span>
            </div>
          </label>
        </div>

        <label className="tradeRouteField">
          <span>Uniswap V3 execution path</span>
          <textarea
            rows={3}
            spellCheck={false}
            value={routeText}
            disabled={!hasAllowedTrade}
            placeholder={automaticPackedPath ?? "No automatic route is configured"}
            onChange={(event) => {
              setRouteText(event.target.value.trim());
              resetTradeState();
            }}
          />
          <small>
            Leave blank to use the discovered route. A custom packed path may use any intermediate
            tokens, but must begin with the sold asset and end with the purchased asset.
          </small>
        </label>

        <div className="tradeExecutionQuote">
          <span>Uniswap quote</span>
          <strong>
            {quoteLoading ? "Loading" : quotedAmountOut
              ? `${formatWalletTokenBalance(quotedAmountOut, tokenOutDecimals)} ${outputAsset?.symbol ?? "tokens"}`
              : "Enter an amount"}
          </strong>
          <span>Quoted slippage vs oracle</span>
          <strong>{formatQuotedSlippage(quotedOracleSlippageBps)}</strong>
          <small>{routeLabel ?? "No valid execution path"}</small>
        </div>

        <div className="previewBlock tradeWeightPreview">
          <div className="subHeader">
            <span>Weight preview</span>
            <small>Based on the current pool quote</small>
          </div>
          <div className="weightPreviewList">
            {tradeWeightPreview.map(({ asset, predicted }) => {
              const current = asset.actualWeightBps / 100;
              const target = asset.targetWeightBps / 100;
              return (
                <div className="weightPreviewRow" key={`${asset.address}-trade-preview`}>
                  <span className="assetNameWithLogo">
                    <AssetLogo logoUrl={asset.logoUrl} symbol={asset.symbol} compact />
                    <strong>{asset.symbol}</strong>
                  </span>
                  <div className="weightTrack" aria-label={`${asset.symbol} current weight ${current.toFixed(1)}%, predicted weight ${predicted?.toFixed(1) ?? "unavailable"}%, target weight ${target.toFixed(1)}%`}>
                    <span style={{ width: `${Math.min(current, 100)}%` }} />
                    {predicted !== undefined ? <i className="draft" style={{ left: `${Math.min(Math.max(predicted, 0), 100)}%` }} /> : null}
                    <i className="active" style={{ left: `${Math.min(target, 100)}%` }} />
                  </div>
                  <div className="weightPreviewValues">
                    <span><small>Current</small>{current.toFixed(1)}%</span>
                    <strong><small>Predicted</small>{predicted === undefined ? "—" : `${predicted.toFixed(1)}%`}</strong>
                    <span><small>Target</small>{target.toFixed(1)}%</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="weightPreviewLegend" aria-hidden="true">
            <span className="live">Current weight</span>
            <span className="draft">Predicted weight</span>
            <span className="active">Current target</span>
          </div>
        </div>

        {!contractsConfigured ? (
          <div className="validationSummary warning"><AlertTriangle size={15} /><div><strong>Trading adapter not configured</strong><span>Deploy and configure the approved Uniswap adapter before submitting rebalance trades.</span></div></div>
        ) : null}
        {hasAllowedTrade && contractsConfigured && !customRoute && !rebalanceLiquidityLoading && !rebalancePoolsConfigured ? (
          <div className="validationSummary warning"><AlertTriangle size={15} /><div><strong>No automatic V3 route found</strong><span>The canonical factory did not return a usable liquid route for this asset pair. You may supply another valid packed route.</span></div></div>
        ) : null}
        {hasAllowedTrade && contractsConfigured && !customRoute && rebalancePoolsConfigured && !rebalanceLiquidityLoading && !configuredRouteLiquidityReady ? (
          <div className="validationSummary warning"><AlertTriangle size={15} /><div><strong>Awaiting discovered-route liquidity</strong><span>The discovered pools exist, but this route stays disabled until each required pool has active liquidity. You may supply another valid packed route.</span></div></div>
        ) : null}
        {hasAllowedTrade && customRoute && !routeValid ? (
          <div className="validationSummary warning" role="alert"><AlertTriangle size={15} /><div><strong>Execution path does not match this trade</strong><span>Use packed Uniswap V3 bytes beginning with {inputAsset?.symbol ?? "the sold asset"} and ending with {outputAsset?.symbol ?? "the purchased asset"}, with a nonzero fee for every hop.</span></div></div>
        ) : null}
        {hasAllowedTrade && tokenIn === tokenOut ? (
          <div className="validationSummary warning"><AlertTriangle size={15} /><div><strong>Select two different assets</strong><span>The sold and purchased constituents cannot be the same token.</span></div></div>
        ) : null}
        {buyWouldMoveFartherFromTarget ? (
          <div className="validationSummary warning"><AlertTriangle size={15} /><div><strong>{outputAsset?.symbol ?? "The buy asset"} would move too far past its target</strong><span>Crossing the target is allowed, but its predicted distance from target cannot exceed its current distance.</span></div></div>
        ) : null}
        {oracleValueLossTooHigh ? (
          <div className="validationSummary warning"><AlertTriangle size={15} /><div><strong>Pool price impact is too high</strong><span>This quote loses approximately {(quotedOracleLossBps / 100).toFixed(2)}% of oracle value; the OTF allows at most {(vault.maxNavLossBps / 100).toFixed(2)}%. Choose a smaller percentage.</span></div></div>
        ) : null}
        {navLossBudgetTooHigh ? (
          <div className="validationSummary warning"><AlertTriangle size={15} /><div><strong>Seven-day NAV-loss budget is exhausted</strong><span>This quote would consume about {bpsToPercent(quotedPortfolioLossBps)} of portfolio NAV, but only {bpsToPercent(remainingNavLossBps)} currently remains. Reduce the trade loss or wait for capacity to replenish continuously.</span></div></div>
        ) : null}
        {quoteError ? (
          <div className="validationSummary danger"><XCircle size={15} /><div><strong>No usable pool quote</strong><span>{errorMessage(quoteError)}</span></div></div>
        ) : null}
        {txError ? (
          <div className="validationSummary danger"><XCircle size={15} /><div><strong>Trade failed</strong><span>{txError}</span></div></div>
        ) : null}
        <div className="riskCallout info"><ShieldCheck size={15} /><div><strong>The OTF contract performs the final checks</strong><span>The trade must use active constituents and an approved adapter, fit within the remaining seven-day NAV-loss budget, avoid moving any asset farther from target, and improve the portfolio overall.</span></div></div>
        <TxStatus state={txState} />
        <button className="primaryAction" type="button" disabled={!canSubmit || busy} onClick={executeTrade}>
          {busy ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />}
          {txState === "simulating" ? "Checking safety limits" : txState === "pending" ? "Confirm in wallet" : txState === "submitted" ? "Executing trade" : "Execute rebalance trade"}
        </button>
      </div>
    </SectionCard>
  );
}

function StrategyChallenge({ vault, onRefresh }: { vault: VaultView; onRefresh: () => Promise<unknown> }) {
  const [challengeState, setChallengeState] = useState<TxState>("idle");
  const [challengeError, setChallengeError] = useState<string>();
  const [challengeInfoOpen, setChallengeInfoOpen] = useState(false);
  const [rewardState, setRewardState] = useState<TxState>("idle");
  const [rewardError, setRewardError] = useState<string>();
  const { address: connectedAddress } = useAccount();
  const publicClient = usePublicClient({ chainId: robinhoodChainTestnet.id });
  const { writeContractAsync } = useWriteContract();
  const challengeBusy = challengeState === "pending" || challengeState === "submitted";
  const rewardBusy = rewardState === "pending" || rewardState === "submitted";
  const connectedIsChallengeCaller = Boolean(
    connectedAddress && vault.challengeCaller
      && connectedAddress.toLowerCase() === vault.challengeCaller.toLowerCase(),
  );
  const overdueRewardCanBeSettled = Boolean(
    vault.challengeActive && vault.challengeTimeRemaining === 0 && connectedIsChallengeCaller,
  );
  const hasStoredReward = Boolean(
    vault.claimableChallengeRewardValue && vault.claimableChallengeRewardValue > 0n,
  );
  const { data: challengeRewardPreview } = useSimulateContract({
    account: connectedAddress,
    address: vault.address,
    abi: managedOtfVaultAbi,
    functionName: "claimChallengeReward",
    chainId: robinhoodChainTestnet.id,
    query: {
      enabled: Boolean(vault.enabled && vault.address && overdueRewardCanBeSettled && !hasStoredReward),
    },
  });
  const simulatedChallengeReward = challengeRewardPreview?.result;
  const challengeRewardDisplay = hasStoredReward
    ? vault.claimableChallengeRewardShares
    : simulatedChallengeReward !== undefined
      ? `${formatWalletTokenBalance(simulatedChallengeReward, 18)} ${vault.symbol}`
      : overdueRewardCanBeSettled
        ? "Calculating"
        : vault.claimableChallengeRewardShares;
  const canClaimReward = hasStoredReward || overdueRewardCanBeSettled;
  const challengeAction = !vault.challengeActive
    ? vault.withinChallengeBands ? undefined : "flagOutOfBand"
    : vault.withinCompletionBands
      ? "resolveOutOfBandChallenge"
      : undefined;

  function startOrExplainChallenge() {
    if (!connectedAddress || challengeAction !== "flagOutOfBand") {
      setChallengeInfoOpen(true);
      return;
    }
    setChallengeInfoOpen(false);
    void submitChallengeAction();
  }

  async function submitChallengeAction() {
    if (!challengeAction || !vault.address || !connectedAddress || !publicClient) return;
    setChallengeError(undefined);
    try {
      setChallengeState("pending");
      const hash = await writeContractAsync({
        address: vault.address,
        abi: managedOtfVaultAbi,
        functionName: challengeAction,
        chainId: robinhoodChainTestnet.id,
      });
      setChallengeState("submitted");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The challenge transaction reverted.");
      await onRefresh();
      setChallengeState("confirmed");
    } catch (error) {
      setChallengeError(errorMessage(error));
      setChallengeState("reverted");
    }
  }

  return (
    <div className={`challengeActionBlock portfolioChallenge ${vault.challengeActive ? "active" : ""}`}>
      {vault.challengeActive ? (
        <>
          <ChallengeCountdownBanner vault={vault} />
          <div className="challengeRewardLine">
            <span>Caller reward</span>
            <strong>{challengeRewardDisplay}</strong>
          </div>
          {challengeError ? <div className="validationSummary danger" role="alert"><AlertTriangle size={15} /><div><strong>Challenge transaction failed</strong><span>{challengeError}</span></div></div> : null}
          {rewardError ? <div className="validationSummary danger" role="alert"><AlertTriangle size={15} /><div><strong>Reward claim failed</strong><span>{rewardError}</span></div></div> : null}
          <TxStatus state={challengeState} />
          <TxStatus state={rewardState} />
          <div className="buttonRow">
            {challengeAction === "resolveOutOfBandChallenge" ? (
              <button className="secondaryAction" type="button" disabled={!connectedAddress || challengeBusy} onClick={submitChallengeAction}>
                <ShieldCheck size={14} />
                {challengeBusy ? challengeState === "pending" ? "Confirm in wallet" : "Confirming transaction" : "Resolve challenge"}
              </button>
            ) : null}
            <button className="secondaryAction" type="button" disabled={!connectedAddress || !canClaimReward || rewardBusy} onClick={claimChallengeReward}>
              <CircleDollarSign size={14} />
              {rewardBusy ? "Claiming reward" : "Claim reward"}
            </button>
          </div>
        </>
      ) : (
        <>
          <button className="secondaryAction" type="button" disabled={challengeBusy} onClick={startOrExplainChallenge}>
            <ShieldCheck size={14} />
            {challengeBusy ? challengeState === "pending" ? "Confirm in wallet" : "Confirming transaction" : "Start a challenge"}
          </button>
          {challengeInfoOpen ? (
            <div className="validationSummary" role="status">
              <Info size={15} />
              <div>
                <strong>{connectedAddress ? "Challenge unavailable" : "Connect a wallet first"}</strong>
                <span>{connectedAddress
                  ? `A challenge can start only when at least one asset is more than ${bpsToPercent(vault.challengeWeightDeviationBps)} away from its target. Every asset is currently within that range.`
                  : "Connect a wallet to start a challenge when the portfolio moves outside its challenge band."}</span>
              </div>
            </div>
          ) : null}
          {challengeError ? <div className="validationSummary danger" role="alert"><AlertTriangle size={15} /><div><strong>Challenge transaction failed</strong><span>{challengeError}</span></div></div> : null}
          <TxStatus state={challengeState} />
        </>
      )}
    </div>
  );

  async function claimChallengeReward() {
    if (!vault.address || !connectedAddress || !publicClient || !canClaimReward) return;
    setRewardError(undefined);
    try {
      setRewardState("pending");
      const hash = await writeContractAsync({
        address: vault.address,
        abi: vaultFeeAbi,
        functionName: "claimChallengeReward",
        chainId: robinhoodChainTestnet.id,
      });
      setRewardState("submitted");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The reward claim reverted.");
      await onRefresh();
      setRewardState("confirmed");
    } catch (error) {
      setRewardError(errorMessage(error));
      setRewardState("reverted");
    }
  }
}

function NavLossBudgetStatus({ vault }: { vault: VaultView }) {
  const navLossBudgetUsedPercent = vault.maxNavLossBps > 0
    ? Math.min(100, vault.navLossBudgetUsedBps * 100 / vault.maxNavLossBps)
    : 0;
  const remainingNavLossBps = Math.max(0, vault.maxNavLossBps - vault.navLossBudgetUsedBps);
  const tone = remainingNavLossBps === 0
    ? "exhausted"
    : navLossBudgetUsedPercent >= 75
      ? "warning"
      : "available";
  const recoveryMessage = vault.navLossBudgetUsedBps === 0
    ? "Full capacity available"
    : vault.navLossBudgetRecoveryAt
      ? `Full capacity by ${formatTimestamp(vault.navLossBudgetRecoveryAt)}`
      : "Used capacity replenishes continuously over seven days";

  return (
    <div className={`navLossBudget ${tone}`}>
      <div className="navLossBudgetHeader">
        <div>
          <span>Seven-day NAV-loss budget</span>
          <strong>{bpsToPercent(vault.navLossBudgetUsedBps)} consumed</strong>
        </div>
        <div className="navLossBudgetRemaining">
          <span>Remaining</span>
          <strong>{bpsToPercent(remainingNavLossBps)}</strong>
        </div>
      </div>
      <div
        className="navLossBudgetTrack"
        role="progressbar"
        aria-label={`NAV-loss budget: ${bpsToPercent(vault.navLossBudgetUsedBps)} consumed of ${bpsToPercent(vault.maxNavLossBps)}`}
        aria-valuemin={0}
        aria-valuemax={vault.maxNavLossBps}
        aria-valuenow={vault.navLossBudgetUsedBps}
      >
        <span style={{ width: `${navLossBudgetUsedPercent}%` }} />
      </div>
      <div className="navLossBudgetMeta">
        <span>{bpsToPercent(vault.maxNavLossBps)} total</span>
        <span>{recoveryMessage}</span>
      </div>
    </div>
  );
}

function SafetyLimits({ vault }: { vault: VaultView }) {
  const limits = [
    ["Seven-day NAV-loss budget", bpsToPercent(vault.maxNavLossBps), "Cumulative, gains do not restore capacity"],
    ["Maximum target deviation", `+/- ${bpsToPercent(vault.maxWeightDeviationBps)}`, "From oracle-priced actual weight"],
    ["Challenge deviation", `+/- ${bpsToPercent(vault.challengeWeightDeviationBps)}`, "Permissionless escalation threshold"],
    ["Minimum target weight", vault.minTargetWeightBps === undefined ? "Loading" : bpsToPercent(vault.minTargetWeightBps), "Admin-controlled protocol floor"],
    ["Protocol strategy cooldown", formatCooldown(vault.cooldownSeconds), "Fixed protocol rule; not configurable per OTF"],
    ["Strategy activation delay", "48 hours", "Holder exit window"],
  ] as const;

  return (
    <SectionCard
      title="Safety limits"
      subtitle="Protocol-enforced configuration"
      icon={<ShieldCheck size={15} />}
      action={<span className="stateBadge muted"><LockKeyhole size={11} /> Enforced onchain</span>}
    >
      <div className="limitList">
        {limits.map(([label, value, description]) => (
          <div className="limitRow" key={label}>
            <div>
              <strong>{label}</strong>
              <small>{description}</small>
            </div>
            <span>{value}</span>
          </div>
        ))}
      </div>
      <NavLossBudgetStatus vault={vault} />
      <div className="executionPolicy">
        <ShieldCheck size={14} />
        <div>
          <strong>Bounded execution</strong>
          <span>Every rebalance uses listed assets and approved adapters, and settles atomically or fully reverts.</span>
        </div>
      </div>
    </SectionCard>
  );
}

function AppPageHeader({
  title,
  description,
  icon,
  actions,
}: {
  title: string;
  description: ReactNode;
  icon: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="appPageHeader">
      <div>
        <span className="appPageIcon">{icon}</span>
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </div>
      {actions ? <div className="appPageActions">{actions}</div> : null}
    </header>
  );
}

function UnconfiguredOtfView({
  isLoading,
  onBack,
}: {
  isLoading: boolean;
  onBack: () => void;
}) {
  return (
    <div className="appView">
      <div className="vaultBreadcrumb appBreadcrumb">
        <button type="button" onClick={onBack}>
          <ArrowLeft size={12} />
          OTFs
        </button>
      </div>
      <AppPageHeader
        title={isLoading ? "Loading OTF" : "No OTF connected"}
        description={isLoading ? "Loading OTF data from Robinhood Testnet." : "This OTF is not available in the current protocol deployment."}
        icon={isLoading ? <RefreshCw className="spin" size={18} /> : <Landmark size={18} />}
      />
      <section className="sectionCard depositsEmpty">
        <span>{isLoading ? <RefreshCw className="spin" size={22} /> : <Landmark size={22} />}</span>
        <h2>{isLoading ? "Reading contract state" : "Deploy or configure an OTF first"}</h2>
        <p>
          {isLoading
            ? "The interface will open the OTF as soon as its contract reads complete."
            : "No OTF is available in the current network deployment yet."}
        </p>
        <button className="secondaryAction" type="button" onClick={onBack}>
          <ArrowLeft size={14} />
          Back to OTFs
        </button>
      </section>
    </div>
  );
}

function VaultsDirectory({
  currentVault,
  vaults,
  isTestnet,
  aumLoading,
  onOpenVault,
}: {
  currentVault: VaultView;
  vaults: VaultSummary[];
  isTestnet: boolean;
  aumLoading: boolean;
  onOpenVault: (address: `0x${string}`) => void;
}) {
  const testnetCreateAssets = useVerifiedAssetCatalog();
  const [query, setQuery] = useState("");
  const [directoryView, setDirectoryView] = useState<"rows" | "cards">("rows");

  if (!isTestnet) {
    return (
      <div className="appView">
        <AppPageHeader
          title="Onchain Traded Funds"
          description="Discover and monitor managed onchain funds."
          icon={<LayoutGrid size={18} />}
        />
        <section className="sectionCard depositsEmpty">
          <span><Network size={22} /></span>
          <h2>Robinhood Mainnet is not supported yet</h2>
          <p>No assets, liquidity adapters, or OTF deployments are configured on Robinhood Mainnet. Enable Testnet in Settings to use the current protocol deployment.</p>
        </section>
      </div>
    );
  }

  const normalizedQuery = query.trim().toLowerCase();
  const visibleRows = vaults.filter(
    (row) =>
      !normalizedQuery ||
      row.name.toLowerCase().includes(normalizedQuery) ||
      row.symbol.toLowerCase().includes(normalizedQuery) ||
      row.address.toLowerCase().includes(normalizedQuery),
  );
  const readableNavCount = vaults.filter((vault) => vault.navValue !== undefined).length;
  const totalAumValue = vaults.reduce((total, vault) => total + (vault.navValue ?? 0n), 0n);
  const totalAum = !isTestnet
    ? "$0.00"
    : aumLoading
      ? "Loading"
      : readableNavCount === vaults.length
        ? formatUsd18(totalAumValue) ?? "$0.00"
        : "Unavailable";

  return (
    <div className="appView">
      <AppPageHeader
        title="Onchain Traded Funds"
        description="Discover and monitor managed onchain funds."
        icon={<LayoutGrid size={18} />}
      />

      <DataProvenance vault={currentVault} factory />

      <div className="directoryMetrics">
        <MetricCard label="Total AUM" value={totalAum} icon={null} />
        <MetricCard label="OTFs" value={String(vaults.length)} icon={null} />
        <MetricCard label="Verified asset records" value={isTestnet ? String(testnetCreateAssets.length) : "0"} icon={null} />
      </div>

      <section className="sectionCard directoryPanel">
        <div className="directoryToolbar">
          <label className="searchField">
            <Search size={14} />
            <input aria-label="Search OTFs" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by OTF name or symbol" />
          </label>
          <div className="directoryViewToggle" role="group" aria-label="OTF directory view">
            <button
              className={directoryView === "rows" ? "active" : ""}
              type="button"
              aria-label="Show OTFs as rows"
              aria-pressed={directoryView === "rows"}
              title="Show OTFs as rows"
              onClick={() => setDirectoryView("rows")}
            >
              <List size={15} />
            </button>
            <button
              className={directoryView === "cards" ? "active" : ""}
              type="button"
              aria-label="Show OTFs as cards"
              aria-pressed={directoryView === "cards"}
              title="Show OTFs as cards"
              onClick={() => setDirectoryView("cards")}
            >
              <LayoutGrid size={15} />
            </button>
          </div>
        </div>

        <div className={directoryView === "cards" ? "directoryCardsWrap" : "directoryTableWrap"}>
          <div className="directoryCards" aria-label="OTF cards">
            {visibleRows.map((row) => (
              <article
                key={row.address}
                className="directoryCard"
                role="button"
                tabIndex={0}
                onClick={() => onOpenVault(row.address)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") onOpenVault(row.address);
                }}
              >
                <div className="directoryCardHeader">
                  <div className="directoryVault">
                    <OtfTokenIcon className="directoryVaultIcon" size={40} ticker={row.symbol} />
                    <div>
                      <strong>{row.name}</strong>
                      <small>{row.symbol} · {shortAddress(row.address)} {row.sunset ? "· Sunset" : ""}</small>
                    </div>
                  </div>
                  <ChevronRight className="directoryCardArrow" size={16} />
                </div>
                <span className={`stateBadge ${row.verified ? "success" : "warning"}`}>
                  {row.verified ? "Verified assets" : "Unverified assets"}
                </span>
                <div className="directoryCardStats">
                  <div>
                    <span>NAV</span>
                    <strong>{row.nav ?? "Oracle read failed"}</strong>
                  </div>
                  <div>
                    <span>Assets</span>
                    <strong>{row.assetCount}</strong>
                  </div>
                  <div>
                    <span>Manager fee</span>
                    <strong>{bpsToPercent(row.managerFeeBps)}</strong>
                  </div>
                  <div>
                    <span>Manager</span>
                    <strong className="monoValue">{shortAddress(row.manager)}</strong>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <table className="directoryTable">
            <thead>
              <tr>
                <th>OTF</th>
                <th>NAV</th>
                <th>Assets</th>
                <th>Manager fee</th>
                <th>Manager</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr
                  key={row.address}
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenVault(row.address)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") onOpenVault(row.address);
                  }}
                >
                  <td>
                    <div className="directoryVault">
                      <OtfTokenIcon className="directoryVaultIcon" size={34} ticker={row.symbol} />
                      <div>
                        <strong>{row.name}</strong>
                        <small>{row.symbol} · {shortAddress(row.address)} {row.sunset ? "· Sunset" : ""}</small>
                        <span className={`stateBadge ${row.verified ? "success" : "warning"}`}>
                          {row.verified ? "Verified assets" : "Unverified assets"}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td data-label="NAV">{row.nav ?? "Oracle read failed"}</td>
                  <td data-label="Assets">{row.assetCount}</td>
                  <td data-label="Manager fee">{bpsToPercent(row.managerFeeBps)}</td>
                  <td data-label="Manager" className="monoValue">{shortAddress(row.manager)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visibleRows.length ? (
            <div className="emptyDirectory">
              <Search size={18} />
              <strong>{isTestnet && vaults.length ? "No matching OTFs" : isTestnet ? "No testnet OTFs yet" : "No Mainnet OTFs"}</strong>
              <span>{isTestnet && vaults.length ? "Try a different OTF name, symbol, or address." : isTestnet ? "New OTFs will appear here automatically." : "Switch to Robinhood Testnet to use the current protocol deployment."}</span>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function CreateVaultView({
  connectedAddress,
  isTestnet,
  onBack,
  onCreated,
}: {
  connectedAddress?: string;
  isTestnet: boolean;
  onBack: () => void;
  onCreated: (address: `0x${string}`, transactionHash: `0x${string}`) => void;
}) {
  const testnetCreateAssets = useVerifiedAssetCatalog();
  const factoryAddress = configuredFactoryAddress();
  const { data: protocolMinimumTargetWeightResult } = useReadContract({
    address: factoryAddress,
    abi: otfFactoryAbi,
    functionName: "minTargetWeightBps",
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(isTestnet && factoryAddress) },
  });
  const protocolMinimumTargetWeightBps = protocolMinimumTargetWeightResult === undefined
    ? undefined
    : Number(protocolMinimumTargetWeightResult);
  const { data: challengeGracePeriodResult } = useReadContract({
    address: factoryAddress,
    abi: otfFactoryAbi,
    functionName: "challengeGracePeriod",
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(isTestnet && factoryAddress) },
  });
  const challengeGracePeriod = challengeGracePeriodResult === undefined
    ? undefined
    : Number(challengeGracePeriodResult);
  const weightBandPolicyContracts = factoryAddress ? ([
    { address: factoryAddress, abi: otfFactoryAbi, functionName: "minCompletionDeviationBps" },
    { address: factoryAddress, abi: otfFactoryAbi, functionName: "maxCompletionDeviationBps" },
    { address: factoryAddress, abi: otfFactoryAbi, functionName: "minChallengeDeviationGapBps" },
    { address: factoryAddress, abi: otfFactoryAbi, functionName: "maxChallengeDeviationBps" },
  ] as const) : undefined;
  const {
    data: weightBandPolicyResults,
    isLoading: weightBandPolicyLoading,
    isError: weightBandPolicyReadFailed,
  } = useReadContracts({
    contracts: weightBandPolicyContracts,
    query: { enabled: Boolean(isTestnet && factoryAddress), refetchInterval: 12_000 },
  });
  const weightBandLimits: WeightBandLimits | undefined = weightBandPolicyResults?.length === 4 && weightBandPolicyResults.every(
    (result) => result.status === "success",
  ) ? {
      minCompletionDeviationBps: Number(weightBandPolicyResults[0].result),
      maxCompletionDeviationBps: Number(weightBandPolicyResults[1].result),
      minChallengeDeviationGapBps: Number(weightBandPolicyResults[2].result),
      maxChallengeDeviationBps: Number(weightBandPolicyResults[3].result),
    } : undefined;
  const {
    data: protocolDepositsPausedResult,
    isLoading: protocolDepositsPauseLoading,
    isError: protocolDepositsPauseReadFailed,
  } = useReadContract({
    address: factoryAddress,
    abi: otfFactoryAbi,
    functionName: "depositsPaused",
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(isTestnet && factoryAddress), refetchInterval: 12_000 },
  });
  const protocolDepositsPaused = Boolean(protocolDepositsPausedResult);
  const protocolDepositsPauseUnavailable = Boolean(isTestnet && factoryAddress) && (
    protocolDepositsPauseLoading || protocolDepositsPauseReadFailed || protocolDepositsPausedResult === undefined
  );
  const { data: factoryPricingResolver } = useReadContract({
    address: factoryAddress,
    abi: otfFactoryAbi,
    functionName: "pricingResolver",
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(isTestnet && factoryAddress) },
  });
  const pricingResolverAddress = isAddress(factoryPricingResolver ?? "")
    ? factoryPricingResolver as `0x${string}`
    : undefined;
  const [step, setStep] = useState(0);
  const [furthestStep, setFurthestStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(() => new Set());
  const [deployState, setDeployState] = useState<TxState>("idle");
  const [deployTxHash, setDeployTxHash] = useState<`0x${string}`>();
  const [deployError, setDeployError] = useState<string>();
  const [approvalState, setApprovalState] = useState<TxState>("idle");
  const [, setApprovalTxHash] = useState<`0x${string}`>();
  const [approvalAssetAddress, setApprovalAssetAddress] = useState<`0x${string}`>();
  const [approvalError, setApprovalError] = useState<string>();
  const [approvalBatchProgress, setApprovalBatchProgress] = useState<{
    current: number;
    total: number;
    ticker: string;
  }>();
  const [customManager, setCustomManager] = useState(false);
  const [customFeeRecipient, setCustomFeeRecipient] = useState(false);
  const { writeContractAsync } = useWriteContract();
  const { writeContractAsync: writeApprovalContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: robinhoodChainTestnet.id });
  const [draft, setDraft] = useState({
    name: "",
    symbol: "",
    rationale: "",
    manager: connectedAddress ?? "",
    feeRecipient: connectedAddress ?? "",
    managerFee: "0.50",
    initialShares: "100",
    initialPortfolioValue: "5",
    maxNavLoss: "0.5",
    maxDeviation: String(DEFAULT_COMPLETION_DEVIATION_BPS / 100),
    challengeDeviation: String(DEFAULT_CHALLENGE_DEVIATION_BPS / 100),
  });
  const [portfolio, setPortfolio] = useState<TargetAsset[]>(
    testnetCreateAssets.slice(0, 2).map((asset) => {
      const pricingConfig = configuredPricingConfig(asset.address) ?? emptyPricingConfig();
      return {
        ticker: asset.symbol,
        name: asset.name,
        address: asset.address,
        poolAddress: pricingConfig.source === 2 ? pricingConfig.primarySource : undefined,
        verified: asset.verified,
        pricingConfig,
        targetWeight: 100 / Math.min(testnetCreateAssets.length, 2),
        initialAmount: "",
      };
    }),
  );
  useEffect(() => {
    if (testnetCreateAssets.some((asset) => asset.metadataLoading)) return;
    setPortfolio((current) => current.map((item) => {
      const metadata = testnetCreateAssets.find(
        (asset) => asset.address.toLowerCase() === item.address.toLowerCase(),
      );
      return metadata ? {
        ...item,
        ticker: metadata.symbol,
        name: metadata.name,
        verified: metadata.verified,
      } : item;
    }));
  }, [testnetCreateAssets]);
  const [manualAssetAddress, setManualAssetAddress] = useState("");
  const [manualRegistrationState, setManualRegistrationState] = useState<TxState>("idle");
  const [manualRegistrationError, setManualRegistrationError] = useState<string>();
  const [unverifiedAssetIndex, setUnverifiedAssetIndex] = useState<number>();
  const [openAssetPickerIndex, setOpenAssetPickerIndex] = useState<number>();
  const [assetPickerSearch, setAssetPickerSearch] = useState("");
  const normalizedAssetPickerSearch = assetPickerSearch.trim().toLowerCase();
  const filteredAssetPickerOptions = testnetCreateAssets.filter((asset) => (
    !normalizedAssetPickerSearch
    || asset.symbol.toLowerCase().includes(normalizedAssetPickerSearch)
    || asset.address.toLowerCase().includes(normalizedAssetPickerSearch)
  ));
  const exactVerifiedSearchMatch = testnetCreateAssets.some(
    (asset) => asset.address.toLowerCase() === normalizedAssetPickerSearch,
  );
  const assetSearchAddress = openAssetPickerIndex !== undefined
    && !exactVerifiedSearchMatch
    && isAddress(assetPickerSearch.trim())
      ? assetPickerSearch.trim() as `0x${string}`
      : undefined;
  const {
    data: assetSearchMetadataResults,
    isLoading: assetSearchMetadataLoading,
    isError: assetSearchMetadataReadFailed,
  } = useReadContracts({
    contracts: assetSearchAddress ? [
      { address: assetSearchAddress, abi: erc20MetadataReadAbi, functionName: "name" as const, chainId: robinhoodChainTestnet.id },
      { address: assetSearchAddress, abi: erc20MetadataReadAbi, functionName: "symbol" as const, chainId: robinhoodChainTestnet.id },
      { address: assetSearchAddress, abi: erc20MetadataReadAbi, functionName: "decimals" as const, chainId: robinhoodChainTestnet.id },
    ] : [],
    query: { enabled: Boolean(assetSearchAddress) },
  });
  const assetSearchNameResult = assetSearchMetadataResults?.[0];
  const assetSearchSymbolResult = assetSearchMetadataResults?.[1];
  const assetSearchDecimalsResult = assetSearchMetadataResults?.[2];
  const assetSearchMetadata = assetSearchDecimalsResult?.status === "success" ? {
    name: assetSearchNameResult?.status === "success" ? String(assetSearchNameResult.result).trim().slice(0, 80) : "Unindexed token",
    symbol: assetSearchSymbolResult?.status === "success" ? String(assetSearchSymbolResult.result).trim().slice(0, 16) : "TOKEN",
    decimals: Number(assetSearchDecimalsResult.result),
  } : undefined;
  const assetSearchMetadataPending = Boolean(
    assetSearchAddress
    && !assetSearchMetadataReadFailed
    && (assetSearchMetadataLoading || !assetSearchMetadataResults),
  );
  const [manualOraclePrices, setManualOraclePrices] = useState<Record<string, CatalogOraclePrice>>({});
  const [pricingQuotesPending, setPricingQuotesPending] = useState(false);
  const [pricingQuoteError, setPricingQuoteError] = useState<string>();
  const canReadSeedAuthorizations = Boolean(
    isTestnet && factoryAddress && connectedAddress && isAddress(connectedAddress),
  );
  const seedAuthorizationContracts = canReadSeedAuthorizations
    ? portfolio.flatMap((asset) => [
        {
          address: asset.address as `0x${string}`,
          abi: erc20BalanceAbi,
          functionName: "balanceOf" as const,
          args: [connectedAddress as `0x${string}`],
          chainId: robinhoodChainTestnet.id,
        },
        {
          address: asset.address as `0x${string}`,
          abi: erc20BalanceAbi,
          functionName: "allowance" as const,
          args: [connectedAddress as `0x${string}`, factoryAddress as `0x${string}`],
          chainId: robinhoodChainTestnet.id,
        },
      ])
    : [];
  const {
    data: seedAuthorizationResults,
    isLoading: seedAuthorizationsLoading,
    isError: seedAuthorizationsFailed,
    refetch: refetchSeedAuthorizations,
  } = useReadContracts({
    contracts: seedAuthorizationContracts,
    query: {
      enabled: canReadSeedAuthorizations,
      refetchInterval: 8_000,
      refetchOnWindowFocus: true,
    },
  });
  const pricingDraftKey = portfolio.map((asset) => (
    `${asset.address.toLowerCase()}:${asset.pricingConfig.source}:${asset.pricingConfig.quoteToken.toLowerCase()}:${asset.pricingConfig.primarySource.toLowerCase()}:${asset.pricingConfig.secondarySource.toLowerCase()}:${asset.pricingConfig.primaryMaxStaleness}:${asset.pricingConfig.secondaryMaxStaleness}`
  )).join("|");
  useEffect(() => {
    let cancelled = false;
    if (!publicClient || !pricingResolverAddress || portfolio.length === 0) {
      setManualOraclePrices({});
      setPricingQuotesPending(false);
      setPricingQuoteError(undefined);
      return;
    }
    setPricingQuotesPending(true);
    setPricingQuoteError(undefined);
    void Promise.all(portfolio.map(async (asset) => {
      try {
        if (!pricingConfigIsComplete(asset.pricingConfig)) {
          throw new Error("Pricing configuration is incomplete.");
        }
        const simulation = await publicClient.simulateContract({
          address: pricingResolverAddress,
          abi: assetPricingResolverAbi,
          functionName: "validateAndQuotePrice",
          args: [asset.address as `0x${string}`, asset.pricingConfig],
        });
        const [answer, decimals] = simulation.result;
        return {
          status: "fulfilled" as const,
          entry: [asset.address.toLowerCase(), {
            answer,
            decimals: Number(decimals),
            updatedAt: BigInt(Math.floor(Date.now() / 1_000)),
            value: Number(formatUnits(answer, Number(decimals))),
            display: formatOraclePrice(Number(formatUnits(answer, Number(decimals)))),
          }] as const,
        };
      } catch (error) {
        return {
          status: "rejected" as const,
          ticker: asset.ticker,
          reason: errorMessage(error),
        };
      }
    })).then((results) => {
      if (cancelled) return;
      const entries = results.flatMap((result) => result.status === "fulfilled" ? [result.entry] : []);
      const failures = results.flatMap((result) => result.status === "rejected"
        ? [`${result.ticker}: ${result.reason}`]
        : []);
      setManualOraclePrices(Object.fromEntries(entries));
      setPricingQuoteError(failures.length > 0 ? failures.join(" ") : undefined);
    }).catch((error) => {
      if (!cancelled) {
        setManualOraclePrices({});
        setPricingQuoteError(errorMessage(error));
      }
    }).finally(() => {
      if (!cancelled) setPricingQuotesPending(false);
    });
    return () => { cancelled = true; };
  // pricingDraftKey intentionally snapshots the exact user-selected addresses.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricingDraftKey, pricingResolverAddress, publicClient]);
  const steps = [
    { label: "Basics", description: "Identity and roles" },
    { label: "Portfolio", description: "Assets and weights" },
    { label: "Safety", description: "Portfolio limits" },
    { label: "Review", description: "Confirm deployment" },
  ];
  const totalWeight = portfolio.reduce((sum, asset) => sum + Number(asset.targetWeight || 0), 0);
  const targetWeightBps = portfolio.map((asset) => percentToBps(asset.targetWeight));
  const totalWeightBps = targetWeightBps.reduce((sum, weight) => sum + weight, 0);
  const totalWeightValid = totalWeightBps === 10_000;
  const portfolioAssetsUnique = new Set(portfolio.map((asset) => asset.address.toLowerCase())).size === portfolio.length;
  const portfolioWithinFrontendAssetCap = portfolio.length <= FRONTEND_MAX_TRACKED_ASSETS;
  let initialPortfolioValue: bigint | undefined;
  try {
    initialPortfolioValue = Number(draft.initialPortfolioValue) > 0
      ? parseUnits(draft.initialPortfolioValue, 18)
      : undefined;
  } catch {
    initialPortfolioValue = undefined;
  }
  const derivedSeedAmounts = portfolio.map((asset, index) => {
    const price = manualOraclePrices[asset.address.toLowerCase()];
    const targetValue = initialPortfolioValue !== undefined
      ? (initialPortfolioValue * BigInt(targetWeightBps[index] ?? 0)) / 10_000n
      : undefined;
    const requiredAmount =
      targetValue !== undefined && price?.answer !== undefined && price.answer > 0n && price.decimals !== undefined
        ? (targetValue * (10n ** BigInt(price.decimals))) / price.answer
        : undefined;
    return {
      requiredAmount,
      displayAmount: formatSeedTokenAmount(requiredAmount),
      displayTargetValue: targetValue === undefined
        ? "Loading"
        : formatOraclePrice(Number(formatUnits(targetValue, 18))),
      price,
    };
  });
  const pricingConfigsReady = portfolio.every((asset) => pricingConfigIsComplete(asset.pricingConfig));
  const seedOracleFreshnessReady = pricingConfigsReady && !pricingQuotesPending && !pricingQuoteError;
  const allSeedAmountsReady = derivedSeedAmounts.every(
    (seed) => seed.requiredAmount !== undefined && seed.requiredAmount > 0n,
  );
  const seedAuthorizations = portfolio.map((asset, index) => {
    const requiredAmount = derivedSeedAmounts[index]?.requiredAmount;
    const approvalAmount = requiredAmount === undefined
      ? undefined
      : (requiredAmount * 10_200n + 9_999n) / 10_000n;
    const balance = resultAt<bigint>(seedAuthorizationResults as ReadResult | undefined, index * 2);
    const allowance = resultAt<bigint>(seedAuthorizationResults as ReadResult | undefined, index * 2 + 1);
    return {
      ...asset,
      initialAmount: derivedSeedAmounts[index]?.displayAmount ?? "",
      requiredAmount,
      approvalAmount,
      balance,
      allowance,
      pricingValidated: derivedSeedAmounts[index]?.price?.answer !== undefined,
      balanceSufficient: requiredAmount !== undefined && balance !== undefined && balance >= requiredAmount,
      allowanceSufficient: requiredAmount !== undefined && allowance !== undefined && allowance >= requiredAmount,
    };
  });
  const seedAuthorizationReadsReady =
    canReadSeedAuthorizations &&
    !seedAuthorizationsLoading &&
    !seedAuthorizationsFailed &&
    seedAuthorizations.every(
      (asset) => asset.requiredAmount !== undefined && asset.balance !== undefined && asset.allowance !== undefined,
    );
  const protocolAssetReadsReady = seedOracleFreshnessReady && allSeedAmountsReady;
  const seedBalancesSufficient =
    seedAuthorizationReadsReady && seedAuthorizations.every((asset) => asset.balanceSufficient);
  const seedAllowancesSufficient =
    seedAuthorizationReadsReady && seedAuthorizations.every((asset) => asset.allowanceSufficient);
  const pendingSeedAuthorizations = seedAuthorizations.filter((asset) => !asset.allowanceSufficient);
  const approvalInProgress = approvalState === "pending" || approvalState === "submitted";
  const canApproveAllSeedAssets =
    Boolean(connectedAddress) &&
    pendingSeedAuthorizations.length > 0 &&
    seedAuthorizationReadsReady &&
    seedBalancesSufficient &&
    !approvalInProgress;
  const initialRationaleBytes = new TextEncoder().encode(draft.rationale.trim()).length;
  const initialRationaleValid =
    initialRationaleBytes > 0 &&
    initialRationaleBytes <= MAX_STRATEGY_RATIONALE_BYTES;
  const completionDeviationBps = percentToBps(draft.maxDeviation);
  const challengeDeviationBps = percentToBps(draft.challengeDeviation);
  const weightBandIssue = weightBandLimits
    ? weightBandValidationError(completionDeviationBps, challengeDeviationBps, weightBandLimits)
    : "Wait for the factory weight-band policy to load.";
  const normalizedOtfName = draft.name.trim();
  const otfNameValid = normalizedOtfName.length > 4 && normalizedOtfName.endsWith(" OTF");
  const hasUnverifiedConstituent = portfolio.some((asset) => (
    !isVerifiedPricingConfig(robinhoodChainTestnet.id, asset.address, asset.pricingConfig)
  ));
  const basicsValid =
    otfNameValid &&
    /^[A-Z0-9][A-Z0-9-]*$/.test(draft.symbol) &&
    initialRationaleValid &&
    isAddress(draft.manager) &&
    isAddress(draft.feeRecipient);
  const portfolioValid =
    portfolio.length >= 2 &&
    portfolioWithinFrontendAssetCap &&
    portfolioAssetsUnique &&
    protocolMinimumTargetWeightBps !== undefined &&
    portfolio.every(
      (asset) =>
        asset.ticker.trim() &&
        isAddress(asset.address) &&
        pricingConfigIsComplete(asset.pricingConfig) &&
        percentToBps(asset.targetWeight) >= protocolMinimumTargetWeightBps,
    ) &&
    totalWeightValid &&
    initialPortfolioValue !== undefined &&
    allSeedAmountsReady;
  const remainingSafetyLimitsValid =
    Number(draft.managerFee) >= 0 &&
    Number(draft.managerFee) <= 10 &&
    Number(draft.initialShares) >= 1 &&
    Number(draft.maxNavLoss) > 0 &&
    Number(draft.maxNavLoss) <= 2 &&
    !weightBandIssue;
  const safetyValid = remainingSafetyLimitsValid;
  const basicsIssues = [
    otfNameValid ? null : "Enter the complete fund name ending in ' OTF' (for example, 'Technology Leaders OTF').",
    /^[A-Z0-9][A-Z0-9-]*$/.test(draft.symbol) ? null : "Enter a ticker using letters, numbers, or hyphens.",
    initialRationaleBytes > 0
      ? null
      : "Write an initial strategy rationale.",
    initialRationaleBytes <= MAX_STRATEGY_RATIONALE_BYTES
      ? null
      : `Shorten the initial strategy rationale to ${MAX_STRATEGY_RATIONALE_BYTES.toLocaleString()} bytes or fewer.`,
    isAddress(draft.manager) ? null : "Provide a valid manager address.",
    isAddress(draft.feeRecipient) ? null : "Provide a valid fee-recipient address.",
  ].filter((issue): issue is string => Boolean(issue));
  const portfolioIssues = [
    portfolio.length >= 2 ? null : "Select at least two assets to continue.",
    portfolioWithinFrontendAssetCap
      ? null
      : `Remove ${portfolio.length - FRONTEND_MAX_TRACKED_ASSETS} asset${portfolio.length - FRONTEND_MAX_TRACKED_ASSETS === 1 ? "" : "s"}. The frontend safety cap is ${FRONTEND_MAX_TRACKED_ASSETS} tracked assets per OTF.`,
    portfolioAssetsUnique ? null : "Each contract address can appear only once.",
    protocolMinimumTargetWeightBps !== undefined ? null : "Wait for the protocol target minimum to load.",
    protocolMinimumTargetWeightBps === undefined || portfolio.every((asset) => percentToBps(asset.targetWeight) >= protocolMinimumTargetWeightBps)
      ? null
      : `Every asset needs a target weight of at least ${bpsToPercent(protocolMinimumTargetWeightBps)}.`,
    initialPortfolioValue !== undefined ? null : "Enter a positive initial portfolio value.",
    allSeedAmountsReady ? null : "Wait for valid oracle prices before continuing.",
    pricingConfigsReady
      ? null
      : "Every constituent needs a complete Chainlink, Chainlink Composed, or Uniswap V3 TWAP pricing configuration.",
    portfolio.length === 0 || totalWeightValid ? null : `Adjust target weights to exactly 100%. Current total: ${(totalWeightBps / 100).toFixed(2)}%.`,
  ].filter((issue): issue is string => Boolean(issue));
  const safetyIssues = [
    Number(draft.managerFee) <= 10 ? null : "The manager fee cannot exceed 10% per year.",
    Number(draft.maxNavLoss) <= 2 ? null : "Maximum NAV loss cannot exceed the 2% protocol ceiling.",
    Number(draft.initialShares) >= 1 ? null : "Initial supply must be at least 1 whole share.",
    weightBandPolicyLoading ? "Loading the current factory weight-band policy." : null,
    weightBandPolicyReadFailed ? "The factory weight-band policy could not be read. Try again before creating the OTF." : null,
    weightBandIssue,
    remainingSafetyLimitsValid ? null : "Review the remaining safety limits and enter positive values.",
  ].filter((issue): issue is string => Boolean(issue));
  const allIssues = [...basicsIssues, ...portfolioIssues, ...safetyIssues];
  const stepValidity = [basicsValid, portfolioValid, safetyValid, basicsValid && portfolioValid && safetyValid];
  const stepValid = stepValidity[step];
  const highestValidStep = basicsValid ? (portfolioValid ? (safetyValid ? 3 : 2) : 1) : 0;
  const highestReachableStep = Math.min(furthestStep, highestValidStep);
  const nextAvailableAsset = testnetCreateAssets.find(
    (candidate) => !portfolio.some((asset) => asset.address === candidate.address),
  );
  const canSubmitDeployment =
    stepValid &&
    Boolean(factoryAddress) &&
    Boolean(pricingResolverAddress) &&
    Boolean(connectedAddress) &&
    !protocolDepositsPaused &&
    !protocolDepositsPauseUnavailable &&
    seedBalancesSufficient &&
    seedAllowancesSufficient &&
    protocolAssetReadsReady &&
    seedOracleFreshnessReady &&
    approvalState !== "pending" &&
    approvalState !== "submitted" &&
    deployState !== "pending" &&
    deployState !== "submitted";

  const deploymentBlockers: string[] = [];
  if (!stepValid) deploymentBlockers.push("Complete the required setup fields");
  if (!factoryAddress) deploymentBlockers.push("Factory is not configured");
  if (!pricingResolverAddress) deploymentBlockers.push("Pricing resolver is not configured");
  if (!connectedAddress) deploymentBlockers.push("Connect wallet");
  if (protocolDepositsPaused) deploymentBlockers.push("Protocol deposits are paused");
  if (protocolDepositsPauseUnavailable) deploymentBlockers.push("Protocol deposit-pause status is unavailable");
  if (!seedBalancesSufficient) deploymentBlockers.push("Fund seed assets");
  if (!seedAllowancesSufficient) deploymentBlockers.push("Approve seed assets");
  if (!protocolAssetReadsReady) deploymentBlockers.push("Validate every selected pricing configuration");
  if (!seedOracleFreshnessReady) deploymentBlockers.push("Selected pricing is unavailable or invalid");
  if (approvalState === "pending" || approvalState === "submitted") deploymentBlockers.push("Wait for the approval transaction");
  if (deployState === "pending" || deployState === "submitted") deploymentBlockers.push("Wait for the creation transaction");

  useEffect(() => {
    setDraft((current) => ({
      ...current,
      manager: customManager ? current.manager : connectedAddress ?? "",
      feeRecipient: customFeeRecipient
        ? current.feeRecipient
        : connectedAddress ?? "",
    }));
  }, [connectedAddress, customFeeRecipient, customManager]);

  useEffect(() => {
    if (unverifiedAssetIndex === undefined) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && manualRegistrationState !== "pending" && manualRegistrationState !== "submitted") {
        setUnverifiedAssetIndex(undefined);
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [manualRegistrationState, unverifiedAssetIndex]);

  useEffect(() => {
    if (openAssetPickerIndex === undefined) return;
    const closePicker = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".assetPickerShell")) return;
      setOpenAssetPickerIndex(undefined);
      setAssetPickerSearch("");
    };
    const closePickerOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenAssetPickerIndex(undefined);
        setAssetPickerSearch("");
      }
    };
    document.addEventListener("pointerdown", closePicker);
    document.addEventListener("keydown", closePickerOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closePicker);
      document.removeEventListener("keydown", closePickerOnEscape);
    };
  }, [openAssetPickerIndex]);

  if (!isTestnet) {
    return (
      <div className="appView">
        <AppPageHeader
          title="Create OTF"
          description="Deploy an onchain traded fund with enforceable portfolio limits."
          icon={<FilePlus2 size={18} />}
        />
        <section className="sectionCard depositsEmpty">
          <span><Network size={22} /></span>
          <h2>OTF creation is not available on Mainnet</h2>
          <p>No assets, adapters, or OTF deployments are supported on Robinhood Mainnet yet. Switch to Robinhood Testnet in Settings to continue.</p>
          <button className="secondaryAction" type="button" onClick={onBack}>
            <ArrowLeft size={14} />
            View OTFs
          </button>
        </section>
      </div>
    );
  }

  if (!pricingResolverAddress) {
    return (
      <div className="appView">
        <AppPageHeader
          title="Create OTF"
          description="Creation pins a user-selected, validated price source per constituent."
          icon={<FilePlus2 size={18} />}
        />
        <section className="sectionCard depositsEmpty">
          <span><Clock3 size={22} /></span>
          <h2>The pinned-pricing stack is not deployed yet</h2>
          <p>Existing testnet OTFs remain readable. New creation will open after the permissionless pricing resolver, canonical V3 infrastructure, frontend verification manifest, and updated factory are deployed and verified.</p>
          <button className="secondaryAction" type="button" onClick={onBack}>
            <ArrowLeft size={14} />
            View existing OTFs
          </button>
        </section>
      </div>
    );
  }

  function updateDraft(field: keyof typeof draft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function updatePortfolio(index: number, patch: Partial<TargetAsset>) {
    setPortfolio((current) => current.map((asset, itemIndex) => itemIndex === index ? { ...asset, ...patch } : asset));
  }

  function openUnverifiedAssetModal(index: number, address = "") {
    setManualAssetAddress(address);
    setManualRegistrationError(undefined);
    setManualRegistrationState("idle");
    setOpenAssetPickerIndex(undefined);
    setAssetPickerSearch("");
    setUnverifiedAssetIndex(index);
  }

  function closeUnverifiedAssetModal() {
    if (manualRegistrationState === "pending" || manualRegistrationState === "submitted") return;
    setUnverifiedAssetIndex(undefined);
  }

  function distributePortfolioWeight(totalBps: number, assets: TargetAsset[]) {
    if (assets.length === 0) return [];
    const weights = assets.map((asset) => Math.max(0, percentToBps(asset.targetWeight)));
    const effectivelyEqual = Math.max(...weights) - Math.min(...weights) <= 1;
    const normalizedWeights = effectivelyEqual || !weights.some((weight) => weight > 0)
      ? weights.map(() => 1)
      : weights;
    const weightTotal = normalizedWeights.reduce((sum, weight) => sum + weight, 0);
    const portions = normalizedWeights.map((weight, index) => {
      const numerator = totalBps * weight;
      return { index, bps: Math.floor(numerator / weightTotal), remainder: numerator % weightTotal };
    });
    let unassigned = totalBps - portions.reduce((sum, portion) => sum + portion.bps, 0);
    portions
      .slice()
      .sort((left, right) => right.remainder - left.remainder || left.index - right.index)
      .forEach((portion) => {
        if (unassigned <= 0) return;
        portions[portion.index].bps += 1;
        unassigned -= 1;
      });
    return portions.map((portion) => (portion.bps / 100).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1"));
  }

  function removePortfolioAsset(index: number) {
    setPortfolio((current) => {
      const remaining = current.filter((_, itemIndex) => itemIndex !== index);
      const redistributed = distributePortfolioWeight(10_000, remaining);
      return remaining.map((asset, itemIndex) => ({
        ...asset,
        targetWeight: redistributed[itemIndex],
      }));
    });
  }

  function addPortfolioAsset() {
    if (
      !nextAvailableAsset || protocolMinimumTargetWeightBps === undefined
      || portfolio.length >= FRONTEND_MAX_TRACKED_ASSETS
    ) return;
    const pricingConfig = configuredPricingConfig(nextAvailableAsset.address) ?? emptyPricingConfig();
    setPortfolio((current) => {
      if (current.length >= FRONTEND_MAX_TRACKED_ASSETS) return current;
      if (current.length === 0) {
        return [{
          ticker: nextAvailableAsset.symbol,
          name: nextAvailableAsset.name,
          address: nextAvailableAsset.address,
          poolAddress: pricingConfig.source === 2 ? pricingConfig.primarySource : undefined,
          verified: nextAvailableAsset.verified,
          pricingConfig,
          targetWeight: 100,
          initialAmount: "",
        }];
      }
      const existingWeights = distributePortfolioWeight(10_000 - protocolMinimumTargetWeightBps, current);
      return [
        ...current.map((asset, index) => ({ ...asset, targetWeight: existingWeights[index] })),
        {
          ticker: nextAvailableAsset.symbol,
          name: nextAvailableAsset.name,
          address: nextAvailableAsset.address,
          poolAddress: pricingConfig.source === 2 ? pricingConfig.primarySource : undefined,
          verified: nextAvailableAsset.verified,
          pricingConfig,
          targetWeight: (protocolMinimumTargetWeightBps / 100).toString(),
          initialAmount: "",
        },
      ];
    });
  }

  async function addUnverifiedAsset() {
    if (!publicClient || unverifiedAssetIndex === undefined || !isAddress(manualAssetAddress)) return;
    const assetAddress = manualAssetAddress as `0x${string}`;
    if (portfolio.some((item, index) => index !== unverifiedAssetIndex && item.address.toLowerCase() === assetAddress.toLowerCase())) {
      setManualRegistrationError("This token contract is already in the portfolio.");
      return;
    }
    setManualRegistrationError(undefined);
    setManualRegistrationState("pending");
    try {
      const [decimals, tokenName, tokenSymbol] = await Promise.all([
        publicClient.readContract({ address: assetAddress, abi: erc20MetadataReadAbi, functionName: "decimals" }),
        publicClient.readContract({ address: assetAddress, abi: erc20MetadataReadAbi, functionName: "name" }).catch(() => "Unindexed token"),
        publicClient.readContract({ address: assetAddress, abi: erc20MetadataReadAbi, functionName: "symbol" }).catch(() => "TOKEN"),
      ]);
      if (Number(decimals) !== 18) throw new Error("Constituents must use exactly 18 decimals.");
      const symbol = String(tokenSymbol).trim().slice(0, 16) || "TOKEN";
      setPortfolio((current) => current.map((item, index) => (
        index === unverifiedAssetIndex
          ? {
            ticker: symbol,
            name: String(tokenName).trim().slice(0, 80) || "Unindexed token",
            address: assetAddress,
            poolAddress: undefined,
            verified: false,
            pricingConfig: emptyPricingConfig(),
            targetWeight: item.targetWeight,
            initialAmount: "",
          }
          : item
      )));
      setManualAssetAddress("");
      setManualRegistrationState("confirmed");
      setUnverifiedAssetIndex(undefined);
    } catch (error) {
      setManualRegistrationError(errorMessage(error));
      setManualRegistrationState("reverted");
    }
  }

  function vaultInitParams() {
    if (!isAddress(draft.manager) || !isAddress(draft.feeRecipient)) {
      throw new Error("Manager and fee-recipient addresses must be valid.");
    }
    if (portfolio.length > FRONTEND_MAX_TRACKED_ASSETS) {
      throw new Error(`OTF creation is limited to ${FRONTEND_MAX_TRACKED_ASSETS} assets by the frontend safety cap.`);
    }
    const initialAssets = portfolio.map((asset) => {
      if (!isAddress(asset.address)) throw new Error(`${asset.ticker || "Asset"} has an invalid token address.`);
      return asset.address;
    });

    return {
      name: normalizedOtfName,
      symbol: draft.symbol.trim(),
      initialStrategyRationale: draft.rationale.trim(),
      manager: draft.manager,
      feeRecipient: draft.feeRecipient,
      initialAssets,
      initialPricingConfigs: portfolio.map((asset) => asset.pricingConfig),
      initialTargetWeightsBps: targetWeightBps,
      initialAmounts: derivedSeedAmounts.map((seed, index) => {
        if (seed.requiredAmount === undefined || seed.requiredAmount <= 0n) {
          throw new Error(`${portfolio[index]?.ticker ?? "Asset"} seed amount is unavailable.`);
        }
        return seed.requiredAmount;
      }),
      initialShareSupply: parseUnits(draft.initialShares, 18),
      managerFeeBpsPerYear: percentToBps(draft.managerFee),
      maxNavLossBps: percentToBps(draft.maxNavLoss),
      maxWeightDeviationBps: percentToBps(draft.maxDeviation),
      challengeWeightDeviationBps: percentToBps(draft.challengeDeviation),
    };
  }

  async function submitDeployment() {
    if (!factoryAddress) {
      setDeployError("OTF creation is not available in the current network deployment.");
      setDeployState("reverted");
      return;
    }
    if (!connectedAddress) {
      setDeployError("Connect a wallet before deploying an OTF.");
      setDeployState("reverted");
      return;
    }
    if (!publicClient) {
      setDeployError("The testnet connection is not ready. Check the RPC connection and retry.");
      setDeployState("reverted");
      return;
    }

    setDeployError(undefined);
    setDeployTxHash(undefined);
    setDeployState("pending");
    try {
      const params = vaultInitParams();
      await publicClient.simulateContract({
        address: factoryAddress,
        abi: otfFactoryAbi,
        functionName: "createVault",
        args: [params],
        account: connectedAddress as `0x${string}`,
      });
      const hash = await writeContractAsync({
        address: factoryAddress,
        abi: otfFactoryAbi,
        functionName: "createVault",
        args: [params],
        chainId: robinhoodChainTestnet.id,
      });
      setDeployTxHash(hash);
      setDeployState("submitted");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error("The create transaction reverted onchain. No OTF was created and no seed tokens were transferred.");
      }
      const [createdEvent] = parseEventLogs({
        abi: vaultCreatedEventAbi,
        eventName: "VaultCreated",
        logs: receipt.logs,
        strict: true,
      });
      const createdVault = createdEvent?.args.vault;
      if (!createdVault || !isAddress(createdVault)) {
        throw new Error("The transaction confirmed, but the new OTF address could not be read from its receipt.");
      }
      setDeployState("confirmed");
      onCreated(createdVault, receipt.transactionHash);
    } catch (error) {
      setDeployError(errorMessage(error));
      setDeployState("reverted");
    }
  }

  async function sendSeedApproval(
    asset: (typeof seedAuthorizations)[number],
    amount: bigint,
  ) {
    if (!factoryAddress || !publicClient) throw new Error("The testnet connection is not ready.");
    setApprovalAssetAddress(asset.address as `0x${string}`);
    setApprovalTxHash(undefined);
    setApprovalState("pending");
    const hash = await writeApprovalContractAsync({
      address: asset.address as `0x${string}`,
      abi: erc20BalanceAbi,
      functionName: "approve",
      args: [factoryAddress, amount],
      chainId: robinhoodChainTestnet.id,
    });
    setApprovalTxHash(hash);
    setApprovalState("submitted");
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${asset.ticker} approval reverted.`);
  }

  async function approveSeedAsset(asset: (typeof seedAuthorizations)[number]) {
    if (!connectedAddress || asset.approvalAmount === undefined) return;
    setApprovalBatchProgress(undefined);
    setApprovalError(undefined);
    try {
      if (asset.allowance && asset.allowance > 0n && !asset.allowanceSufficient) {
        await sendSeedApproval(asset, 0n);
      }
      await sendSeedApproval(asset, asset.approvalAmount);
      await refetchSeedAuthorizations();
      setApprovalState("confirmed");
    } catch (error) {
      setApprovalError(`${asset.ticker}: ${errorMessage(error)}`);
      setApprovalState("reverted");
    }
  }

  async function approveAllSeedAssets() {
    if (!connectedAddress || !pendingSeedAuthorizations.length) return;
    setApprovalError(undefined);
    let activeTicker: string | undefined;
    try {
      for (const [index, asset] of pendingSeedAuthorizations.entries()) {
        activeTicker = asset.ticker;
        if (asset.approvalAmount === undefined || asset.allowance === undefined) {
          throw new Error(`${asset.ticker} allowance data is not ready.`);
        }
        if (!asset.balanceSufficient) {
          throw new Error(`${asset.ticker} balance is below the required seed amount.`);
        }
        setApprovalBatchProgress({
          current: index + 1,
          total: pendingSeedAuthorizations.length,
          ticker: asset.ticker,
        });
        if (asset.allowance > 0n && !asset.allowanceSufficient) {
          await sendSeedApproval(asset, 0n);
        }
        await sendSeedApproval(asset, asset.approvalAmount);
      }
      await refetchSeedAuthorizations();
      setApprovalState("confirmed");
    } catch (error) {
      setApprovalError(`${activeTicker ? `${activeTicker}: ` : ""}${errorMessage(error)}`);
      setApprovalState("reverted");
    } finally {
      setApprovalBatchProgress(undefined);
    }
  }

  return (
    <div className="appView">
      <AppPageHeader
        title="Create OTF"
        description="Deploy an onchain traded fund with enforceable portfolio limits."
        icon={<FilePlus2 size={18} />}
      />

      {!connectedAddress ? (
        <div className="validationSummary createWalletWarning" role="status" aria-live="polite">
          <Wallet size={15} />
          <div>
            <strong>Connect a wallet to create an OTF</strong>
            <span>A connected wallet is required to deploy the OTF, supply its initial assets, and confirm the transaction.</span>
          </div>
          <WalletConnectionAction />
        </div>
      ) : null}

      {unverifiedAssetIndex !== undefined ? (
        <div
          className="priceDetailsBackdrop"
          onMouseDown={(event) => event.target === event.currentTarget && closeUnverifiedAssetModal()}
        >
          <section
            className="unverifiedAssetModal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="unverified-asset-title"
            aria-describedby="unverified-asset-description"
            onKeyDown={(event) => {
              if (event.key !== "Tab") return;
              const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
                "button:not([disabled]), input:not([disabled]), select:not([disabled])",
              ));
              const first = focusable.at(0);
              const last = focusable.at(-1);
              if (!first || !last) return;
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
              }
            }}
          >
            <header className="unverifiedAssetModalHeader">
              <div>
                <div className="unverifiedAssetModalTitle">
                  <h2 id="unverified-asset-title">Add an unverified asset</h2>
                  <span className="stateBadge warning">Unverified</span>
                </div>
                <p id="unverified-asset-description">Enter the contract for an exact-transfer, 18-decimal ERC-20. You will configure pricing in the asset card next.</p>
              </div>
              <button
                className="sunsetDialogClose"
                type="button"
                aria-label="Close unverified asset configuration"
                autoFocus
                disabled={manualRegistrationState === "pending" || manualRegistrationState === "submitted"}
                onClick={closeUnverifiedAssetModal}
              >
                <X size={16} />
              </button>
            </header>

            <div className="unverifiedAssetModalBody">
              <label className="unverifiedTokenAddressField">
                <span>Token contract</span>
                <input
                  className={manualAssetAddress && !isAddress(manualAssetAddress) ? "invalid" : undefined}
                  value={manualAssetAddress}
                  onChange={(event) => setManualAssetAddress(event.target.value.trim())}
                  placeholder="0x ERC-20 address"
                  autoComplete="off"
                />
                <small>The app checks the token contract and reads its name, symbol, and decimals.</small>
              </label>
              <div className="manualAssetRiskNotice" role="note">
                <AlertTriangle size={15} />
                <span>Unverified assets are not blocked by the protocol. Review ownership, upgradeability, liquidity, and transfer behavior before using one.</span>
              </div>
              {manualRegistrationError ? <span className="fieldError">{manualRegistrationError}</span> : null}
              <TxStatus state={manualRegistrationState} persistent />
            </div>

            <footer className="unverifiedAssetModalActions">
              <button
                type="button"
                className="secondaryAction"
                disabled={manualRegistrationState === "pending" || manualRegistrationState === "submitted"}
                onClick={closeUnverifiedAssetModal}
              >
                Cancel
              </button>
              <button
                type="button"
                className="primaryAction"
                onClick={addUnverifiedAsset}
                disabled={
                  manualRegistrationState === "pending" ||
                  manualRegistrationState === "submitted" ||
                  !isAddress(manualAssetAddress)
                }
              >
                {manualRegistrationState === "pending" || manualRegistrationState === "submitted"
                  ? <Loader2 className="spin" size={14} />
                  : <Plus size={14} />}
                Add asset
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      <div className="createLayout">
        <aside className="createSteps" aria-label="OTF creation progress">
          {steps.map((item, index) => {
            const complete =
              (completedSteps.has(index) && stepValidity[index]) ||
              (index === steps.length - 1 && deployState === "confirmed");
            return (
              <button
                className={`${step === index ? "active" : ""} ${complete ? "complete" : ""}`}
                key={item.label}
                type="button"
                disabled={index > highestReachableStep}
                aria-current={step === index ? "step" : undefined}
                onClick={() => setStep(index)}
              >
                <span>{complete ? <CheckCircle size={14} /> : index + 1}</span>
                <div>
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </div>
              </button>
            );
          })}
          <div className="createNotice">
            <LockKeyhole size={14} />
            <span>Weight bands remain manager-configurable within current factory policy; the change unlock is fixed.</span>
          </div>
        </aside>

        <section className="sectionCard createForm">
          <div className="sectionTitle">
            <div className="sectionHeading">
              <div className="sectionTitleLine">
                <span className="stepNumber">{step + 1}</span>
                <h2>{steps[step].label}</h2>
              </div>
              <p>{steps[step].description}</p>
            </div>
            <span className="stateBadge muted">Step {step + 1} of {steps.length}</span>
          </div>
          <div className="sectionBody">
            {step === 0 ? (
              <div className="formSection">
                <div className="formGrid twoColumns">
                  <label>
                    <span>OTF name</span>
                    <input
                        value={draft.name}
                        onChange={(event) => {
                          updateDraft("name", event.target.value);
                        }}
                        onBlur={() => {
                          updateDraft("name", draft.name.trimEnd());
                        }}
                        placeholder="Technology Leaders OTF"
                        aria-label="OTF name"
                    />
                    <small>Must end in &apos; OTF&apos;. The name cannot be changed after deployment.</small>
                  </label>
                  <label>
                    <span>OTF ticker</span>
                    <input
                      value={draft.symbol}
                      onChange={(event) => {
                        const ticker = event.target.value
                          .toUpperCase()
                          .replace(/[^A-Z0-9-]/g, "")
                          .slice(0, 16);
                        updateDraft("symbol", ticker);
                      }}
                      placeholder="TECH"
                    />
                    <small>The ticker cannot be changed after deployment.</small>
                  </label>
                </div>
                <label>
                  <div className="subHeader">
                    <span>Initial strategy rationale</span>
                    <small className={initialRationaleValid ? "successText" : initialRationaleBytes > MAX_STRATEGY_RATIONALE_BYTES ? "dangerText" : "warningText"}>
                      {initialRationaleBytes.toLocaleString()} / {MAX_STRATEGY_RATIONALE_BYTES.toLocaleString()} bytes
                    </small>
                  </div>
                  <textarea
                    value={draft.rationale}
                    onChange={(event) => updateDraft("rationale", event.target.value)}
                    rows={4}
                    maxLength={MAX_STRATEGY_RATIONALE_BYTES}
                    aria-invalid={initialRationaleBytes > MAX_STRATEGY_RATIONALE_BYTES}
                    placeholder="Describe the portfolio mandate and investment rationale."
                  />
                  <small>This becomes strategy version 0 and is permanently paired with the initial targets.</small>
                </label>
                <div className="formGrid twoColumns">
                  <div className="addressRoleField">
                    <div className="addressRoleFieldHeader">
                      <label htmlFor="manager-address">Manager address</label>
                      <button
                        type="button"
                        onClick={() => setCustomManager((enabled) => !enabled)}
                      >
                        {customManager ? <Wallet size={12} /> : <Pencil size={12} />}
                        {customManager ? "Use creator wallet" : "Use custom address"}
                      </button>
                    </div>
                    <input
                      id="manager-address"
                      className={!isAddress(draft.manager) && draft.manager ? "invalid" : ""}
                      value={draft.manager}
                      readOnly={!customManager}
                      aria-readonly={!customManager}
                      onChange={(event) => updateDraft("manager", event.target.value)}
                      placeholder="0x..."
                    />
                    <small>
                      {customManager
                        ? "Custom manager may propose strategy changes with a locked rationale."
                        : connectedAddress
                          ? "Locked to the wallet creating this OTF."
                          : "Connect a wallet to use the creator address."}
                    </small>
                  </div>
                  <div className="addressRoleField">
                    <div className="addressRoleFieldHeader">
                      <label htmlFor="fee-recipient-address">Fee recipient</label>
                      <button
                        type="button"
                        onClick={() => setCustomFeeRecipient((enabled) => !enabled)}
                      >
                        {customFeeRecipient ? <Wallet size={12} /> : <Pencil size={12} />}
                        {customFeeRecipient ? "Use creator wallet" : "Use custom address"}
                      </button>
                    </div>
                    <input
                      id="fee-recipient-address"
                      className={!isAddress(draft.feeRecipient) && draft.feeRecipient ? "invalid" : ""}
                      value={draft.feeRecipient}
                      readOnly={!customFeeRecipient}
                      aria-readonly={!customFeeRecipient}
                      onChange={(event) => updateDraft("feeRecipient", event.target.value)}
                      placeholder="0x..."
                    />
                    <small>
                      {customFeeRecipient
                        ? "Custom address receives accrued manager-fee shares."
                        : connectedAddress
                          ? "Locked to the wallet creating this OTF."
                          : "Connect a wallet to use the creator address."}
                    </small>
                  </div>
                </div>
                {basicsIssues.length ? (
                  <div className="validationSummary" role="status">
                    <AlertTriangle size={15} />
                    <div>
                      <strong>{basicsIssues.length} required item{basicsIssues.length === 1 ? "" : "s"} remaining</strong>
                      <ul>{basicsIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {step === 1 ? (
              <div className="formSection">
                <div className="formIntro">
                  <div>
                    <strong>Initial target portfolio</strong>
                  </div>
                  <span className={`stateBadge ${totalWeightValid && portfolioWithinFrontendAssetCap ? "success" : "danger"}`}>{portfolio.length} / {FRONTEND_MAX_TRACKED_ASSETS} assets · Total {totalWeight.toFixed(1)}%</span>
                </div>
                <label className="initialPortfolioValueField">
                  <span>Initial portfolio value</span>
                  <div className="inputWithPrefix">
                    <span>$</span>
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={draft.initialPortfolioValue}
                      onChange={(event) => updateDraft("initialPortfolioValue", event.target.value)}
                    />
                  </div>
                  <small>Target weights and current oracle prices determine the required seed-token quantities.</small>
                </label>
                <div className="createAssetList">
                  {portfolio.map((asset, index) => {
                    const configurationVerified = isVerifiedPricingConfig(
                      robinhoodChainTestnet.id,
                      asset.address,
                      asset.pricingConfig,
                    );
                    return (
                    <div className="createAssetRow" key={`${asset.address}-${index}`}>
                      <div className="assetSelectField">
                        <span className="createAssetFieldLabel">Asset</span>
                        <div className="assetPickerShell">
                          <button
                            className={`createAssetPicker ${openAssetPickerIndex === index ? "active" : ""}`}
                            type="button"
                            aria-label={`Choose asset ${index + 1}`}
                            aria-haspopup="listbox"
                            aria-expanded={openAssetPickerIndex === index}
                            onClick={() => {
                              setAssetPickerSearch("");
                              setOpenAssetPickerIndex((current) => current === index ? undefined : index);
                            }}
                          >
                            <span className="createAssetPickerIdentity">
                              <span className="createAssetPickerName">
                                <strong>{asset.ticker} · {asset.name ?? "Token"}</strong>
                              </span>
                              <small>{shortAssetAddress(asset.address)}</small>
                            </span>
                            <span className={`stateBadge ${configurationVerified ? "success" : "warning"}`}>
                              {configurationVerified ? "Verified" : "Unverified"}
                            </span>
                            <ChevronDown aria-hidden="true" size={14} />
                          </button>
                          {openAssetPickerIndex === index ? (
                            <div className="createAssetPickerMenu">
                              <label className="createAssetPickerSearch">
                                <Search size={14} aria-hidden="true" />
                                <input
                                  autoFocus
                                  value={assetPickerSearch}
                                  onChange={(event) => setAssetPickerSearch(event.target.value)}
                                  placeholder="Search ticker or contract address"
                                  aria-label={`Search assets for position ${index + 1}`}
                                  autoComplete="off"
                                  spellCheck={false}
                                />
                              </label>
                              <div className="createAssetPickerOptions" role="listbox" aria-label={`Assets for position ${index + 1}`}>
                                {filteredAssetPickerOptions.map((candidate) => (
                                  <button
                                    key={candidate.address}
                                    type="button"
                                    role="option"
                                    aria-selected={candidate.address.toLowerCase() === asset.address.toLowerCase()}
                                    onClick={() => {
                                      const pricingConfig = configuredPricingConfig(candidate.address) ?? emptyPricingConfig();
                                      updatePortfolio(index, {
                                        ticker: candidate.symbol,
                                        name: candidate.name,
                                        address: candidate.address,
                                        poolAddress: pricingConfig.source === 2 ? pricingConfig.primarySource : undefined,
                                        verified: candidate.verified,
                                        pricingConfig,
                                      });
                                      setOpenAssetPickerIndex(undefined);
                                      setAssetPickerSearch("");
                                    }}
                                  >
                                    <span className="createAssetOptionIdentity">
                                      <strong>{candidate.symbol} · {candidate.name}</strong>
                                      <small>{shortAssetAddress(candidate.address)}</small>
                                    </span>
                                    <span className="stateBadge success">Verified</span>
                                    {candidate.address.toLowerCase() === asset.address.toLowerCase() ? <Check size={13} aria-hidden="true" /> : null}
                                  </button>
                                ))}
                                {assetSearchMetadataPending ? (
                                  <div className="createAssetPickerStatus" role="status"><Loader2 className="spin" size={14} />Reading token metadata…</div>
                                ) : null}
                                {assetSearchAddress && !assetSearchMetadataPending && assetSearchMetadata ? (
                                  <button
                                    className="createAssetDiscoveredOption"
                                    type="button"
                                    role="option"
                                    aria-selected={assetSearchAddress.toLowerCase() === asset.address.toLowerCase()}
                                    disabled={assetSearchMetadata.decimals !== 18}
                                    onClick={() => openUnverifiedAssetModal(index, assetSearchAddress)}
                                  >
                                    <span className="createAssetOptionIdentity">
                                      <strong>{assetSearchMetadata.symbol || "TOKEN"} · {assetSearchMetadata.name || "Unindexed token"}</strong>
                                      <small>{shortAssetAddress(assetSearchAddress)} · {assetSearchMetadata.decimals} decimals</small>
                                    </span>
                                    <span className={`stateBadge ${assetSearchMetadata.decimals === 18 ? "warning" : "danger"}`}>
                                      {assetSearchMetadata.decimals === 18 ? "Unverified" : "Unsupported"}
                                    </span>
                                    {assetSearchMetadata.decimals === 18 ? <Plus size={13} aria-hidden="true" /> : null}
                                  </button>
                                ) : null}
                                {normalizedAssetPickerSearch && filteredAssetPickerOptions.length === 0 && !assetSearchMetadataPending && !assetSearchMetadata ? (
                                  <div className="createAssetPickerStatus" role="status">
                                    {assetSearchAddress
                                      ? "No ERC-20 metadata was found at this address."
                                      : "No verified asset matches this ticker or contract address."}
                                  </div>
                                ) : null}
                                {(!normalizedAssetPickerSearch || (
                                  filteredAssetPickerOptions.length === 0
                                  && !assetSearchMetadataPending
                                  && !assetSearchMetadata
                                )) ? (
                                  <button
                                    type="button"
                                    role="option"
                                    aria-selected={!asset.verified}
                                    onClick={() => openUnverifiedAssetModal(index, assetSearchAddress ?? "")}
                                  >
                                    <span className="createAssetOptionIdentity">
                                      <strong>Enter contract address</strong>
                                      <small>Add a compatible 18-decimal ERC-20</small>
                                    </span>
                                    <span className="stateBadge warning">Unverified</span>
                                    {!asset.verified ? <Check size={13} aria-hidden="true" /> : null}
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <label className="assetWeightField">
                        <span className="createAssetFieldLabel">Target weight</span>
                        <div className="inputWithSuffix">
                          <input
                            type="number"
                            min={protocolMinimumTargetWeightBps === undefined ? undefined : protocolMinimumTargetWeightBps / 100}
                            max={100}
                            step={0.01}
                            value={asset.targetWeight}
                            aria-label={`Target weight for ${asset.ticker}`}
                            onChange={(event) => updatePortfolio(index, { targetWeight: event.target.value })}
                          />
                          <span>%</span>
                        </div>
                      </label>
                      <button
                        className="removeCreateAsset"
                        type="button"
                        title={`Remove ${asset.ticker}`}
                        aria-label={`Remove ${asset.ticker} from portfolio`}
                        onClick={() => removePortfolioAsset(index)}
                      >
                        <Trash2 size={14} />
                      </button>
                      <div className="assetPricingPanel">
                        <PricingConfigurationFields
                          chainId={robinhoodChainTestnet.id}
                          assetAddress={asset.address}
                          assetTicker={asset.ticker}
                          config={asset.pricingConfig}
                          onChange={(pricingConfig) => updatePortfolio(index, {
                            pricingConfig,
                            poolAddress: pricingConfig.source === 2 ? pricingConfig.primarySource : undefined,
                          })}
                        />
                      </div>
                      <div className="createAssetDerivedValues">
                        <div className="assetOraclePriceField">
                          <span>Oracle price</span>
                          <strong>{derivedSeedAmounts[index]?.price?.display ?? "-"}</strong>
                          <small>{derivedSeedAmounts[index]?.displayTargetValue === "Loading" ? "Allocation unavailable" : `${derivedSeedAmounts[index]?.displayTargetValue} allocation`}</small>
                        </div>
                        <div className="assetSeedField">
                          <span>Seed tokens</span>
                          <strong>{derivedSeedAmounts[index]?.displayAmount || "-"}</strong>
                          <small>{asset.ticker} required</small>
                        </div>
                      </div>
                    </div>
                    );
                  })}
                </div>
                <button
                  className="secondaryAction"
                  type="button"
                  onClick={addPortfolioAsset}
                  disabled={!nextAvailableAsset || protocolMinimumTargetWeightBps === undefined || portfolio.length >= FRONTEND_MAX_TRACKED_ASSETS}
                >
                  <Plus size={14} />
                  Add asset
                </button>
                {portfolio.length === FRONTEND_MAX_TRACKED_ASSETS ? (
                  <div className="validationSummary warning" role="status">
                    <AlertTriangle size={15} />
                    <div><strong>Frontend asset cap reached</strong><span>Remove an asset before adding another. This creation flow is limited to {FRONTEND_MAX_TRACKED_ASSETS} assets for transaction safety.</span></div>
                  </div>
                ) : null}
                {portfolioIssues.length ? (
                  <div className="validationSummary warning" role="status">
                    <AlertTriangle size={15} />
                    <div>
                      <strong>Portfolio needs attention</strong>
                      <ul>{portfolioIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {step === 2 ? (
              <div className="formSection">
                <div className="formGrid threeColumns">
                  <label><span>Manager fee</span><div className="inputWithSuffix"><input type="number" min={0} max={10} value={draft.managerFee} onChange={(event) => updateDraft("managerFee", event.target.value)} /><span>% / yr</span></div><small>Annual fee minted as OTF shares. Protocol range: 0–10% per year.</small></label>
                  <label><span>Initial shares</span><input type="number" min={1} value={draft.initialShares} onChange={(event) => updateDraft("initialShares", event.target.value)} /><small>Sets the initial OTF share supply. 0.000000000001 share is permanently locked; the manager receives the entered amount minus that share.</small></label>
                  <label><span>Seven-day NAV-loss budget</span><div className="inputWithSuffix"><input type="number" min={0} max={2} value={draft.maxNavLoss} onChange={(event) => updateDraft("maxNavLoss", event.target.value)} /><span>%</span></div><small>Caps oracle-valued execution loss with capacity replenishing linearly over seven days. Protocol maximum: 2%.</small></label>
                  <label><span>Completion band</span><div className="inputWithSuffix"><input type="number" min={weightBandLimits ? weightBandLimits.minCompletionDeviationBps / 100 : undefined} max={weightBandLimits ? weightBandLimits.maxCompletionDeviationBps / 100 : undefined} step={0.01} value={draft.maxDeviation} onChange={(event) => updateDraft("maxDeviation", event.target.value)} /><span>+/- %</span></div><small>{weightBandLimits ? `Every asset must enter this distance from its target to complete. Current factory range: ${bpsToPercent(weightBandLimits.minCompletionDeviationBps)}–${bpsToPercent(weightBandLimits.maxCompletionDeviationBps)}.` : "Loading the current factory range."}</small></label>
                  <label><span>Challenge band</span><div className="inputWithSuffix"><input type="number" min={weightBandLimits ? (completionDeviationBps + weightBandLimits.minChallengeDeviationGapBps) / 100 : undefined} max={weightBandLimits ? weightBandLimits.maxChallengeDeviationBps / 100 : undefined} step={0.01} value={draft.challengeDeviation} onChange={(event) => updateDraft("challengeDeviation", event.target.value)} /><span>+/- %</span></div><small>{weightBandLimits ? `Must be at least ${bpsToPercent(weightBandLimits.minChallengeDeviationGapBps)} wider than completion and no more than ${bpsToPercent(weightBandLimits.maxChallengeDeviationBps)}.` : "Loading the current factory range."}</small></label>
                </div>
                <div className="executionPolicy createGuarantees">
                  <ShieldCheck size={14} />
                  <div>
                    <strong>Trade execution remains constrained</strong>
                    <span>Strategy changes unlock 14 days after the previous rebalance completes. Every pinned Chainlink leg must satisfy its protocol-defined freshness and pause checks; V3 pricing uses the fixed protocol TWAP window. No fallback source is used. Each trade must move the basket closer to target.</span>
                  </div>
                </div>
                {safetyIssues.length ? (
                  <div className="validationSummary" role="status">
                    <AlertTriangle size={15} />
                    <div>
                      <strong>Safety configuration needs attention</strong>
                      <ul>{safetyIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {step === 3 ? (
              <div className="formSection reviewSection">
                <div className="reviewHero">
                  <span className="vaultMonogram">NEW</span>
                  <div>
                    <h2>{normalizedOtfName}</h2>
                    <span>{draft.symbol} · {portfolio.length} assets · {draft.managerFee}% annual manager fee</span>
                    <span className={`stateBadge ${hasUnverifiedConstituent ? "warning" : "success"}`}>
                      {hasUnverifiedConstituent ? "Includes unverified configurations" : "Verified configurations"}
                    </span>
                  </div>
                </div>
                {hasUnverifiedConstituent ? (
                  <div className="validationSummary warning" role="note">
                    <AlertTriangle size={15} />
                    <div>
                      <strong>Includes unverified configurations</strong>
                      <span>At least one asset and pricing-source combination does not match the verified list. This does not change onchain eligibility.</span>
                    </div>
                  </div>
                ) : null}
                <div className="reviewGrid">
                  <div className="reviewKeyMetric"><span>Annual manager fee</span><strong>{draft.managerFee}%</strong></div>
                  <div><span>Manager</span><strong>{shortAddress(draft.manager)}</strong></div>
                  <div><span>Fee recipient</span><strong>{shortAddress(draft.feeRecipient)}</strong></div>
                  <div><span>Initial value</span><strong>{Number(draft.initialPortfolioValue) > 0 ? formatOraclePrice(Number(draft.initialPortfolioValue)) : "Not set"}</strong></div>
                  <div><span>Strategy cooldown</span><strong>14 days after deployment or completion</strong></div>
                  <div><span>Seven-day NAV-loss budget</span><strong>{draft.maxNavLoss}%</strong></div>
                  <div><span>Completion band</span><strong>+/- {draft.maxDeviation}%</strong></div>
                  <div><span>Challenge band</span><strong>+/- {draft.challengeDeviation}%</strong></div>
                  <div><span>Challenge grace</span><strong>{challengeGracePeriod === undefined ? "Loading" : formatPricingDuration(challengeGracePeriod)}</strong></div>
                  <div><span>Oracle availability</span><strong>Per-asset freshness and pause checks</strong></div>
                </div>
                <div>
                  <div className="subHeader"><span>Initial portfolio</span><small>Total {(totalWeightBps / 100).toFixed(2)}%</small></div>
                  <div className="reviewPortfolio">
                    {portfolio.map((asset, index) => (
                      <span key={asset.address} title={`${asset.address} · ${pricingSourceLabel(asset.pricingConfig.source)} · ${asset.pricingConfig.primarySource}${asset.pricingConfig.source === 1 || asset.pricingConfig.source === 2 ? ` × ${asset.pricingConfig.secondarySource}` : ""}`}>
                        <AssetLogo symbol={asset.ticker} compact />
                        <strong>{asset.ticker}</strong>
                        {Number(asset.targetWeight || 0).toFixed(1)}% / {derivedSeedAmounts[index]?.displayAmount || "-"} seed
                        <small>
                          {isVerifiedPricingConfig(robinhoodChainTestnet.id, asset.address, asset.pricingConfig) ? "Verified" : "Unverified"} pricing · {pricingSourceLabel(asset.pricingConfig.source)} · {shortAssetAddress(asset.address)}
                        </small>
                      </span>
                    ))}
                  </div>
                </div>
                <div className="seedApprovalSection">
                  <div className="subHeader">
                    <span>Seed-token authorization</span>
                    <small>{seedAllowancesSufficient ? "Ready" : `${seedAuthorizations.filter((asset) => !asset.allowanceSufficient).length} remaining`}</small>
                  </div>
                  <div className="seedApprovalToolbar">
                    <span>Approve each token for OTF creation. A 2% allowance buffer absorbs small price moves; only the calculated seed amount is transferred.</span>
                    {pendingSeedAuthorizations.length ? (
                      <button
                        className="secondaryAction seedApproveAllAction"
                        type="button"
                        disabled={!canApproveAllSeedAssets}
                        onClick={approveAllSeedAssets}
                      >
                        {approvalBatchProgress ? <Loader2 className="spin" size={14} /> : <ListChecks size={14} />}
                        {approvalBatchProgress
                          ? `${approvalBatchProgress.ticker} ${approvalBatchProgress.current} of ${approvalBatchProgress.total}`
                          : `Approve all (${pendingSeedAuthorizations.length})`}
                      </button>
                    ) : (
                      <span className="seedApprovalComplete"><CheckCircle size={14} /> All approved</span>
                    )}
                  </div>
                  <div className="seedApprovalList">
                    {seedAuthorizations.map((asset) => {
                      const isCurrentApproval = approvalAssetAddress === asset.address;
                      const approvalInFlight =
                        isCurrentApproval && (approvalState === "pending" || approvalState === "submitted");
                      const needsReset = Boolean(
                        asset.allowance && asset.allowance > 0n && !asset.allowanceSufficient,
                      );
                      return (
                        <div className="seedApprovalRow" key={asset.address}>
                          <div className="seedApprovalIdentity">
                            <AssetLogo symbol={asset.ticker} />
                            <div>
                              <strong>{asset.ticker}</strong>
                              <small>{asset.initialAmount || "0"} required / {formatWalletTokenBalance(asset.balance, 18)} available</small>
                              <small>{asset.allowance && asset.allowance > 0n ? `${formatWalletTokenBalance(asset.allowance, 18)} creation allowance` : "No current creation allowance"}</small>
                            </div>
                          </div>
                          <div className="seedApprovalStates">
                            <span className={`stateBadge ${
                              seedAuthorizationsFailed
                                ? "danger"
                                : asset.balance === undefined ? "muted" : asset.balanceSufficient ? "success" : "danger"
                            }`}>
                              {seedAuthorizationsFailed
                                ? "Balance read failed"
                                  : asset.balance === undefined
                                    ? "Checking balance"
                                    : asset.balanceSufficient ? "Balance ready" : "Insufficient balance"}
                            </span>
                            <span className={`stateBadge ${
                              pricingQuoteError
                                ? "danger"
                                : pricingQuotesPending || !asset.pricingValidated
                                  ? "muted"
                                  : "success"
                            }`}>
                              {pricingQuoteError
                                ? "Pricing invalid"
                                : pricingQuotesPending || !asset.pricingValidated
                                  ? "Validating pricing"
                                  : "Pricing validated"}
                            </span>
                          </div>
                          {asset.allowanceSufficient ? (
                            <span className="seedApprovalComplete"><CheckCircle size={14} /> Seed allowance ready</span>
                          ) : (
                            <button
                              className="secondaryAction seedApprovalAction"
                              type="button"
                              disabled={
                                !connectedAddress ||
                                !asset.balanceSufficient ||
                                asset.allowance === undefined ||
                                approvalInProgress
                              }
                              onClick={() => approveSeedAsset(asset)}
                            >
                              {approvalInFlight ? <Loader2 className="spin" size={14} /> : <KeyRound size={14} />}
                              {approvalInFlight
                                ? approvalState === "pending" ? "Confirm in wallet" : "Confirming"
                                : needsReset ? `Reset & approve ${asset.ticker}` : `Approve ${asset.ticker}`}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {!connectedAddress ? (
                    <div className="validationSummary" role="status">
                      <Wallet size={15} />
                      <div><strong>Connect the funding wallet</strong><span>Token balances and allowances are checked against the wallet that creates the OTF.</span></div>
                    </div>
                  ) : null}
                  {approvalError ? (
                    <div className="validationSummary danger" role="alert">
                      <XCircle size={15} />
                      <div><strong>Approval failed</strong><span>{approvalError}</span></div>
                    </div>
                  ) : null}
                  {connectedAddress && pricingQuoteError ? (
                    <div className="validationSummary danger" role="alert">
                      <AlertTriangle size={15} />
                      <div>
                        <strong>Pricing validation failed</strong>
                        <span>{pricingQuoteError}</span>
                      </div>
                    </div>
                  ) : null}
                  {connectedAddress && seedAuthorizationsFailed ? (
                    <div className="validationSummary danger" role="alert">
                      <RefreshCw size={15} />
                      <div><strong>Token authorization checks could not be loaded</strong><span>Check the testnet connection, then reload balances and allowances before approving or deploying.</span></div>
                    </div>
                  ) : null}
                </div>
                {protocolDepositsPaused ? (
                  <div className="validationSummary warning" role="status">
                    <ShieldCheck size={15} />
                    <div><strong>New OTF creation is temporarily paused</strong><span>The protocol-wide deposit precaution is active. Your draft is preserved; return after the factory owner resumes deposits.</span></div>
                  </div>
                ) : null}
                {protocolDepositsPauseUnavailable ? (
                  <div className="validationSummary warning" role="status">
                    <RefreshCw size={15} />
                    <div><strong>Deposit-pause status unavailable</strong><span>Creation stays disabled until the factory&apos;s global pause state can be verified.</span></div>
                  </div>
                ) : null}
                {allIssues.length ? (
                  <div className="validationSummary danger" role="alert">
                    <AlertTriangle size={15} />
                    <div>
                      <strong>Resolve {allIssues.length} item{allIssues.length === 1 ? "" : "s"} before deployment</strong>
                      <ul>{allIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
                    </div>
                  </div>
                ) : null}
                <div className="riskCallout warning">
                  <LockKeyhole size={15} />
                  <div><strong>Review the settings carefully</strong><span>The manager may update weight bands within current factory policy but cannot shorten the portfolio change unlock.</span></div>
                </div>
                <TxStatus state={deployState} />
                {deployError ? (
                  <div className="validationSummary danger" role="alert">
                    <XCircle size={15} />
                    <div>
                      <strong>Deployment failed</strong>
                      <span>{deployError}</span>
                      {deployTxHash ? (
                        <a href={`${robinhoodChainTestnet.blockExplorers.default.url}/tx/${deployTxHash}`} target="_blank" rel="noreferrer">
                          View failed transaction <ExternalLink size={12} />
                        </a>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="createFormActions">
              <button className="secondaryAction" type="button" onClick={() => step === 0 ? onBack() : setStep((current) => current - 1)}>
                <ArrowLeft size={14} />
                {step === 0 ? "Back to OTFs" : "Back"}
              </button>
              {step < steps.length - 1 ? (
                <button
                  className="primaryAction"
                  type="button"
                  disabled={!stepValid}
                  onClick={() => {
                    setCompletedSteps((current) => new Set(current).add(step));
                    setFurthestStep((current) => Math.max(current, step + 1));
                    setStep((current) => current + 1);
                  }}
                >
                  Continue
                  <ArrowRight size={14} />
                </button>
              ) : (
                <button className="primaryAction" type="button" disabled={!canSubmitDeployment} onClick={submitDeployment}>
                  <FilePlus2 size={14} />
                  {canSubmitDeployment
                    ? "Create OTF"
                    : deploymentBlockers[0] ?? "Resolve deployment requirements"}
                </button>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function CreatedVaultView({
  vault,
  transactionHash,
  onCreateAnother,
  onManage,
  onView,
}: {
  vault: VaultView;
  transactionHash?: `0x${string}`;
  onCreateAnother: () => void;
  onManage: () => void;
  onView: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const detailsReady = vault.dataMode === "live";

  async function copyVaultAddress() {
    if (!vault.address) return;
    await navigator.clipboard.writeText(vault.address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_600);
  }

  return (
    <div className="appView">
      <AppPageHeader
        title="OTF created"
        description="The deployment is confirmed on Robinhood Testnet."
        icon={<CheckCircle size={18} />}
      />

      <section className="createdConfirmation" aria-labelledby="created-otf-title">
        <div className="createdStatus">
          <span className="createdStatusIcon"><Check size={24} /></span>
          <div>
            <h2 id="created-otf-title">{detailsReady ? vault.name : "Deployment confirmed"}</h2>
            <p>{detailsReady ? `${vault.symbol} is live and ready to manage.` : "Loading the new OTF's on-chain details."}</p>
          </div>
        </div>

        <div className="createdAddressBlock">
          <div>
            <span>OTF contract address</span>
            <code>{vault.address}</code>
          </div>
          <div className="createdAddressActions">
            <button className="iconOnly" type="button" onClick={copyVaultAddress} title="Copy OTF address" aria-label="Copy OTF address">
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </button>
            <a
              className="iconOnly"
              href={`${robinhoodChainTestnet.blockExplorers.default.url}/address/${vault.address}`}
              target="_blank"
              rel="noreferrer"
              title="Open OTF in explorer"
              aria-label="Open OTF in explorer"
            >
              <ExternalLink size={15} />
            </a>
          </div>
        </div>
        {copied ? <span className="createdCopyFeedback" role="status" aria-live="polite">Address copied</span> : null}

        <div className="createdDetails" aria-label="Created OTF details">
          <div><span>Symbol</span><strong>{detailsReady ? vault.symbol : "Loading"}</strong></div>
          <div><span>Network</span><strong>Robinhood Testnet</strong></div>
          <div><span>Assets</span><strong>{detailsReady ? vault.allocations.length : "Loading"}</strong></div>
          <div><span>Initial supply</span><strong>{detailsReady ? vault.totalSupply : "Loading"}</strong></div>
          <div><span>Manager</span><strong>{detailsReady ? shortAddress(vault.manager) : "Loading"}</strong></div>
          <div><span>Strategy cooldown</span><strong>{detailsReady ? `${formatCooldown(vault.cooldownSeconds)} after deployment or completion` : "Loading"}</strong></div>
        </div>

        {transactionHash ? (
          <a
            className="createdTransactionLink"
            href={`${robinhoodChainTestnet.blockExplorers.default.url}/tx/${transactionHash}`}
            target="_blank"
            rel="noreferrer"
          >
            <ReceiptText size={15} />
            <span>View deployment transaction</span>
            <code>{shortAddress(transactionHash)}</code>
            <ExternalLink size={14} />
          </a>
        ) : null}

        <div className="createdActions">
          <button className="secondaryAction" type="button" onClick={onCreateAnother}>
            <Plus size={14} />
            Create another
          </button>
          <button className="secondaryAction" type="button" onClick={onManage} disabled={!detailsReady}>
            <Settings size={14} />
            Manage OTF
          </button>
          <button className="primaryAction" type="button" onClick={onView} disabled={!detailsReady}>
            <ChartPie size={14} />
            View OTF
          </button>
        </div>
      </section>
    </div>
  );
}

function WalletView({
  connectedAddress,
  vaults,
  isTestnet,
  onBrowseVaults,
  onOpenVault,
  onCreateVault,
}: {
  connectedAddress?: string;
  vaults: VaultSummary[];
  isTestnet: boolean;
  onBrowseVaults: () => void;
  onOpenVault: (address: `0x${string}`) => void;
  onCreateVault: () => void;
}) {
  const [addressCopied, setAddressCopied] = useState(false);
  const canRead = isTestnet && Boolean(connectedAddress && isAddress(connectedAddress));
  const { data: nativeBalance, isLoading: nativeBalanceLoading } = useBalance({
    address: canRead ? connectedAddress as `0x${string}` : undefined,
    chainId: robinhoodChainTestnet.id,
    query: { enabled: canRead },
  });
  const {
    data: usdgBalance,
    isLoading: usdgBalanceLoading,
    isError: usdgBalanceError,
  } = useReadContract({
    address: robinhoodTestnetAddresses.usdg,
    abi: erc20BalanceAbi,
    functionName: "balanceOf",
    args: canRead ? [connectedAddress as `0x${string}`] : undefined,
    chainId: robinhoodChainTestnet.id,
    query: { enabled: canRead && Boolean(robinhoodTestnetAddresses.usdg) },
  });
  const positionContracts = canRead
    ? vaults.flatMap((vault) => [
        {
          address: vault.address,
          abi: erc20BalanceAbi,
          functionName: "balanceOf" as const,
          args: [connectedAddress as `0x${string}`],
          chainId: robinhoodChainTestnet.id,
        },
        {
          address: vault.address,
          abi: erc20BalanceAbi,
          functionName: "decimals" as const,
          chainId: robinhoodChainTestnet.id,
        },
      ])
    : [];
  const { data: positionResults, isLoading: positionsLoading } = useReadContracts({
    contracts: positionContracts,
    query: { enabled: positionContracts.length > 0 },
  });
  const positions = vaults.flatMap((vault, index) => {
    const balance = positionResults?.[index * 2]?.result as bigint | undefined;
    if ((balance ?? 0n) === 0n) return [];
    const decimals = Number(positionResults?.[index * 2 + 1]?.result ?? 18);
    return [{ ...vault, displayBalance: formatWalletTokenBalance(balance, decimals) }];
  });
  const managedVaults = vaults.filter((vault) => isManagedByAddress(vault.manager, connectedAddress));
  const nativeBalanceLabel = nativeBalance
    ? `${Number(nativeBalance.formatted).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${nativeBalance.symbol}`
    : nativeBalanceLoading ? "Loading" : "Unavailable";
  const usdgBalanceLabel = typeof usdgBalance === "bigint"
    ? `${formatWalletTokenBalance(usdgBalance, 6)} USDG`
    : usdgBalanceLoading ? "Loading" : usdgBalanceError ? "Read failed" : "0 USDG";

  async function copyWalletAddress() {
    if (!connectedAddress) return;
    await navigator.clipboard.writeText(connectedAddress);
    setAddressCopied(true);
    window.setTimeout(() => setAddressCopied(false), 1800);
  }

  return (
    <div className="appView">
      <AppPageHeader
        title="My wallet"
        description="Your OTF share positions and network balance."
        icon={<Wallet size={18} />}
        actions={
          <>
            <WalletConnectionAction />
            <button className="secondaryAction" type="button" onClick={onBrowseVaults}><LayoutGrid size={14} />Explore OTFs</button>
          </>
        }
      />

      {!isTestnet ? (
        <section className="sectionCard depositsEmpty">
          <span><Network size={22} /></span>
          <h2>Robinhood Mainnet is not supported yet</h2>
          <p>Switch to Robinhood Testnet in Settings to view deployed OTF positions.</p>
        </section>
      ) : connectedAddress ? (
        <>
          <div className="depositMetrics walletMetrics">
            <div className="metricCard walletAddressMetric">
              <div className="metricLabel">
                <span>Wallet address</span>
                <div className="walletAddressActions">
                  {addressCopied ? <span className="walletAddressCopyFeedback" role="status" aria-live="polite">Copied</span> : null}
                  <button
                    className="iconOnly compact"
                    type="button"
                    title={addressCopied ? "Wallet address copied" : "Copy wallet address"}
                    aria-label={addressCopied ? "Wallet address copied" : "Copy wallet address"}
                    onClick={copyWalletAddress}
                  >
                    {addressCopied ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                  <a
                    className="iconOnly compact"
                    href={`${robinhoodChainTestnet.blockExplorers.default.url}/address/${connectedAddress}`}
                    target="_blank"
                    rel="noreferrer"
                    title="Open wallet in block explorer"
                    aria-label="Open wallet in block explorer in a new tab"
                  >
                    <ExternalLink size={13} />
                  </a>
                </div>
              </div>
              <div className="walletAddressValue">
                <strong title={connectedAddress}>{shortAddress(connectedAddress)}</strong>
              </div>
            </div>
            <MetricCard label="OTF Positions" value={positionsLoading ? "..." : String(positions.length)} />
            <MetricCard
              label="USDG Balance"
              value={usdgBalanceLabel}
              action={(
                <a
                  className="metricCardFaucetAction"
                  href="https://faucet.paxos.com/"
                  target="_blank"
                  rel="noreferrer"
                  title="Open USDG faucet"
                  aria-label="Open USDG faucet in a new tab"
                >
                  <Droplets className="metricCardFaucetIcon" size={14} aria-hidden="true" />
                  <span>Faucet</span>
                  <ExternalLink className="metricCardFaucetExternalIcon" size={10} aria-hidden="true" />
                </a>
              )}
            />
            <MetricCard
              label="ETH Balance"
              value={nativeBalanceLabel}
              action={(
                <a
                  className="metricCardFaucetAction"
                  href="https://faucet.testnet.chain.robinhood.com/"
                  target="_blank"
                  rel="noreferrer"
                  title="Open Robinhood testnet ETH faucet"
                  aria-label="Open Robinhood testnet ETH faucet in a new tab"
                >
                  <Droplets className="metricCardFaucetIcon" size={14} aria-hidden="true" />
                  <span>Faucet</span>
                  <ExternalLink className="metricCardFaucetExternalIcon" size={10} aria-hidden="true" />
                </a>
              )}
            />
          </div>

          <section className="sectionCard depositPositions">
            <div className="managedVaultsHeading">
              <div>
                <span className="appPageIcon"><CircleDollarSign size={16} /></span>
                <div><h2>OTF positions</h2><p>Shares held by the connected wallet.</p></div>
              </div>
              <span className="stateBadge muted">{positions.length} position{positions.length === 1 ? "" : "s"}</span>
            </div>
            {positions.length ? <div className="directoryTableWrap"><table className="directoryTable depositsTable">
              <thead><tr><th>OTF</th><th>Shares</th><th>NAV / share</th></tr></thead>
              <tbody>{positions.map((position) => <tr key={position.address} role="button" tabIndex={0} onClick={() => onOpenVault(position.address)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onOpenVault(position.address); }}>
                <td><div className="directoryVault"><OtfTokenIcon className="directoryVaultIcon" size={34} ticker={position.symbol} /><div><strong>{position.name}</strong><small>{position.symbol}</small></div></div></td>
                <td data-label="Shares" className="monoValue">{position.displayBalance}</td>
                <td data-label="NAV / share"><span className="tableValueWithHelp"><span>{position.navPerShare ?? "Unavailable"}</span>{position.navPerShare ? <ValueHelp text="This dollar value is the OTF's current onchain NAV per share: constituent balances valued in USD using each asset's configured pricing route. It is not a redemption quote. Routed or proportional redemption value can differ because of market movement, pool liquidity, fees, and slippage." /> : null}</span></td>
              </tr>)}</tbody>
            </table></div> : <div className="inlineEmptyState"><CircleDollarSign size={18} /><div><strong>No OTF positions found</strong><span>Your OTF shares will appear here after a purchase or deposit.</span></div></div>}
          </section>

          <section className="sectionCard managedVaultsPanel">
            <div className="managedVaultsHeading">
              <div>
                <span className="appPageIcon"><UserCog size={16} /></span>
                <div>
                  <h2>OTFs you manage</h2>
                  <p>Manager controls and protocol operations for OTFs currently managed by this wallet.</p>
                </div>
              </div>
              <div className="managedVaultsHeaderActions">
                {managedVaults.length ? <span className="stateBadge success">{managedVaults.length} OTF{managedVaults.length === 1 ? "" : "s"}</span> : null}
                <button className="primaryAction" type="button" onClick={onCreateVault}>
                  <Plus size={14} />
                  Create OTF
                </button>
              </div>
            </div>
            {managedVaults.length ? (
              <div className="directoryTableWrap">
                <table className="directoryTable managedDirectoryTable">
                  <thead>
                    <tr>
                      <th>OTF</th>
                      <th>NAV</th>
                      <th>Assets</th>
                      <th>Manager fee</th>
                      <th>Manager</th>
                    </tr>
                  </thead>
                  <tbody>
                    {managedVaults.map((row) => (
                      <tr
                        key={row.address}
                        role="button"
                        tabIndex={0}
                        onClick={() => onOpenVault(row.address)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") onOpenVault(row.address);
                        }}
                      >
                        <td>
                          <div className="directoryVault">
                            <OtfTokenIcon className="directoryVaultIcon" size={34} ticker={row.symbol} />
                            <div>
                              <strong>{row.name}</strong>
                              <small>{row.symbol} · {shortAddress(row.address)} {row.sunset ? "· Sunset" : ""}</small>
                              <span className={`stateBadge ${row.verified ? "success" : "warning"}`}>
                                {row.verified ? "Verified assets" : "Unverified assets"}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td data-label="NAV">{row.nav ?? "Oracle read failed"}</td>
                        <td data-label="Assets">{row.assetCount}</td>
                        <td data-label="Manager fee">{bpsToPercent(row.managerFeeBps)}</td>
                        <td data-label="Manager" className="monoValue">{shortAddress(row.manager)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="inlineEmptyState">
                <UserCog size={18} />
                <div><strong>No managed OTFs found</strong><span>OTFs will appear here whenever this wallet is their current manager.</span></div>
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="sectionCard depositsEmpty">
          <span><Wallet size={22} /></span>
          <h2>
            <ConnectButton.Custom>
              {({ mounted, openConnectModal }) => (
                <button
                  className="depositsConnectLink"
                  type="button"
                  disabled={!mounted}
                  onClick={openConnectModal}
                >
                  Connect your wallet
                </button>
              )}
            </ConnectButton.Custom>{" "}
            to view positions
          </h2>
          <p>OTF share positions will appear here after connecting.</p>
          <button className="secondaryAction" type="button" onClick={onBrowseVaults}><LayoutGrid size={14} />Browse OTFs</button>
        </section>
      )}
    </div>
  );
}

function VerifiedAssetsView({ isTestnet, oraclePrices }: { isTestnet: boolean; oraclePrices: CatalogOraclePrices }) {
  const testnetCreateAssets = useVerifiedAssetCatalog();
  return (
    <div className="appView">
      <AppPageHeader
        title="Verified Assets"
        description={<>Token identities and pricing routes checked against the app&apos;s <a href="/verified-assets.json" target="_blank" rel="noreferrer">verification registry</a>. Verification is informational and does not authorize OTF constituents.</>}
        icon={<ShieldCheck size={18} />}
        actions={isTestnet ? <a className="secondaryAction" href="https://faucet.testnet.chain.robinhood.com/" target="_blank" rel="noreferrer"><Droplets size={14} />Testnet faucet<ExternalLink size={12} /></a> : undefined}
      />
      {!isTestnet ? (
        <section className="sectionCard depositsEmpty"><span><Network size={22} /></span><h2>Mainnet verification is not available yet</h2><p>Switch on Testnet mode in Settings to inspect the current verified-asset registry.</p></section>
      ) : (
        <section className="sectionCard walletAssets">
          <div className="directoryPanelHeading"><div><h2>Verification details</h2><p>Registry verification paired with metadata read directly from each token contract.</p></div><span className="stateBadge success"><CheckCircle size={12} />{testnetCreateAssets.length} verified</span></div>
          <div className="directoryTableWrap"><table className="directoryTable rwaCatalogTable verifiedAssetsTable">
            <thead><tr><th>Onchain asset</th><th>Decimals</th><th>Token contract</th><th>Price sources</th><th>Reference price</th></tr></thead>
            <tbody>{testnetCreateAssets.map((asset) => {
              const oraclePrice = oraclePrices[asset.address.toLowerCase()];
              const verification = verifiedAssetFor(robinhoodChainTestnet.id, asset.address);
              const priceSources = verification?.approvedPricingConfigs ?? [];
              return (
                <tr key={asset.address}>
                  <td><div className="rwaAssetIdentity"><AssetLogo symbol={asset.symbol} /><div><strong>{asset.symbol}</strong><small>{asset.name}</small></div></div></td>
                  <td data-label="Decimals" className="monoValue">{asset.metadataLoading ? "Loading" : asset.decimals ?? "Unavailable"}</td>
                  <td data-label="Token contract" className="monoValue">
                    <a
                      className="tableAddressLink"
                      href={`${robinhoodChainTestnet.blockExplorers.default.url}/address/${asset.address}`}
                      target="_blank"
                      rel="noreferrer"
                      title={`Open ${asset.symbol} token contract ${asset.address}`}
                    >
                      {shortAssetAddress(asset.address)}
                      <ExternalLink size={11} />
                    </a>
                  </td>
                  <td data-label="Price sources">
                    <div className="verifiedPriceSources">
                      {priceSources.length
                        ? priceSources.map((config, index) => (
                          <PriceSourcePill
                            key={`${config.source}-${index}`}
                            config={config}
                            assetSymbol={asset.symbol}
                          />
                        ))
                        : <span className="mutedTableValue">Not configured</span>}
                    </div>
                  </td>
                  <td
                    data-label="Reference price"
                    className="monoValue"
                    title={oraclePrice?.updatedAt ? `Updated ${formatTimestamp(Number(oraclePrice.updatedAt))}` : undefined}
                  >
                    {formatRwaOraclePrice(oraclePrice)}
                  </td>
                </tr>
              );
            })}</tbody>
          </table></div>
        </section>
      )}
    </div>
  );
}

function ShareMarketPanel({ vault }: { vault: VaultView }) {
  const marketPairs = useMemo<V3TokenPair[]>(
    () => vault.address
      ? robinhoodTestnetMarketAssets.map((asset) => ({ tokenA: vault.address!, tokenB: asset.token }))
      : [],
    [vault.address],
  );
  const {
    pools: discoveredMarkets,
    isLoading: checking,
    isError: marketsError,
  } = useDiscoveredV3Pools(marketPairs, Boolean(vault.address));
  const marketRows = robinhoodTestnetMarketAssets.map((asset) => ({
    asset,
    pool: vault.address ? selectV3Pool(discoveredMarkets, vault.address, asset.token) : undefined,
  }));
  const liquidityAvailable = marketRows.some(({ pool }) => (
    pool?.liquidity !== undefined && pool.liquidity > 0n && !pool.readFailed
  ));
  const addLiquidityUrl = vault.address ? `/liquidity?vault=${vault.address}` : "/liquidity";

  return (
    <SectionCard
      title={`${vault.symbol} markets`}
      subtitle="Supported Uniswap V3 quote markets"
      icon={<Droplets size={15} />}
      action={
        <span className={`stateBadge ${liquidityAvailable ? "success" : "muted"}`}>
          {checking ? "Checking" : liquidityAvailable ? "Liquidity available" : "Awaiting liquidity"}
        </span>
      }
    >
      <div className="operationFlow shareMarketSetup">
        <div className="riskCallout info">
          <LockKeyhole size={15} />
          <div>
            <strong>Markets are independent from the OTF</strong>
            <span>The OTF exists without a pool. This app discovers supported quote markets and sends liquidity management to the external venue.</span>
          </div>
        </div>

        {marketRows.map(({ asset, pool }) => {
          const activeLiquidity = pool?.liquidity !== undefined && pool.liquidity > 0n && !pool.readFailed;
          return (
            <div className="roleCurrent" key={asset.token}>
              <span>{vault.symbol} / {asset.symbol}</span>
              <strong>
                {pool ? (
                  <a href={`${robinhoodChainTestnet.blockExplorers.default.url}/address/${pool.address}`} target="_blank" rel="noreferrer">
                    {shortAddress(pool.address)} · {pool.fee / 10_000}% <ExternalLink size={11} />
                  </a>
                ) : checking ? "Checking" : "No pool"}
              </strong>
              <small>{pool?.readFailed || marketsError ? "Liquidity read unavailable" : activeLiquidity ? "Active liquidity" : pool ? "Pool has no active liquidity" : "No pool yet"}</small>
            </div>
          );
        })}
        <div className="riskCallout info">
          <Info size={15} />
          <div><strong>Permissionless liquidity</strong><span>Each Uniswap position belongs to its supplying wallet and never uses assets held by the OTF portfolio.</span></div>
        </div>
        <a className="primaryAction" href={addLiquidityUrl}>
          <Droplets size={14} />Explore liquidity
        </a>
      </div>
    </SectionCard>
  );
}

function RebalanceHistoryPanel({ vault }: { vault: VaultView }) {
  const testnetCreateAssets = useVerifiedAssetCatalog();
  const {
    data: recentCountResult,
    isLoading: countLoading,
    isError: countFailed,
  } = useReadContract({
    address: vault.address,
    abi: managedOtfVaultAbi,
    functionName: "recentRebalanceCount",
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(vault.address), refetchInterval: 12_000 },
  });
  const recentCount = Number(recentCountResult ?? 0n);
  const recordContracts = vault.address
    ? Array.from({ length: recentCount }, (_, index) => ({
        address: vault.address,
        abi: managedOtfVaultAbi,
        functionName: "recentRebalanceRecord" as const,
        args: [BigInt(index)],
        chainId: robinhoodChainTestnet.id,
      }))
    : [];
  const {
    data: recordResults,
    isLoading: recordsLoading,
    isError: recordsFailed,
  } = useReadContracts({
    contracts: recordContracts,
    query: { enabled: recordContracts.length > 0, refetchInterval: 12_000 },
  });
  const {
    data: executionCountResult,
    isLoading: executionCountLoading,
    isError: executionCountFailed,
  } = useReadContract({
    address: vault.address,
    abi: managedOtfVaultAbi,
    functionName: "recentTradeExecutionCount",
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(vault.address), refetchInterval: 12_000 },
  });
  const executionCount = Number(executionCountResult ?? 0n);
  const executionContracts = vault.address
    ? Array.from({ length: executionCount }, (_, index) => ({
        address: vault.address,
        abi: managedOtfVaultAbi,
        functionName: "recentTradeExecutionRecord" as const,
        args: [BigInt(index)],
        chainId: robinhoodChainTestnet.id,
      }))
    : [];
  const {
    data: executionResults,
    isLoading: executionsLoading,
    isError: executionsFailed,
  } = useReadContracts({
    contracts: executionContracts,
    query: { enabled: executionContracts.length > 0, refetchInterval: 12_000 },
  });
  const executions = Array.from({ length: executionCount }, (_, index) => {
    const result = executionResults?.[index];
    if (result?.status !== "success") return undefined;
    return { index, record: result.result as TradeExecutionRecordResult };
  }).filter((entry): entry is { index: number; record: TradeExecutionRecordResult } => Boolean(entry));
  const records = Array.from({ length: recentCount }, (_, index) => {
    const result = recordResults?.[index];
    if (result?.status !== "success") return undefined;
    return { index, record: result.result as RebalanceRecordResult };
  }).filter((entry): entry is { index: number; record: RebalanceRecordResult } => Boolean(entry));
  const strategyIndexes = Array.from(new Set(records.flatMap(({ record }) => {
    const current = Number(record.strategyVersion);
    return current > 0 ? [current - 1, current] : [current];
  }))).sort((left, right) => left - right);
  const targetContracts = vault.address
    ? strategyIndexes.map((index) => ({
        address: vault.address,
        abi: managedOtfVaultAbi,
        functionName: "getStrategyTargets" as const,
        args: [BigInt(index)],
        chainId: robinhoodChainTestnet.id,
      }))
    : [];
  const {
    data: targetResults,
    isLoading: targetsLoading,
    isError: targetsFailed,
  } = useReadContracts({
    contracts: targetContracts,
    query: { enabled: targetContracts.length > 0, refetchInterval: 12_000 },
  });
  const targetsByVersion = new Map<number, { tokens: readonly string[]; weights: readonly (number | bigint)[] }>();
  strategyIndexes.forEach((strategyIndex, resultIndex) => {
    const result = targetResults?.[resultIndex];
    if (result?.status !== "success") return;
    const [tokens, weights] = result.result as readonly [readonly string[], readonly (number | bigint)[]];
    targetsByVersion.set(strategyIndex, { tokens, weights });
  });
  const retainedLossBps = records.reduce(
    (total, { record }) => total + Number(record.executionLossBps),
    0,
  );
  const loading = countLoading || executionCountLoading
    || (recentCount > 0 && (recordsLoading || targetsLoading))
    || (executionCount > 0 && executionsLoading);
  const failed = countFailed || recordsFailed || targetsFailed
    || executionCountFailed || executionsFailed;

  function targetChanges(record: RebalanceRecordResult) {
    const versionIndex = Number(record.strategyVersion);
    const previous = targetsByVersion.get(versionIndex - 1);
    const next = targetsByVersion.get(versionIndex);
    if (!next) return [];
    const previousWeights = new Map(
      (previous?.tokens ?? []).map((token, index) => [token.toLowerCase(), Number(previous?.weights[index] ?? 0)]),
    );
    const nextWeights = new Map(
      next.tokens.map((token, index) => [token.toLowerCase(), Number(next.weights[index] ?? 0)]),
    );
    return Array.from(new Set([...previousWeights.keys(), ...nextWeights.keys()])).flatMap((address) => {
      const before = previousWeights.get(address) ?? 0;
      const after = nextWeights.get(address) ?? 0;
      if (before === after) return [];
      const asset = catalogAssetForAddress(testnetCreateAssets, address);
      return [{ address, symbol: asset?.symbol ?? shortAddress(address), logoUrl: asset?.logoUrl, before, after }];
    });
  }

  return (
    <SectionCard
      title="Rebalance history"
      subtitle="Completed target changes and their associated onchain executions"
      icon={<Activity size={15} />}
      action={<span className="stateBadge muted">{recentCount || executionCount ? `${recentCount} completed · ${executionCount} executions` : "No records"}</span>}
    >
      {loading ? (
        <div className="inlineEmptyState"><Loader2 className="spin" size={17} /><div><strong>Loading rebalance history</strong><span>Reading retained completion records and target snapshots from the OTF.</span></div></div>
      ) : failed ? (
        <div className="inlineEmptyState"><RefreshCw size={17} /><div><strong>Rebalance history unavailable</strong><span>The contract did not return every retained rebalance record.</span></div></div>
      ) : records.length ? (
        <div className="rebalanceHistoryBody">
          <div className="rebalanceHistorySummary">
            <div><span>Completed</span><strong>{records.length}</strong><small>retained onchain</small></div>
            <div><span>Execution loss</span><strong>{bpsToPercent(retainedLossBps)}</strong><small>cumulative across completed strategies</small></div>
            <div><span>Latest completion</span><strong>{formatTimestamp(Number(records.at(-1)?.record.timestamp ?? 0n))}</strong><small>chain timestamp</small></div>
          </div>
          <div className="rebalanceHistoryList">
            {[...records].reverse().map(({ index, record }) => {
              const changes = targetChanges(record);
              const navChangeBps = record.navPerShareBefore > 0n
                ? Number((record.navPerShareAfter - record.navPerShareBefore) * 10_000n / record.navPerShareBefore)
                : 0;
              return (
                <article className="rebalanceHistoryEntry" key={`${index}-${record.timestamp}`}>
                  <div className="rebalanceHistoryHeader">
                    <div><strong>Rebalance {index + 1}</strong><span className="stateBadge success">Completed</span></div>
                    <time>{formatTimestamp(Number(record.timestamp))}</time>
                  </div>
                  <div className="rebalanceImpactMetrics">
                    <div><span>NAV/share before</span><strong>{formatUsd18(record.navPerShareBefore) ?? "Unavailable"}</strong></div>
                    <ArrowRight size={13} />
                    <div><span>NAV/share after</span><strong>{formatUsd18(record.navPerShareAfter) ?? "Unavailable"}</strong></div>
                    <div className={navChangeBps < 0 ? "danger" : "success"}><span>NAV/share change</span><strong>{navChangeBps > 0 ? "+" : ""}{(navChangeBps / 100).toFixed(2)}%</strong></div>
                    <div><span>Turnover</span><strong>{bpsToPercent(Number(record.turnoverBps))}</strong></div>
                    <div><span>Execution loss</span><strong>{bpsToPercent(Number(record.executionLossBps))}</strong></div>
                  </div>
                  {changes.length ? (
                    <div className="rebalanceTargetChanges" aria-label="Target weights before and after">
                      {changes.map((change) => (
                        <div key={change.address}>
                          <span className="assetNameWithLogo"><AssetLogo logoUrl={change.logoUrl} symbol={change.symbol} compact /><strong>{change.symbol}</strong></span>
                          <span>{change.before === 0 ? <em>Added</em> : bpsToPercent(change.before)}<ArrowRight size={11} />{change.after === 0 ? <em>Removed</em> : bpsToPercent(change.after)}</span>
                        </div>
                      ))}
                    </div>
                  ) : <small className="rebalanceHistoryNote">No target-weight changes were returned for this retained record.</small>}
                  <div className="rebalanceHistoryMeta"><span>Strategy {Number(record.strategyVersion)}</span><span>Manager <code>{shortAddress(record.manager)}</code></span></div>
                </article>
              );
            })}
          </div>
          <p className="rebalanceHistoryFootnote">Weights show strategy targets before and after each rebalance. Per-share NAV avoids making deposits and redemptions look like performance; oracle price changes and fees can still affect the interval.</p>
        </div>
      ) : (
        <div className="inlineEmptyState"><Activity size={17} /><div><strong>No completed rebalances yet</strong><span>The first completed strategy change will appear here with its target shift, turnover, and recorded NAV impact.</span></div></div>
      )}
      {executions.length ? (
        <div className="rebalanceHistoryBody">
          <div className="rebalanceHistoryHeader"><div><strong>Latest trade executions</strong><span className="stateBadge muted">Last {executions.length} of 16</span></div></div>
          <div className="rebalanceHistoryList">
            {[...executions].reverse().map(({ index, record }) => (
              <article className="rebalanceHistoryEntry" key={`execution-${index}-${record.timestamp}`}>
                <div className="rebalanceHistoryHeader"><div><strong>Execution {index + 1}</strong></div><time>{formatTimestamp(Number(record.timestamp))}</time></div>
                <div className="rebalanceImpactMetrics">
                  <div><span>Batch loss</span><strong>{bpsToPercent(Number(record.batchLossBps))}</strong></div>
                  <div><span>Bucket used</span><strong>{bpsToPercent(Number(record.navLossBudgetUsedBps))} / {bpsToPercent(vault.maxNavLossBps)}</strong></div>
                  <div><span>NAV before</span><strong>{formatUsd18(record.navBefore) ?? "Unavailable"}</strong></div>
                  <ArrowRight size={13} />
                  <div><span>NAV after</span><strong>{formatUsd18(record.navAfter) ?? "Unavailable"}</strong></div>
                </div>
                <div className="rebalanceHistoryMeta"><span>{Number(record.tradeCount)} trade{Number(record.tradeCount) === 1 ? "" : "s"}</span><span>Executor <code>{shortAddress(record.executor)}</code></span><span>Strategy {Number(record.strategyVersion)}</span></div>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </SectionCard>
  );
}

function ManageVaultsView({
  vault,
  oraclePrices,
  onBack,
  onOpenVault,
  onRefresh,
}: {
  vault: VaultView;
  oraclePrices: CatalogOraclePrices;
  onBack: () => void;
  onOpenVault: () => void;
  onRefresh: () => Promise<unknown>;
}) {
  const [managerTarget, setManagerTarget] = useState("");
  const [feeTarget, setFeeTarget] = useState("");
  const [executorTarget, setExecutorTarget] = useState("");
  const [copied, setCopied] = useState(false);
  const [feeAccrualState, setFeeAccrualState] = useState<TxState>("idle");
  const [feeAccrualError, setFeeAccrualError] = useState<string>();
  const [managerTransferState, setManagerTransferState] = useState<TxState>("idle");
  const [managerTransferError, setManagerTransferError] = useState<string>();
  const [feeTransferState, setFeeTransferState] = useState<TxState>("idle");
  const [feeTransferError, setFeeTransferError] = useState<string>();
  const [executorState, setExecutorState] = useState<TxState>("idle");
  const [executorError, setExecutorError] = useState<string>();
  const [completionBandPercent, setCompletionBandPercent] = useState(
    () => String(vault.maxWeightDeviationBps / 100),
  );
  const [challengeBandPercent, setChallengeBandPercent] = useState(
    () => String(vault.challengeWeightDeviationBps / 100),
  );
  const [weightBandState, setWeightBandState] = useState<TxState>("idle");
  const [weightBandError, setWeightBandError] = useState<string>();
  const [sunsetConfirmationOpen, setSunsetConfirmationOpen] = useState(false);
  const [sunsetConfirmation, setSunsetConfirmation] = useState("");
  const [sunsetState, setSunsetState] = useState<TxState>("idle");
  const [sunsetError, setSunsetError] = useState<string>();
  const sunsetButtonRef = useRef<HTMLButtonElement>(null);
  const [activeOperation, setActiveOperation] = useState<"targets" | "rebalance" | "liquidity" | "roles" | "fees">("targets");
  const { address: connectedAddress } = useAccount();
  const publicClient = usePublicClient({ chainId: robinhoodChainTestnet.id });
  const { writeContractAsync } = useWriteContract();
  const { data: pendingManagerResult } = useReadContract({
    address: vault.address,
    abi: managedOtfVaultAbi,
    functionName: "pendingManager",
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(vault.enabled && vault.address), refetchInterval: 12_000 },
  });
  const pendingManager = isAddress(pendingManagerResult ?? "")
    && pendingManagerResult !== zeroAddress
    ? pendingManagerResult
    : undefined;
  const connectedIsPendingManager = Boolean(
    connectedAddress && pendingManager
    && connectedAddress.toLowerCase() === pendingManager.toLowerCase(),
  );
  const managerWeightBandPolicyContracts = vault.factoryAddress ? ([
    { address: vault.factoryAddress, abi: otfFactoryAbi, functionName: "minCompletionDeviationBps" },
    { address: vault.factoryAddress, abi: otfFactoryAbi, functionName: "maxCompletionDeviationBps" },
    { address: vault.factoryAddress, abi: otfFactoryAbi, functionName: "minChallengeDeviationGapBps" },
    { address: vault.factoryAddress, abi: otfFactoryAbi, functionName: "maxChallengeDeviationBps" },
  ] as const) : undefined;
  const {
    data: managerWeightBandPolicyResults,
    isLoading: managerWeightBandPolicyLoading,
    isError: managerWeightBandPolicyReadFailed,
  } = useReadContracts({
    contracts: managerWeightBandPolicyContracts,
    query: {
      enabled: Boolean(vault.enabled && vault.factoryAddress && !vault.sunset),
      refetchInterval: 12_000,
      refetchOnWindowFocus: true,
    },
  });
  const managerWeightBandLimits: WeightBandLimits | undefined =
    managerWeightBandPolicyResults?.length === 4
    && managerWeightBandPolicyResults.every((result) => result.status === "success")
      ? {
          minCompletionDeviationBps: Number(managerWeightBandPolicyResults[0].result),
          maxCompletionDeviationBps: Number(managerWeightBandPolicyResults[1].result),
          minChallengeDeviationGapBps: Number(managerWeightBandPolicyResults[2].result),
          maxChallengeDeviationBps: Number(managerWeightBandPolicyResults[3].result),
        }
      : undefined;
  const {
    data: feeWithdrawalPreview,
    isLoading: feeWithdrawalPreviewLoading,
    refetch: refetchFeeWithdrawalPreview,
  } = useSimulateContract({
    account: vault.manager as `0x${string}` | undefined,
    address: vault.address,
    abi: vaultFeeAbi,
    functionName: "withdrawManagerFees",
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(vault.enabled && vault.address && vault.manager && !vault.sunset) },
  });
  const pendingManagerFeeShares = feeWithdrawalPreview?.result !== undefined
    ? feeWithdrawalPreview.result * BigInt(10_000 - vault.effectiveProtocolFeeShareBps) / 10_000n
    : undefined;
  const pendingManagerFeeDisplay = feeWithdrawalPreviewLoading
    ? "Calculating"
    : pendingManagerFeeShares !== undefined
      ? `${formatWalletTokenBalance(pendingManagerFeeShares, 18)} ${vault.symbol}`
      : "Preview unavailable";
  useEffect(() => {
    setCompletionBandPercent(String(vault.maxWeightDeviationBps / 100));
    setChallengeBandPercent(String(vault.challengeWeightDeviationBps / 100));
  }, [vault.address, vault.challengeWeightDeviationBps, vault.maxWeightDeviationBps]);
  useEffect(() => {
    setWeightBandError(undefined);
    setWeightBandState("idle");
  }, [vault.address]);
  const managerValid = isAddress(managerTarget)
    && !/^0x0{40}$/i.test(managerTarget)
    && managerTarget.toLowerCase() !== vault.manager?.toLowerCase()
    && managerTarget.toLowerCase() !== vault.address?.toLowerCase();
  const feeTargetValid = isAddress(feeTarget)
    && !/^0x0{40}$/i.test(feeTarget)
    && feeTarget.toLowerCase() !== vault.feeRecipient?.toLowerCase()
    && feeTarget.toLowerCase() !== vault.address?.toLowerCase();
  const executorValid = isAddress(executorTarget)
    && !/^0x0{40}$/i.test(executorTarget)
    && executorTarget.toLowerCase() !== vault.address?.toLowerCase()
    && !vault.authorizedExecutors.some((executor) => executor.toLowerCase() === executorTarget.toLowerCase());
  const managerTransferBusy = managerTransferState === "pending" || managerTransferState === "submitted";
  const feeTransferBusy = feeTransferState === "pending" || feeTransferState === "submitted";
  const executorBusy = executorState === "pending" || executorState === "submitted";
  const weightBandBusy = weightBandState === "simulating"
    || weightBandState === "pending"
    || weightBandState === "submitted";
  const sunsetBusy = sunsetState === "pending" || sunsetState === "submitted";
  const sunsetCooldownRemaining = useLiveCountdown(vault.nextStrategyChange);
  const proposedCompletionBandBps = percentToBps(completionBandPercent);
  const proposedChallengeBandBps = percentToBps(challengeBandPercent);
  const weightBandInputError = managerWeightBandLimits
    ? weightBandValidationError(
        proposedCompletionBandBps,
        proposedChallengeBandBps,
        managerWeightBandLimits,
      )
    : undefined;
  const weightBandsChanged = proposedCompletionBandBps !== vault.maxWeightDeviationBps
    || proposedChallengeBandBps !== vault.challengeWeightDeviationBps;
  const weightBandBlockers = [
    sunsetCooldownRemaining > 0
      ? `Wait for the strategy cooldown to finish in ${formatCooldown(sunsetCooldownRemaining)}.`
      : undefined,
    vault.challengeActive ? "Resolve the active challenge first." : undefined,
    vault.strategyProposalPending ? "Cancel or activate the pending strategy proposal first." : undefined,
    vault.strategicRebalanceActive ? "Complete the active strategic rebalance first." : undefined,
    !vault.withinCompletionBands ? "Return the portfolio to its current completion bands first." : undefined,
  ].filter((reason): reason is string => Boolean(reason));
  const weightBandPolicyUnavailable = !managerWeightBandPolicyLoading
    && (managerWeightBandPolicyReadFailed || !managerWeightBandLimits);
  const canUpdateWeightBands = Boolean(
    vault.enabled
    && vault.connectedIsManager
    && managerWeightBandLimits
    && !weightBandInputError
    && weightBandsChanged
    && weightBandBlockers.length === 0
    && !weightBandBusy,
  );
  const sunsetBlockers = [
    sunsetCooldownRemaining > 0
      ? `Wait for the strategy cooldown to finish in ${formatCooldown(sunsetCooldownRemaining)}, on ${formatTimestamp(vault.nextStrategyChange)}.`
      : undefined,
    vault.challengeActive ? "Resolve the active challenge first." : undefined,
    vault.strategyProposalPending ? "Cancel or activate the pending strategy proposal first." : undefined,
    vault.strategicRebalanceActive ? "Complete the active strategic rebalance first." : undefined,
  ].filter((reason): reason is string => Boolean(reason));
  const sunsetEligible = vault.enabled && vault.connectedIsManager && !vault.sunset && sunsetBlockers.length === 0;

  function closeSunsetConfirmation() {
    if (sunsetBusy) return;
    setSunsetConfirmationOpen(false);
    setSunsetConfirmation("");
    setSunsetError(undefined);
    window.requestAnimationFrame(() => sunsetButtonRef.current?.focus());
  }

  useEffect(() => {
    if (!sunsetConfirmationOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !sunsetBusy) {
        setSunsetConfirmationOpen(false);
        setSunsetConfirmation("");
        setSunsetError(undefined);
        window.requestAnimationFrame(() => sunsetButtonRef.current?.focus());
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [sunsetBusy, sunsetConfirmationOpen]);

  async function copyVaultAddress() {
    if (!vault.address) return;
    try {
      await navigator.clipboard.writeText(vault.address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  }

  async function withdrawVaultFees() {
    if (!vault.address || !connectedAddress || !publicClient) return;
    setFeeAccrualError(undefined);
    try {
      setFeeAccrualState("pending");
      const hash = await writeContractAsync({
        address: vault.address,
        abi: vaultFeeAbi,
        functionName: "withdrawManagerFees",
        chainId: robinhoodChainTestnet.id,
      });
      setFeeAccrualState("submitted");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The fee withdrawal reverted.");
      await onRefresh();
      await refetchFeeWithdrawalPreview();
      setFeeAccrualState("confirmed");
    } catch (error) {
      setFeeAccrualError(errorMessage(error));
      setFeeAccrualState("reverted");
    }
  }

  async function submitSunset() {
    if (!vault.address || !publicClient || !sunsetEligible || sunsetConfirmation !== vault.name) return;
    setSunsetError(undefined);
    try {
      setSunsetState("pending");
      const hash = await writeContractAsync({
        address: vault.address,
        abi: managedOtfVaultAbi,
        functionName: "sunsetOtf",
        chainId: robinhoodChainTestnet.id,
      });
      setSunsetState("submitted");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The OTF sunset transaction reverted.");
      await onRefresh();
      setSunsetState("confirmed");
      setSunsetConfirmation("");
      setSunsetConfirmationOpen(false);
    } catch (error) {
      setSunsetError(errorMessage(error));
      setSunsetState("reverted");
    }
  }

  async function runRoleWrite(
    submit: () => Promise<`0x${string}`>,
    setState: (state: TxState) => void,
    setError: (message?: string) => void,
    failureMessage: string,
    onSuccess?: () => void,
  ) {
    if (!publicClient) return;
    setError(undefined);
    try {
      setState("pending");
      const hash = await submit();
      setState("submitted");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(failureMessage);
      await onRefresh();
      onSuccess?.();
      setState("confirmed");
    } catch (error) {
      setError(errorMessage(error));
      setState("reverted");
    }
  }

  async function transferManager(newManager: `0x${string}`) {
    if (!vault.address || !vault.connectedIsManager) return;
    const vaultAddress = vault.address;
    await runRoleWrite(
      () => writeContractAsync({
        address: vaultAddress,
        abi: managedOtfVaultAbi,
        functionName: "transferOwnership",
        args: [newManager],
        chainId: robinhoodChainTestnet.id,
      }),
      setManagerTransferState,
      setManagerTransferError,
      "The manager transfer reverted.",
      () => setManagerTarget(""),
    );
  }

  async function acceptManagerOwnership() {
    if (!vault.address || !connectedIsPendingManager) return;
    const vaultAddress = vault.address;
    await runRoleWrite(
      () => writeContractAsync({
        address: vaultAddress,
        abi: managedOtfVaultAbi,
        functionName: "acceptOwnership",
        chainId: robinhoodChainTestnet.id,
      }),
      setManagerTransferState,
      setManagerTransferError,
      "Accepting the manager transfer reverted.",
    );
  }

  async function updateFeeRecipient() {
    if (!vault.address || !vault.connectedIsManager || !feeTargetValid) return;
    const vaultAddress = vault.address;
    await runRoleWrite(
      () => writeContractAsync({
        address: vaultAddress,
        abi: managedOtfVaultAbi,
        functionName: "setFeeRecipient",
        args: [feeTarget as `0x${string}`],
        chainId: robinhoodChainTestnet.id,
      }),
      setFeeTransferState,
      setFeeTransferError,
      "The fee-recipient update reverted.",
      () => setFeeTarget(""),
    );
  }

  async function updateWeightBands() {
    if (
      !vault.address || !connectedAddress || !publicClient || !canUpdateWeightBands
      || proposedCompletionBandBps > 10_000 || proposedChallengeBandBps > 10_000
    ) return;
    setWeightBandError(undefined);
    try {
      setWeightBandState("simulating");
      await publicClient.simulateContract({
        account: connectedAddress,
        address: vault.address,
        abi: managedOtfVaultAbi,
        functionName: "setWeightBands",
        args: [proposedCompletionBandBps, proposedChallengeBandBps],
      });
      setWeightBandState("pending");
      const hash = await writeContractAsync({
        address: vault.address,
        abi: managedOtfVaultAbi,
        functionName: "setWeightBands",
        args: [proposedCompletionBandBps, proposedChallengeBandBps],
        chainId: robinhoodChainTestnet.id,
      });
      setWeightBandState("submitted");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The weight-band update reverted.");
      await onRefresh();
      setWeightBandState("confirmed");
    } catch (error) {
      setWeightBandError(errorMessage(error));
      setWeightBandState("reverted");
    }
  }

  async function setExecutorAuthorization(executor: string, authorized: boolean) {
    if (!vault.address || !vault.connectedIsManager || !isAddress(executor)) return;
    const vaultAddress = vault.address;
    await runRoleWrite(
      () => writeContractAsync({
        address: vaultAddress,
        abi: managedOtfVaultAbi,
        functionName: "setExecutor",
        args: [executor, authorized],
        chainId: robinhoodChainTestnet.id,
      }),
      setExecutorState,
      setExecutorError,
      authorized ? "Authorizing the executor reverted." : "Removing the executor reverted.",
      authorized ? () => setExecutorTarget("") : undefined,
    );
  }

  return (
    <div className="appView">
      <div className="vaultBreadcrumb appBreadcrumb">
        <button type="button" onClick={onBack}>
          <ArrowLeft size={12} />
          OTFs
        </button>
        <span>/</span>
        <button type="button" onClick={onOpenVault}>{vault.name}</button>
        <span>/</span>
        <strong>Manage</strong>
      </div>
      <AppPageHeader
        title="Manage"
        description="Administer OTF roles and routine protocol operations."
        icon={<UserCog size={18} />}
        actions={
          <button className="secondaryAction" type="button" onClick={onOpenVault}>
            Open OTF
            <ChevronRight size={14} />
          </button>
        }
      />

      {sunsetConfirmationOpen && !vault.sunset ? (
        <div className="sunsetDialogBackdrop">
          <section
            className="sunsetConfirmation"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sunset-confirmation-title"
            aria-describedby="sunset-confirmation-description"
            onKeyDown={(event) => {
              if (event.key !== "Tab") return;
              const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
                "button:not([disabled]), input:not([disabled])",
              ));
              const first = focusable.at(0);
              const last = focusable.at(-1);
              if (!first || !last) return;
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
              }
            }}
          >
            <div className="sunsetConfirmationCopy">
              <span className="appPageIcon"><Sun size={18} /></span>
              <div>
                <h2 id="sunset-confirmation-title">Permanently sunset {vault.name}</h2>
                <p id="sunset-confirmation-description">This is an irreversible wind-down action. Review every consequence before signing the transaction.</p>
              </div>
              <button className="sunsetDialogClose" type="button" aria-label="Cancel OTF sunset" autoFocus={sunsetBlockers.length > 0} disabled={sunsetBusy} onClick={closeSunsetConfirmation}>
                <X size={16} />
              </button>
            </div>

            <ul className="sunsetConsequences">
              <li><strong>Primary deposits close permanently.</strong><span>No new shares can be minted with USDG or an RWA basket.</span></li>
              <li><strong>Fees stop after one final checkpoint.</strong><span>No further manager or protocol fees accrue.</span></li>
              <li><strong>Strategy operations end.</strong><span>No new challenges, target changes, or rebalance trades can start.</span></li>
              <li><strong>The exit remains open.</strong><span>Share transfers, secondary-market trading, and proportional redemptions continue.</span></li>
            </ul>

            {sunsetBlockers.length ? (
              <div className="validationSummary warning" role="status">
                <AlertTriangle size={15} />
                <div><strong>This OTF is not ready to sunset</strong><span>{sunsetBlockers.join(" ")}</span></div>
              </div>
            ) : (
              <label className="sunsetConfirmationField">
                <span>Type the OTF name <strong>{vault.name}</strong> to confirm</span>
                <input
                  value={sunsetConfirmation}
                  onChange={(event) => setSunsetConfirmation(event.target.value)}
                  aria-label="OTF name confirmation"
                  autoComplete="off"
                  autoFocus
                  spellCheck={false}
                  disabled={sunsetBusy}
                />
              </label>
            )}
            {sunsetError ? <div className="validationSummary danger" role="alert"><XCircle size={15} /><div><strong>OTF sunset failed</strong><span>{sunsetError}</span></div></div> : null}
            <TxStatus state={sunsetState} />
            <div className="buttonRow">
              <button className="secondaryAction" type="button" disabled={sunsetBusy} onClick={closeSunsetConfirmation}>Cancel</button>
              <button className="dangerAction" type="button" disabled={!sunsetEligible || sunsetConfirmation !== vault.name || sunsetBusy} onClick={submitSunset}>
                {sunsetBusy ? <Loader2 className="spin" size={14} /> : <Sun size={14} />}
                {sunsetBusy ? "Confirming sunset" : "Permanently sunset OTF"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <section className="manageVaultHeader">
        <div className="vaultIdentity">
          <OtfTokenIcon className="vaultMonogram" size={46} ticker={vault.symbol} />
          <div>
            <div className="titleLine"><h2>{vault.name}</h2>{vault.sunset ? <span className="stateBadge danger">Sunset</span> : null}</div>
            <div className="addressLine"><AddressPill label="OTF" address={vault.address} copied={copied} onCopy={copyVaultAddress} /></div>
          </div>
        </div>
        <div className="vaultMetaBadges">
          <span className={`stateBadge ${vault.connectedIsManager ? "success" : "muted"}`}>
            {vault.connectedIsManager ? "Manager connected" : "Observer mode"}
          </span>
        </div>
      </section>

      <SunsetStatusBanner vault={vault} />

      <ChallengeCountdownBanner vault={vault} />

      <DataProvenance vault={vault} />

      <div className="manageMetrics">
        <MetricCard label="Current Manager" value={shortAddress(vault.manager)} icon={<KeyRound size={14} />} />
        <MetricCard label="Fee Recipient" value={shortAddress(vault.feeRecipient)} icon={<ReceiptText size={14} />} />
        <MetricCard label="Manager Fee" value={bpsToPercent(vault.managerFeeBps)} icon={<Percent size={14} />} />
        <MetricCard label="Strategy Cooldown" value={formatCooldown(vault.cooldownSeconds)} icon={<Clock3 size={14} />} />
      </div>

      {vault.sunset ? (
        <SectionCard
          title="Wind-down mode"
          subtitle="The portfolio is permanently closed to new capital and management changes"
          icon={<Sun size={15} />}
          action={<span className="stateBadge danger">Terminal state</span>}
        >
          <div className="operationFlow">
            <div className="permissionList">
              <div><CheckCircle size={14} /><span><strong>Proportional redemptions remain open</strong><small>Shareholders can burn shares and receive their portion of every constituent.</small></span></div>
              <div><CheckCircle size={14} /><span><strong>Share transfers remain open</strong><small>OTF shares retain their standard ERC-20 transfer behavior.</small></span></div>
              <div><XCircle size={14} /><span><strong>Deposits and new fees are stopped</strong><small>No new shares can be minted through a basket deposit, and fee accrual ended at sunset.</small></span></div>
              <div><XCircle size={14} /><span><strong>Portfolio management is stopped</strong><small>New challenges, target changes, and rebalance trades are permanently disabled.</small></span></div>
            </div>
            <button className="primaryAction" type="button" onClick={onOpenVault}>
              Open redemption view <ChevronRight size={14} />
            </button>
          </div>
        </SectionCard>
      ) : <>
      <div className="managerOperationTabs" role="tablist" aria-label="Manager operations">
        {([
          ["targets", "Update targets"],
          ["rebalance", "Rebalance"],
          ["liquidity", "Liquidity"],
          ["roles", "Roles"],
          ["fees", "Fees"],
        ] as const).map(([value, label]) => (
          <button
            className={activeOperation === value ? "active" : ""}
            key={value}
            type="button"
            role="tab"
            aria-selected={activeOperation === value}
            onClick={() => setActiveOperation(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {activeOperation === "targets" ? <TargetWeightsBuilder vault={vault} onRefresh={onRefresh} /> : null}

      {activeOperation === "rebalance" ? <RebalanceTradesPanel vault={vault} oraclePrices={oraclePrices} onRefresh={onRefresh} /> : null}

      {activeOperation === "liquidity" ? <ShareMarketPanel vault={vault} /> : null}

      {activeOperation !== "targets" && activeOperation !== "rebalance" && activeOperation !== "liquidity" ? <div className="manageGrid">
        {activeOperation === "roles" ? (
          <>
        {vault.connectedIsManager ? (
        <SectionCard title="Update weight bands" subtitle="Change completion and challenge thresholds within current factory policy" icon={<Scale size={15} />} action={<span className="stateBadge muted">Manager only</span>}>
          <div className="operationFlow">
            <div className="accrualSummary">
              <div><span>Current completion</span><strong>{bpsToPercent(vault.maxWeightDeviationBps)}</strong></div>
              <div><span>Current challenge</span><strong>{bpsToPercent(vault.challengeWeightDeviationBps)}</strong></div>
              <div><span>Factory completion range</span><strong>{managerWeightBandLimits ? `${bpsToPercent(managerWeightBandLimits.minCompletionDeviationBps)}–${bpsToPercent(managerWeightBandLimits.maxCompletionDeviationBps)}` : "Loading"}</strong></div>
              <div><span>Factory challenge policy</span><strong>{managerWeightBandLimits ? `+${bpsToPercent(managerWeightBandLimits.minChallengeDeviationGapBps)} gap · ${bpsToPercent(managerWeightBandLimits.maxChallengeDeviationBps)} max` : "Loading"}</strong></div>
            </div>
            <div className="formGrid twoColumns">
              <label>
                <span>Completion band</span>
                <div className="inputWithSuffix">
                  <input
                    className={weightBandInputError ? "invalid" : undefined}
                    type="number"
                    min={managerWeightBandLimits ? managerWeightBandLimits.minCompletionDeviationBps / 100 : undefined}
                    max={managerWeightBandLimits ? managerWeightBandLimits.maxCompletionDeviationBps / 100 : undefined}
                    step={0.01}
                    value={completionBandPercent}
                    onChange={(event) => setCompletionBandPercent(event.target.value)}
                    disabled={weightBandBusy || !managerWeightBandLimits}
                  />
                  <span>+/- %</span>
                </div>
                <small>Every constituent must be within this fixed portfolio-weight distance to complete.</small>
              </label>
              <label>
                <span>Challenge band</span>
                <div className="inputWithSuffix">
                  <input
                    className={weightBandInputError ? "invalid" : undefined}
                    type="number"
                    min={managerWeightBandLimits ? (proposedCompletionBandBps + managerWeightBandLimits.minChallengeDeviationGapBps) / 100 : undefined}
                    max={managerWeightBandLimits ? managerWeightBandLimits.maxChallengeDeviationBps / 100 : undefined}
                    step={0.01}
                    value={challengeBandPercent}
                    onChange={(event) => setChallengeBandPercent(event.target.value)}
                    disabled={weightBandBusy || !managerWeightBandLimits}
                  />
                  <span>+/- %</span>
                </div>
                <small>A challenge may start when any constituent exceeds this fixed portfolio-weight distance.</small>
              </label>
            </div>
            {managerWeightBandPolicyLoading ? <div className="inlineEmptyState"><Loader2 className="spin" size={16} /><div><strong>Loading factory policy</strong><span>Reading the current weight-band limits before enabling this update.</span></div></div> : null}
            {weightBandPolicyUnavailable ? <div className="validationSummary danger" role="alert"><RefreshCw size={15} /><div><strong>Factory policy unavailable</strong><span>The update stays disabled until all four current limits can be read.</span></div></div> : null}
            {weightBandInputError ? <div className="validationSummary warning" role="status"><AlertTriangle size={15} /><div><strong>Review the proposed bands</strong><span>{weightBandInputError}</span></div></div> : null}
            {weightBandBlockers.length ? <div className="validationSummary warning" role="status"><Clock3 size={15} /><div><strong>Weight-band update locked</strong><span>{weightBandBlockers.join(" ")}</span></div></div> : null}
            {!weightBandsChanged && managerWeightBandLimits ? <p>Enter a different completion or challenge value to submit an update.</p> : null}
            {weightBandError ? <div className="validationSummary danger" role="alert"><XCircle size={15} /><div><strong>Weight-band update failed</strong><span>{weightBandError}</span></div></div> : null}
            <TxStatus state={weightBandState} />
            <button className="primaryAction" type="button" disabled={!canUpdateWeightBands} onClick={updateWeightBands}>
              {weightBandBusy ? <Loader2 className="spin" size={14} /> : <Scale size={14} />}
              {weightBandState === "simulating" ? "Validating update" : weightBandBusy ? "Confirming update" : "Update weight bands"}
            </button>
          </div>
        </SectionCard>
        ) : null}
        <SectionCard title="Manager transfer" subtitle="Nominate a new manager, then wait for their acceptance" icon={<KeyRound size={15} />} action={<span className="stateBadge muted">Two step</span>}>
          <div className="operationFlow">
            <div className="roleCurrent"><span>Current manager</span><strong>{shortAddress(vault.manager)}</strong></div>
            {pendingManager ? <div className="roleCurrent"><span>Pending manager</span><strong>{shortAddress(pendingManager)}</strong></div> : null}
            <label className="fieldLabel">New manager address</label>
            <input className={!managerValid && managerTarget ? "invalid" : ""} value={managerTarget} onChange={(event) => setManagerTarget(event.target.value)} placeholder="0x..." disabled={!vault.enabled || !vault.connectedIsManager} />
            <div className="riskCallout warning managerTransferWarning">
              <KeyRound size={17} />
              <div>
                <strong>The current manager remains active until acceptance</strong>
                <span>Nominating another address does not change strategy authority, executors, fees, or pending strategy state. The current manager may replace or cancel the nomination.</span>
              </div>
            </div>
            <p>On acceptance, accrued fees are checkpointed, pending manager strategy state is cancelled, all current executors are cleared, and the new manager becomes the sole executor.</p>
            {managerTransferError ? <div className="validationSummary danger" role="alert"><AlertTriangle size={15} /><div><strong>Manager transfer failed</strong><span>{managerTransferError}</span></div></div> : null}
            <TxStatus state={managerTransferState} />
            <div className="builderActions">
              {vault.connectedIsManager && pendingManager ? <button className="secondaryAction" type="button" disabled={managerTransferBusy} onClick={() => transferManager(zeroAddress)}>
                <XCircle size={14} /> Cancel nomination
              </button> : null}
              {vault.connectedIsManager ? <button className="primaryAction" type="button" disabled={!managerValid || managerTransferBusy} onClick={() => transferManager(managerTarget as `0x${string}`)}>
                <UserCog size={14} />
                {managerTransferBusy ? "Confirming nomination" : pendingManager ? "Replace nomination" : "Nominate manager"}
              </button> : null}
              {connectedIsPendingManager ? <button className="primaryAction" type="button" disabled={managerTransferBusy} onClick={acceptManagerOwnership}>
                <CheckCircle size={14} />
                {managerTransferBusy ? "Accepting transfer" : "Accept manager role"}
              </button> : null}
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Fee-recipient transfer" subtitle="Update the manager-fee beneficiary immediately" icon={<ReceiptText size={15} />} action={<span className="stateBadge muted">Immediate</span>}>
          <div className="operationFlow">
            <div className="roleCurrent"><span>Current recipient</span><strong>{shortAddress(vault.feeRecipient)}</strong></div>
            <label className="fieldLabel">New fee-recipient address</label>
            <input className={!feeTargetValid && feeTarget ? "invalid" : ""} value={feeTarget} onChange={(event) => setFeeTarget(event.target.value)} placeholder="0x..." disabled={!vault.enabled || !vault.connectedIsManager} />
            <p>Accrued fees are settled first. Future manager-fee shares are sent to the new recipient as soon as this transaction confirms.</p>
            {feeTransferError ? <div className="validationSummary danger" role="alert"><AlertTriangle size={15} /><div><strong>Fee-recipient transfer failed</strong><span>{feeTransferError}</span></div></div> : null}
            <TxStatus state={feeTransferState} />
            {vault.connectedIsManager ? <button className="primaryAction" type="button" disabled={!feeTargetValid || feeTransferBusy} onClick={updateFeeRecipient}>
              <ReceiptText size={14} />
              {feeTransferBusy ? "Confirming update" : "Update fee recipient"}
            </button> : null}
          </div>
        </SectionCard>

        <SectionCard
          title="Authorized executors"
          subtitle="Addresses permitted to submit constrained rebalance trades"
          icon={<KeyRound size={15} />}
          action={<span className="stateBadge muted">{vault.authorizedExecutors.length} active</span>}
        >
          <div className="operationFlow">
            {vault.authorizedExecutors.length ? (
              <div className="executorList">
                {vault.authorizedExecutors.map((executor) => (
                  <div className="executorRow" key={executor}>
                    <a href={`${robinhoodChainTestnet.blockExplorers.default.url}/address/${executor}`} target="_blank" rel="noreferrer" title="Open executor in explorer">
                      <code>{shortAddress(executor)}</code>
                      <ExternalLink size={11} />
                    </a>
                    {executor.toLowerCase() === vault.manager?.toLowerCase() ? <span className="stateBadge success">Manager</span> : null}
                    <button
                      className="iconOnly compact"
                      type="button"
                      title="Remove executor"
                      aria-label={`Remove executor ${executor}`}
                      disabled={!vault.connectedIsManager || executorBusy}
                      onClick={() => setExecutorAuthorization(executor, false)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="inlineEmptyState"><KeyRound size={16} /><div><strong>No authorized executors</strong><span>Add an executor before another constrained rebalance trade can be submitted.</span></div></div>
            )}
            <label className="fieldLabel">Executor address</label>
            <input
              className={!executorValid && executorTarget ? "invalid" : ""}
              value={executorTarget}
              onChange={(event) => setExecutorTarget(event.target.value)}
              placeholder="0x..."
              disabled={!vault.enabled || !vault.connectedIsManager || executorBusy}
            />
            <p>The manager is added automatically but may remove their own execution permission. Executors cannot change strategy, fees, ownership, recipients, adapters, or transfer assets out of the OTF.</p>
            {executorError ? <div className="validationSummary danger" role="alert"><AlertTriangle size={15} /><div><strong>Executor update failed</strong><span>{executorError}</span></div></div> : null}
            <TxStatus state={executorState} />
            {vault.connectedIsManager ? (
              <button className="primaryAction" type="button" disabled={!executorValid || executorBusy} onClick={() => setExecutorAuthorization(executorTarget, true)}>
                <Plus size={14} />
                {executorBusy ? "Confirming executor" : "Add executor"}
              </button>
            ) : null}
          </div>
        </SectionCard>
          </>
        ) : null}

        {activeOperation === "fees" ? (
        <SectionCard title="Manager fees" subtitle="Preview accrued OTF shares and withdraw them to the fee recipient" icon={<CircleDollarSign size={15} />} action={<span className={`stateBadge ${vault.feeState === 2 ? "danger" : vault.feeState === 1 ? "warning" : "success"}`}>{["Withdrawable", "Challenge active", "Challenge overdue"][vault.feeState] ?? "Unavailable"}</span>}>
          <div className="operationFlow">
            <PortfolioBandStatus vault={vault} context="fees" />
            <div className="accrualSummary">
              <div><span>Pending manager fees</span><strong>{pendingManagerFeeDisplay}</strong></div>
              <div><span>Manager fee</span><strong>{bpsToPercent(vault.managerFeeBps)} / yr</strong></div>
              <div><span>Effective protocol cut</span><strong>{bpsToPercent(vault.effectiveProtocolFeeShareBps)} of accrued fees</strong></div>
              <div><span>Historically forfeited</span><strong>{vault.forfeitedManagerFeeShares}</strong></div>
            </div>
            <p>Pending fees are calculated by simulating a withdrawal at the latest block. The protocol rebate uses the lesser of the live oracle-valued $OTF weight and the manager&apos;s active $OTF target allocation. If the live weight cannot be read safely, the normal protocol share applies. Changes to protocol rebate parameters take effect for this OTF when its fees are next checkpointed.</p>
            {feeAccrualError ? <div className="riskCallout danger"><AlertTriangle size={15} /><div><strong>Fee withdrawal failed</strong><span>{feeAccrualError}</span></div></div> : null}
            <TxStatus state={feeAccrualState} />
            <button
              className="secondaryAction"
              type="button"
              disabled={!connectedAddress || !vault.connectedIsManager || (vault.challengeActive && !vault.withinCompletionBands) || !pendingManagerFeeShares || feeAccrualState === "pending" || feeAccrualState === "submitted"}
              onClick={withdrawVaultFees}
            >
              <CircleDollarSign size={14} />
              Withdraw manager fees
            </button>
          </div>
        </SectionCard>
        ) : null}

        {activeOperation === "roles" ? (
        <SectionCard title="Manager permissions" subtitle="Capabilities constrained by the OTF contract" icon={<ShieldCheck size={15} />} action={<span className="stateBadge muted">Onchain</span>}>
          <div className="permissionList">
            <div><CheckCircle size={14} /><span><strong>May propose strategic targets</strong><small>Targets lock until the basket reaches its completion bands.</small></span></div>
            <div><CheckCircle size={14} /><span><strong>May authorize constrained executors</strong><small>{vault.authorizedExecutors.length} currently authorized; all are cleared on manager transfer.</small></span></div>
            <div><CheckCircle size={14} /><span><strong>May execute partial maintenance trades</strong><small>Every batch must reduce target deviation and satisfy oracle, adapter, slippage, and NAV-loss limits.</small></span></div>
            <div><CheckCircle size={14} /><span><strong>May propose targets with a rationale</strong><small>The rationale becomes permanent only when those targets activate.</small></span></div>
            <div><CheckCircle size={14} /><span><strong>May update weight bands</strong><small>New completion and challenge values must satisfy the factory&apos;s current policy.</small></span></div>
            <div><XCircle size={14} /><span><strong>Cannot withdraw portfolio assets</strong><small>No arbitrary manager-call or asset-transfer path exists.</small></span></div>
            <div><XCircle size={14} /><span><strong>Cannot shorten the change unlock</strong><small>The configured delay is permanently immutable.</small></span></div>
          </div>
        </SectionCard>
        ) : null}
      </div> : null}
      </>}

      <RebalanceHistoryPanel vault={vault} />

      {!vault.sunset ? (
        <SectionCard
          title="Danger zone"
          subtitle="Permanent actions that affect every OTF holder"
          icon={<AlertTriangle size={15} />}
        >
          <div className="dangerZoneContent">
            <div>
              <strong>Sunset this OTF</strong>
              <p>Permanently stop deposits, fee accrual, strategy changes, and rebalance operations. Proportional redemptions and share transfers remain available.</p>
            </div>
            <button
              ref={sunsetButtonRef}
              className="dangerAction"
              type="button"
              disabled={!vault.connectedIsManager || sunsetBusy}
              onClick={() => setSunsetConfirmationOpen(true)}
            >
              <Sun size={14} />
              {sunsetBusy ? "Sunsetting OTF" : "Sunset OTF"}
            </button>
          </div>
        </SectionCard>
      ) : null}
    </div>
  );
}
