"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  managedOtfVaultAbi,
  otfEntryRouterAbi,
  otfFactoryAbi,
  otfV3MarketRegistryAbi,
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
  XCircle,
  Zap,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { encodeAbiParameters, encodePacked, formatUnits, isAddress, parseEventLogs, parseUnits, zeroAddress } from "viem";
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
import { robinhoodTestnetAddresses, robinhoodTestnetV3Venue } from "@/lib/deployment";
import supportedAssetCatalog from "@/config/supported-assets.json";
import {
  formatCooldown,
  formatRelativeAvailability,
  formatTimestamp,
  progressThroughCooldown,
} from "@/lib/time";
import { LandingPage } from "./LandingPage";

type ContractValue =
  | string
  | number
  | bigint
  | boolean
  | readonly string[]
  | readonly number[]
  | readonly bigint[]
  | undefined;

type ReadResult = readonly { result?: ContractValue }[];
type TxState = "idle" | "simulating" | "ready" | "pending" | "submitted" | "confirmed" | "reverted";
type AppearancePreference = "default" | "light" | "dark";
type PositionTradeReceipt = {
  action: "deposit" | "redeem";
  detail: string;
  transactionHash: `0x${string}`;
};
export type AppView = "landing" | "detail" | "vaults" | "create" | "created" | "manage" | "deposits" | "rwas";
type DataMode = "live" | "empty" | "unavailable";

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
  address: string;
  targetWeight: number;
  initialAmount: string;
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

type VaultSummary = {
  address: `0x${string}`;
  name: string;
  symbol: string;
  manager?: string;
  creator?: string;
  creatorFeeBps?: number;
  assetCount: number;
  navValue?: bigint;
  nav?: string;
  navPerShare?: string;
  navPerShareValue?: bigint;
};

type VaultView = {
  name: string;
  symbol: string;
  address?: `0x${string}`;
  manager?: string;
  feeRecipient?: string;
  creatorFeeBps: number;
  protocolFeeShareBps: number;
  totalSupply: string;
  cooldownSeconds: number;
  lastStrategyCompletion?: number;
  nextStrategyChange?: number;
  cooldownProgress: number;
  allocations: Allocation[];
  maxTurnoverBps: number;
  maxNavLossBps: number;
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
  maxSingleAssetWeightBps: number;
  minNonZeroAssetWeightBps: number;
  maxOracleStaleness: number;
  maxAssetCount: number;
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
};

const navTabs = ["OTFs", "RWAs", "Liquidity"];

const testnetCreateAssets = supportedAssetCatalog.assets.flatMap((asset) => {
  const deployment = asset.deployments.find(({ chainId }) => chainId === robinhoodChainTestnet.id);
  return deployment ? [{
    symbol: asset.symbol,
    name: asset.name,
    address: deployment.contractAddress,
    logoUrl: asset.logoUrl,
  }] : [];
});

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
    name: "accrueFees",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "feeShares", type: "uint256" }],
  },
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

const factoryDependencyAbi = [
  {
    type: "function",
    name: "assetRegistry",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "oracleRegistry",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const protocolAssetReadAbi = [
  {
    type: "function",
    name: "priceFeedFor",
    stateMutability: "view",
    inputs: [{ name: "asset", type: "address" }],
    outputs: [{ name: "feed", type: "address" }],
  },
] as const;

const vaultCreatedEventAbi = [
  {
    type: "event",
    name: "VaultCreated",
    inputs: [
      { indexed: true, name: "creator", type: "address" },
      { indexed: true, name: "vault", type: "address" },
      { indexed: true, name: "nonce", type: "uint256" },
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
] as const;

const uniswapV3PoolAbi = [
  {
    type: "function",
    name: "liquidity",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint128" }],
  },
] as const;

const uniswapV3QuoterAbi = [
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

const allocationTones = ["teal", "green", "gold", "blue", "rose", "violet"];
function configuredFactoryAddress(): `0x${string}` | undefined {
  return robinhoodTestnetAddresses.factory;
}

function configuredEntryRouterAddress(): `0x${string}` | undefined {
  return robinhoodTestnetAddresses.entryRouter;
}

function configuredEntryAdapterAddress(): `0x${string}` | undefined {
  return robinhoodTestnetAddresses.uniswapV3Adapter;
}

function configuredSettlementTokenAddress(): `0x${string}` | undefined {
  return robinhoodTestnetAddresses.usdg;
}

function configuredConstituentFee(): number {
  return robinhoodTestnetV3Venue.constituentFee ?? 3000;
}

function configuredConstituentPool(asset: string): `0x${string}` | undefined {
  return robinhoodTestnetV3Venue.constituentPools.find(
    (record) => record.asset.toLowerCase() === asset.toLowerCase(),
  )?.pool;
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

function catalogAssetForAddress(address: string) {
  return testnetCreateAssets.find(
    (asset) => asset.address.toLowerCase() === address.toLowerCase(),
  );
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

function bpsToAllocationPercent(value: number): string {
  return `${(value / 100).toFixed(1)}%`;
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
): Allocation[] {
  if (!assets?.length || !weights?.length) return [];

  return assets.map((address, index) => {
    const weight = Number(weights[index] ?? 0);
    const catalogAsset = catalogAssetForAddress(address);
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

function percentToBps(value: string | number): number {
  return Math.round(Number(value || 0) * 100);
}

function daysToSeconds(value: string | number): number {
  return Math.round(Number(value || 0) * 86_400);
}

function errorMessage(error: unknown): string {
  const serialized = (() => {
    try {
      return JSON.stringify(error, (_, value) => typeof value === "bigint" ? value.toString() : value);
    } catch {
      return String(error);
    }
  })();
  if (serialized.includes("0xf4059071")) {
    return "A seed-token transfer was rejected. Approve every selected token for OTF creation and confirm that your balance covers each seed amount.";
  }
  if (serialized.includes("0x3cb104db")) {
    return "A selected token is not enabled in the protocol asset registry.";
  }
  if (serialized.includes("0x7d3ae914")) {
    return "A selected token does not have a configured protocol price feed.";
  }
  if (serialized.includes("0xdab4498d")) {
    return "A selected oracle price is older than the configured maximum age. The testnet deployment may still be using a legacy mock feed.";
  }
  if (serialized.includes("0xc705736")) {
    return "The pool quote loses more oracle value than this OTF allows. Choose a smaller trade size and try again.";
  }
  if (error && typeof error === "object" && "shortMessage" in error) {
    return String((error as { shortMessage?: unknown }).shortMessage);
  }
  if (error instanceof Error) return error.message;
  return "The wallet request could not be completed.";
}

const viewPaths: Record<AppView, string> = {
  landing: "/",
  vaults: "/otfs",
  detail: "/otfs/unconfigured",
  create: "/create",
  created: "/otfs/unconfigured/created",
  manage: "/otfs/unconfigured/manage",
  deposits: "/wallet",
  rwas: "/rwas",
};

function viewFromPathname(pathname: string): AppView {
  if (pathname === "/create") return "create";
  if (pathname === "/wallet") return "deposits";
  if (pathname === "/rwas") return "rwas";
  if (pathname.endsWith("/created")) return "created";
  if (pathname.endsWith("/manage")) return "manage";
  if (pathname.startsWith("/otfs/")) return "detail";
  if (pathname === "/otfs") return "vaults";
  return "landing";
}

export function RebalanceCooldownPanel({ initialView = "landing" }: { initialView?: AppView }) {
  const factoryAddress = configuredFactoryAddress();
  const { address: connectedAddress } = useAccount();
  const chainId = useChainId();
  const isTestnet = chainId === robinhoodChainTestnet.id;
  const [view, setView] = useState<AppView>(initialView);
  const [selectedVaultAddress, setSelectedVaultAddress] = useState<`0x${string}` | undefined>(
    () => typeof window === "undefined" ? undefined : vaultAddressFromPathname(window.location.pathname),
  );
  const [createdTxHash, setCreatedTxHash] = useState<`0x${string}` | undefined>(
    transactionHashFromLocation,
  );
  const [lastReadAt, setLastReadAt] = useState<number>();

  const {
    data: factoryVaultData,
    error: factoryError,
    isLoading: factoryLoading,
  } = useReadContract({
    address: factoryAddress,
    abi: otfFactoryAbi,
    functionName: "allVaults",
    chainId: robinhoodChainTestnet.id,
    query: {
      enabled: Boolean(factoryAddress) && isTestnet,
      refetchInterval: 12_000,
    },
  });

  const { data: catalogOracleRegistryAddress } = useReadContract({
    address: factoryAddress,
    abi: factoryDependencyAbi,
    functionName: "oracleRegistry",
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(factoryAddress) && isTestnet },
  });
  const catalogFeedContracts = catalogOracleRegistryAddress
    ? testnetCreateAssets.map((asset) => ({
        address: catalogOracleRegistryAddress as `0x${string}`,
        abi: protocolAssetReadAbi,
        functionName: "priceFeedFor" as const,
        args: [asset.address as `0x${string}`],
        chainId: robinhoodChainTestnet.id,
      }))
    : undefined;
  const { data: catalogFeedResults } = useReadContracts({
    contracts: catalogFeedContracts,
    query: { enabled: Boolean(catalogFeedContracts) && isTestnet },
  });
  const catalogFeedAddresses = testnetCreateAssets.map((_, index) => {
    const value = catalogFeedResults?.[index]?.result;
    return typeof value === "string" && isAddress(value) ? value : undefined;
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
      ? (factoryVaultData ?? []).filter(
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
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "creatorFeeBpsPerYear" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "protocolFeeShareBps" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "totalSupply" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "assets" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "targetWeightsBps" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "maxTurnoverBps" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "maxNavLossBps" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "maxWeightDeviationBps" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "maxAssetCount" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "STRATEGY_CHANGE_COOLDOWN" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "maxSingleAssetWeightBps" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "minNonZeroAssetWeightBps" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "maxOracleStaleness" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "totalAssetsValue" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "navPerShare" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "currentWeightsBps" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "challengeWeightDeviationBps" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "challengeGracePeriod" },
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
        { address, abi: managedOtfVaultAbi, functionName: "creatorFeeBpsPerYear" },
        { address, abi: managedOtfVaultAbi, functionName: "assets" },
        { address, abi: managedOtfVaultAbi, functionName: "totalAssetsValue" },
        { address, abi: managedOtfVaultAbi, functionName: "navPerShare" },
        {
          address: factoryAddress,
          abi: otfFactoryAbi,
          functionName: "creatorOf",
          args: [address],
        },
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
      const creatorFee = resultAt<number>(directoryResults, offset + 3);
      const vaultAssets = resultAt<readonly string[]>(directoryResults, offset + 4);
      const totalValue = resultAt<bigint>(directoryResults, offset + 5);
      const shareValue = resultAt<bigint>(directoryResults, offset + 6);
      const creatorValue = resultAt<string>(directoryResults, offset + 7);
      return {
        address,
        name: name || shortAddress(address),
        symbol: symbol || "OTF",
        manager: managerValue && isAddress(managerValue) ? managerValue : undefined,
        creator: creatorValue && isAddress(creatorValue) ? creatorValue : undefined,
        creatorFeeBps: creatorFee,
        assetCount: vaultAssets?.length ?? 0,
        navValue: totalValue,
        nav: formatUsd18(totalValue),
        navPerShare: formatUsd18(shareValue),
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
  const creatorFeeBps = resultAt<number>(results, 4) ?? 0;
  const protocolFeeShareBps = resultAt<number>(results, 5) ?? 0;
  const totalSupply = resultAt<bigint>(results, 6);
  const assets = resultAt<readonly string[]>(results, 7);
  const targetWeights = resultAt<readonly number[] | readonly bigint[]>(results, 8);
  const maxTurnoverBps = resultAt<number>(results, 9) ?? 0;
  const maxNavLossBps = resultAt<number>(results, 10) ?? 0;
  const maxWeightDeviationBps = resultAt<number>(results, 11) ?? 0;
  const maxAssetCount = resultAt<number>(results, 12) ?? 0;
  const cooldownSeconds = Number(resultAt<bigint>(results, 13) ?? BigInt(14 * 86_400));
  const maxSingleAssetWeightBps = resultAt<number>(results, 14) ?? 0;
  const minNonZeroAssetWeightBps = resultAt<number>(results, 15) ?? 0;
  const maxOracleStaleness = resultAt<number>(results, 16) ?? 0;
  const totalAssetsValue = resultAt<bigint>(results, 17);
  const navPerShareValue = resultAt<bigint>(results, 18);
  const currentWeights = resultAt<readonly number[] | readonly bigint[]>(results, 19);
  const challengeWeightDeviationBps = resultAt<number>(results, 20) ?? 0;
  const challengeGracePeriod = resultAt<number>(results, 21) ?? 0;
  const withinCompletionBands = Boolean(resultAt<boolean>(results, 22));
  const strategicRebalanceActive = Boolean(resultAt<boolean>(results, 23));
  const challengeActive = Boolean(resultAt<boolean>(results, 24));
  const challengeStartedAt = resultAt<bigint>(results, 25)
    ? Number(resultAt<bigint>(results, 25))
    : undefined;
  const challengeDeadline = resultAt<bigint>(results, 26)
    ? Number(resultAt<bigint>(results, 26))
    : undefined;
  const challengeTimeRemaining = Number(resultAt<bigint>(results, 27) ?? 0n);
  const feeState = Number(resultAt<number>(results, 28) ?? 0);
  const escrowedManagerFeeSharesValue = resultAt<bigint>(results, 29);
  const forfeitedManagerFeeSharesValue = resultAt<bigint>(results, 30);
  const claimableChallengeRewardValue = resultAt<bigint>(results, 31);
  const lastStrategyCompletion = resultAt<bigint>(results, 32)
    ? Number(resultAt<bigint>(results, 32))
    : undefined;
  const canProposeStrategy = Boolean(resultAt<boolean>(results, 33));
  const authorizedExecutors = resultAt<readonly string[]>(results, 34) ?? [];
  const withinChallengeBands = Boolean(resultAt<boolean>(results, 35));
  const strategyProposalPending = Boolean(resultAt<boolean>(results, 36));
  const pendingStrategyActivationTime = resultAt<bigint>(results, 37)
    ? Number(resultAt<bigint>(results, 37))
    : undefined;
  const nextStrategyChange = resultAt<bigint>(results, 38)
    ? Number(resultAt<bigint>(results, 38))
    : undefined;
  const challengeCaller = resultAt<string>(results, 39);
  const allocations = normalizeAllocations(assets, targetWeights, currentWeights);
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
    creatorFeeBps,
    protocolFeeShareBps,
    totalSupply: supplyDisplay,
    cooldownSeconds,
    lastStrategyCompletion,
    nextStrategyChange,
    cooldownProgress,
    allocations,
    maxTurnoverBps,
    maxNavLossBps,
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
    maxSingleAssetWeightBps,
    minNonZeroAssetWeightBps,
    maxOracleStaleness,
    maxAssetCount,
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
  };
  const activeTab = view === "rwas" ? "RWAs" : "OTFs";

  useEffect(() => {
    if (dataMode === "live" && data) {
      setLastReadAt(Math.floor(Date.now() / 1_000));
    }
  }, [data, dataMode]);

  useEffect(() => {
    const syncViewToHistory = () => {
      setView(viewFromPathname(window.location.pathname));
      setSelectedVaultAddress(vaultAddressFromPathname(window.location.pathname));
      setCreatedTxHash(transactionHashFromLocation());
    };
    window.addEventListener("popstate", syncViewToHistory);
    return () => window.removeEventListener("popstate", syncViewToHistory);
  }, []);

  useEffect(() => {
    if (!isTestnet && (view === "detail" || view === "manage")) {
      window.history.replaceState({}, "", viewPaths.vaults);
      setView("vaults");
    }
  }, [isTestnet, view]);

  function openView(nextView: AppView, address?: `0x${string}`) {
    const nextVaultAddress = address ?? vaultAddress;
    if (address) setSelectedVaultAddress(address);
    const otfSlug = nextVaultAddress ?? "unconfigured";
    const nextPath = nextView === "detail"
      ? `/otfs/${otfSlug}`
      : nextView === "created"
        ? `/otfs/${otfSlug}/created`
      : nextView === "manage"
        ? `/otfs/${otfSlug}/manage`
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
    if (tab === "RWAs") openView("rwas");
    else if (tab === "Liquidity") window.location.assign("/liquidity");
    else openView("vaults");
  }

  if (view === "landing") {
    return (
      <LandingPage
        onCreate={() => openView("create")}
        onEnter={() => openView("vaults")}
      />
    );
  }

  return (
    <div className="otfAppShell">
      <TopNav
        activeTab={activeTab}
        depositsActive={view === "deposits"}
        onHome={() => openView("landing")}
        onTabChange={changeView}
        onOpenDeposits={() => openView("deposits")}
      />

      <main className="dashboardMain">
        {view === "detail" && isTestnet && vault.dataMode === "live" ? (
          <>
            <VaultHeader
              vault={vault}
              canManage={vault.connectedIsManager}
              onBack={() => openView("vaults")}
              onManage={() => openView("manage")}
            />
            <DataProvenance vault={vault} />
            <VaultMetrics vault={vault} />

            <div className="dashboardGrid">
              <div className="primaryColumn">
                <PortfolioAllocation vault={vault} allocations={allocations} oraclePrices={catalogOraclePrices} onRefresh={refetchVaultData} />
                <UserActions vault={vault} />
              </div>

              <aside className="sideColumn">
                <StrategyHistoryModule vault={vault} />
                <RebalanceCooldown vault={vault} />
              </aside>

              <div className="dashboardSafety">
                <SafetyLimits vault={vault} onRefresh={refetchVaultData} />
              </div>
            </div>
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
            connectedAddress={connectedAddress}
            isTestnet={isTestnet}
            aumLoading={factoryLoading || directoryLoading}
            onManageVault={(address) => openView("manage", address)}
            onOpenVault={(address) => openView("detail", address)}
            onCreateVault={() => openView("create")}
          />
        ) : null}

        {view === "create" ? (
          <CreateVaultView
            connectedAddress={connectedAddress}
            isTestnet={isTestnet}
            oraclePrices={catalogOraclePrices}
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
            oraclePrices={catalogOraclePrices}
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
          />
        ) : null}

        {view === "rwas" ? (
          <RwaCatalogView isTestnet={isTestnet} oraclePrices={catalogOraclePrices} />
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
          <div className="otfLogo">OTF</div>
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
                        <span>{value[0].toUpperCase() + value.slice(1)}</span>
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
  onBack,
  onManage,
}: {
  vault: VaultView;
  canManage: boolean;
  onBack: () => void;
  onManage: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);

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
            <div className="vaultMonogram">{symbolMonogram(vault.symbol)}</div>
            <div>
              <div className="titleLine">
                <h1>{vault.name}</h1>
                <span className="symbolBadge">{vault.symbol}</span>
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
  const registry = configuredV3MarketRegistryAddress();
  const { data: officialPoolResult, isLoading: officialPoolLoading } = useReadContract({
    address: registry,
    abi: otfV3MarketRegistryAbi,
    functionName: "officialPool",
    args: vault.address ? [vault.address] : undefined,
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(registry && vault.address) },
  });
  const officialPool = officialPoolResult && officialPoolResult !== zeroAddress
    ? officialPoolResult as `0x${string}`
    : undefined;
  const poolUsesSynthra = robinhoodTestnetV3Venue.provider === "synthra";
  const poolVenueUrl = officialPool
    ? poolUsesSynthra && vault.address
      ? `/liquidity?vault=${vault.address}`
      : `https://app.uniswap.org/explore/pools/ethereum/${officialPool}`
    : undefined;
  const portfolioState = vault.challengeActive
    ? "Challenge active"
    : vault.strategicRebalanceActive
      ? "Target in progress"
      : vault.withinCompletionBands
        ? "Within bands"
        : "Outside completion";
  return (
    <div className="metricGrid">
      <MetricCard label="NAV" value={vault.nav ?? "Oracle read failed"} tone={vault.nav ? "success" : "neutral"} />
      <MetricCard label="NAV / Share" value={vault.navPerShare ?? "Oracle read failed"} />
      <MetricCard label="Manager Fee" value={`${bpsToPercent(vault.creatorFeeBps)} / yr`} tone={vault.feeState === 2 ? "danger" : vault.feeState === 1 ? "warning" : "neutral"} />
      <MetricCard
        label="Liquidity Pool"
        value={officialPoolLoading ? "Resolving..." : shortAddress(officialPool)}
        href={poolVenueUrl}
        external={!poolUsesSynthra}
        linkLabel={officialPool
          ? poolUsesSynthra
            ? `Add or remove liquidity in pool ${officialPool}`
            : `Open pool ${officialPool} on Uniswap`
          : undefined}
      />
      <MetricCard label="Portfolio Status" value={portfolioState} tone={vault.challengeActive ? "danger" : vault.withinCompletionBands ? "success" : "warning"} />
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
      ) : <strong>{value}</strong>}
      {sub ? <span>{sub}</span> : null}
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
    : vault.challengeActive
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

function PortfolioAllocation({
  vault,
  allocations,
  oraclePrices,
  onRefresh,
}: {
  vault: VaultView;
  allocations: Allocation[];
  oraclePrices: CatalogOraclePrices;
  onRefresh: () => Promise<unknown>;
}) {
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

  return (
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
                  <td className="mobileSecondaryAssetDatum" data-label="Price">{oraclePrices[asset.address.toLowerCase()]?.display ?? "Loading"}</td>
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

      <StrategyChallenge vault={vault} onRefresh={onRefresh} />
    </SectionCard>
  );
}

function StrategyHistoryModule({ vault }: { vault: VaultView }) {
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
  const [activeAction, setActiveAction] = useState<"deposit" | "redeem">("deposit");
  const [settlementMode, setSettlementMode] = useState<"usdg" | "rwas">("usdg");
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
  const entryRouterAddress = configuredEntryRouterAddress();
  const entryAdapterAddress = configuredEntryAdapterAddress();
  const v3MarketRegistryAddress = configuredV3MarketRegistryAddress();
  const uniswapV3SwapRouterAddress = configuredUniswapV3SwapRouterAddress();
  const uniswapV3QuoterAddress = configuredUniswapV3QuoterAddress();
  const configuredSettlementToken = configuredSettlementTokenAddress();
  const constituentFee = configuredConstituentFee();
  const depositsPausedForAssetRemoval = vault.allocations.some(
    (asset) => asset.targetWeightBps === 0,
  );
  const entryContractsConfigured = Boolean(
    entryRouterAddress && entryAdapterAddress && uniswapV3QuoterAddress,
  );
  const parsedSlippage = Number(maxSlippage);
  const slippageBps = Number.isFinite(parsedSlippage)
    ? Math.round(parsedSlippage * 100)
    : 0;
  const slippageValid = slippageBps >= 1 && slippageBps <= 2_000;
  const isUsdgMode = settlementMode === "usdg";
  let normalizedUsdgAmount: bigint | undefined;
  try {
    normalizedUsdgAmount = isUsdgMode && activeAction === "deposit" && Number(tradeAmount) > 0
      ? parseUnits(tradeAmount, 18)
      : undefined;
  } catch {
    normalizedUsdgAmount = undefined;
  }
  const navEstimatedShares = normalizedUsdgAmount && vault.navPerShareValue
    ? normalizedUsdgAmount * 10n ** 18n / vault.navPerShareValue
    : undefined;
  let navRequestedEntryShares: bigint | undefined;
  if (activeAction === "deposit" && navEstimatedShares && slippageValid) {
    navRequestedEntryShares = navEstimatedShares * 10_000n / BigInt(10_000 + slippageBps);
  }
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
    requestedDirectMintShares = !isUsdgMode && activeAction === "deposit" && Number(tradeAmount) > 0
      ? parseUnits(tradeAmount, 18)
      : undefined;
  } catch {
    requestedDirectMintShares = undefined;
  }
  const entrySlippageBps = slippageBps;
  const entrySlippageValid = slippageValid;
  const redeemSlippageBps = slippageBps;
  const redeemSlippageValid = slippageValid;
  const { data: settlementTokenAddress } = useReadContract({
    address: entryRouterAddress,
    abi: otfEntryRouterAbi,
    functionName: "settlementToken",
    chainId: robinhoodChainTestnet.id,
    query: { enabled: entryContractsConfigured && isLive },
  });
  const settlementToken = typeof settlementTokenAddress === "string" && isAddress(settlementTokenAddress)
    ? settlementTokenAddress
    : configuredSettlementToken;
  const constituentLiquidityContracts = vault.allocations.flatMap((asset) => {
    const pool = configuredConstituentPool(asset.address);
    return pool ? [{
      address: pool,
      abi: uniswapV3PoolAbi,
      functionName: "liquidity" as const,
      chainId: robinhoodChainTestnet.id,
    }] : [];
  });
  const {
    data: constituentLiquidityResults,
    isLoading: constituentLiquidityLoading,
  } = useReadContracts({
    contracts: constituentLiquidityContracts,
    query: {
      enabled: constituentLiquidityContracts.length > 0,
      refetchOnWindowFocus: true,
    },
  });
  let constituentLiquidityIndex = 0;
  const constituentPoolStates = vault.allocations.map((asset) => {
    const pool = configuredConstituentPool(asset.address);
    const result = pool ? constituentLiquidityResults?.[constituentLiquidityIndex++] : undefined;
    return {
      asset: asset.address,
      pool,
      liquidity: result?.result as bigint | undefined,
      readFailed: result?.status === "failure",
    };
  });
  const constituentPoolsConfigured = Boolean(
    settlementToken && vault.allocations.every((asset) =>
      asset.address.toLowerCase() === settlementToken.toLowerCase()
        || Boolean(configuredConstituentPool(asset.address)),
    ),
  );
  const constituentPoolsReady = Boolean(
    settlementToken && vault.allocations.every((asset) => {
      if (asset.address.toLowerCase() === settlementToken.toLowerCase()) return true;
      const state = constituentPoolStates.find(
        (item) => item.asset.toLowerCase() === asset.address.toLowerCase(),
      );
      return state?.pool && state.liquidity !== undefined && state.liquidity > 0n && !state.readFailed;
    }),
  );
  const constituentLiquidityReadFailed = constituentPoolStates.some(
    (state) => state.pool && state.readFailed,
  );
  const emptyConstituentPoolSymbols = constituentPoolStates.flatMap((state) => {
    if (!state.pool || state.liquidity !== 0n) return [];
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
  let requestedUsdgAmount: bigint | undefined;
  try {
    requestedUsdgAmount = isUsdgMode && activeAction === "deposit" && Number(tradeAmount) > 0
      ? parseUnits(tradeAmount, settlementDecimals)
      : undefined;
  } catch {
    requestedUsdgAmount = undefined;
  }
  const { data: entryAdapterApproved } = useReadContract({
    address: entryRouterAddress,
    abi: otfEntryRouterAbi,
    functionName: "isEntryAdapterApproved",
    args: entryAdapterAddress ? [entryAdapterAddress] : undefined,
    chainId: robinhoodChainTestnet.id,
    query: { enabled: entryContractsConfigured && isLive },
  });
  const canQuoteEntry = Boolean(
    isLive &&
    !depositsPausedForAssetRemoval &&
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
  const entryQuoteContracts = canQuoteEntry && constituentPoolsReady && previewEntryAmounts && settlementToken && uniswapV3QuoterAddress
    ? vault.allocations.flatMap((asset, index) => {
        if (asset.address.toLowerCase() === settlementToken.toLowerCase()) return [];
        const amountOut = previewEntryAmounts[index];
        if (amountOut === undefined || amountOut === 0n) return [];
        return [{
          address: uniswapV3QuoterAddress,
          abi: uniswapV3QuoterAbi,
          functionName: "quoteExactOutputSingle" as const,
          args: [{
            tokenIn: settlementToken,
            tokenOut: asset.address as `0x${string}`,
            amountOut,
            fee: constituentFee,
            sqrtPriceLimitX96: 0n,
          }],
          chainId: robinhoodChainTestnet.id,
        }];
      })
    : [];
  const {
    data: entryQuoteResults,
    isLoading: entryQuotesLoading,
    refetch: refetchEntryQuotes,
  } = useReadContracts({
    contracts: entryQuoteContracts,
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
      if (isSettlement) {
        quotedSettlement = requiredAmount;
      } else if (requiredAmount !== undefined && requiredAmount > 0n) {
        const result = quoteResults?.[quoteIndex];
        quoteIndex += 1;
        const quote = result?.result as readonly [bigint, bigint, number, bigint] | undefined;
        quotedSettlement = quote?.[0];
        quoteFailed = result?.status === "failure";
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
    requestedUsdgAmount !== undefined &&
    initialMaximumSettlementTotal !== undefined &&
    initialMaximumSettlementTotal > requestedUsdgAmount
      ? navRequestedEntryShares * requestedUsdgAmount / initialMaximumSettlementTotal
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
  const adjustedEntryQuoteContracts = canQuoteAdjustedEntry && constituentPoolsReady && adjustedPreviewEntryAmounts && settlementToken && uniswapV3QuoterAddress
    ? vault.allocations.flatMap((asset, index) => {
        if (asset.address.toLowerCase() === settlementToken.toLowerCase()) return [];
        const amountOut = adjustedPreviewEntryAmounts[index];
        if (amountOut === undefined || amountOut === 0n) return [];
        return [{
          address: uniswapV3QuoterAddress,
          abi: uniswapV3QuoterAbi,
          functionName: "quoteExactOutputSingle" as const,
          args: [{
            tokenIn: settlementToken,
            tokenOut: asset.address as `0x${string}`,
            amountOut,
            fee: constituentFee,
            sqrtPriceLimitX96: 0n,
          }],
          chainId: robinhoodChainTestnet.id,
        }];
      })
    : [];
  const {
    data: adjustedEntryQuoteResults,
    isLoading: adjustedEntryQuotesLoading,
  } = useReadContracts({
    contracts: adjustedEntryQuoteContracts,
    query: { enabled: adjustedEntryQuoteContracts.length > 0 },
  });
  const requestedEntryShares = adjustedEntryShares ?? navRequestedEntryShares;
  const finalPreviewEntryAmounts = adjustedEntryShares
    ? adjustedPreviewEntryAmounts
    : previewEntryAmounts;
  const finalEntryQuoteResults = adjustedEntryShares
    ? adjustedEntryQuoteResults
    : entryQuoteResults;
  const finalPreviewEntryLoading = adjustedEntryShares
    ? adjustedPreviewEntryLoading
    : previewEntryLoading;
  const finalEntryQuotesLoading = adjustedEntryShares
    ? adjustedEntryQuotesLoading
    : entryQuotesLoading;
  const finalPreviewEntryError = adjustedEntryShares
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
  const redeemQuoteContracts = previewRedeemAmounts && settlementToken && constituentPoolsReady && uniswapV3QuoterAddress && redeemSlippageValid
    ? vault.allocations.flatMap((asset, index) => {
        if (asset.address.toLowerCase() === settlementToken.toLowerCase()) return [];
        const amountIn = previewRedeemAmounts[index];
        if (amountIn === undefined || amountIn === 0n) return [];
        return [{
          address: uniswapV3QuoterAddress,
          abi: uniswapV3QuoterAbi,
          functionName: "quoteExactInputSingle" as const,
          args: [{
            tokenIn: asset.address as `0x${string}`,
            tokenOut: settlementToken,
            amountIn,
            fee: constituentFee,
            sqrtPriceLimitX96: 0n,
          }],
          chainId: robinhoodChainTestnet.id,
        }];
      })
    : [];
  const {
    data: redeemQuoteResults,
    isLoading: redeemQuotesLoading,
    refetch: refetchRedeemQuotes,
  } = useReadContracts({
    contracts: redeemQuoteContracts,
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
        !isUsdgMode && activeAction === "deposit" && requestedDirectMintShares && isLive,
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
  const entryQuotesFailed = entryLegs.some((leg) => leg.quoteFailed);
  const entryQuoteReady = Boolean(
    requestedEntryShares &&
    finalPreviewEntryAmounts?.length === vault.allocations.length &&
    entryLegs.every((leg) =>
      leg.requiredAmount !== undefined &&
      leg.quotedSettlement !== undefined &&
      leg.maximumSettlement !== undefined,
    ),
  );
  const maximumSettlementTotal = entryQuoteReady
    ? entryLegs.reduce(
        (sum, leg) => sum + (leg.isSettlement ? leg.requiredAmount ?? 0n : leg.maximumSettlement ?? 0n),
        0n,
      )
    : undefined;
  const settlementBalance = entryAuthorizationResults?.[0]?.result as bigint | undefined;
  const settlementAllowance = entryAuthorizationResults?.[1]?.result as bigint | undefined;
  const { data: officialPoolResult, isLoading: officialPoolLoading } = useReadContract({
    address: v3MarketRegistryAddress,
    abi: otfV3MarketRegistryAbi,
    functionName: "officialPool",
    args: vault.address ? [vault.address] : undefined,
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(v3MarketRegistryAddress && vault.address) },
  });
  const marketPool = officialPoolResult && officialPoolResult !== zeroAddress
    ? officialPoolResult as `0x${string}`
    : undefined;
  const { data: marketLiquidity, isLoading: marketLiquidityLoading } = useReadContract({
    address: marketPool,
    abi: uniswapV3PoolAbi,
    functionName: "liquidity",
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(marketPool) },
  });
  const marketLiquidityReady = Boolean(marketPool && typeof marketLiquidity === "bigint" && marketLiquidity > 0n);
  const marketPoolChecking = Boolean(v3MarketRegistryAddress && vault.address) && (
    officialPoolLoading || (Boolean(marketPool) && marketLiquidityLoading)
  );
  const marketInputAmount = isUsdgMode
    ? activeAction === "deposit" ? requestedUsdgAmount : requestedRedeemShares
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
    args: marketInputAmount && marketInputToken && marketOutputToken
      ? [{
          tokenIn: marketInputToken,
          tokenOut: marketOutputToken,
          amountIn: marketInputAmount,
          fee: 500,
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
    marketLiquidityReady && uniswapV3QuoterAddress && uniswapV3SwapRouterAddress,
  );
  const entryBalanceSufficient = maximumSettlementTotal !== undefined &&
    settlementBalance !== undefined && settlementBalance >= maximumSettlementTotal;
  const entryWithinBudget = maximumSettlementTotal !== undefined && requestedUsdgAmount !== undefined &&
    maximumSettlementTotal <= requestedUsdgAmount;
  const entryAllowanceSufficient = maximumSettlementTotal !== undefined &&
    settlementAllowance !== undefined && settlementAllowance >= maximumSettlementTotal;
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
    if (isSettlement) {
      quotedSettlement = amountIn;
    } else if (amountIn !== undefined && amountIn > 0n) {
      const result = redeemQuoteResults?.[redeemQuoteIndex];
      redeemQuoteIndex += 1;
      const quote = result?.result as readonly [bigint, bigint, number, bigint] | undefined;
      quotedSettlement = quote?.[0];
      quoteFailed = result?.status === "failure";
    } else if (amountIn === 0n) {
      quotedSettlement = 0n;
    }
    const minimumSettlement = quotedSettlement !== undefined && !isSettlement
      ? quotedSettlement * BigInt(10_000 - redeemSlippageBps) / 10_000n
      : isSettlement ? 0n : undefined;
    return { ...asset, amountIn, isSettlement, quotedSettlement, minimumSettlement, quoteFailed };
  });
  const redeemQuotesFailed = redeemLegs.some((leg) => leg.quoteFailed);
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
  const redeemBusy = redeemState === "pending" || redeemState === "submitted";
  const marketBusy = marketState === "pending" || marketState === "submitted";
  const inputTokenSymbol = activeAction === "deposit" && isUsdgMode ? "USDG" : vault.symbol;
  const inputTokenDecimals = activeAction === "deposit" && isUsdgMode ? settlementDecimals : 18;
  const walletInputBalance = activeAction === "deposit"
    ? isUsdgMode ? settlementBalance : undefined
    : redeemShareBalance;
  const walletInputBalanceLoading = activeAction === "deposit"
    ? isUsdgMode ? entryAuthorizationLoading : basketAuthorizationLoading
    : redeemAuthorizationLoading;
  const walletInputBalanceLabel = !connectedAddress
    ? "Connect wallet"
    : walletInputBalanceLoading
      ? "Checking..."
      : walletInputBalance === undefined
        ? !isUsdgMode && activeAction === "deposit" ? "See basket balances below" : "Unavailable"
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

  const routeInputsReady = Boolean(isUsdgMode && marketInputAmount && marketInputAmount > 0n && slippageValid);
  const directInputsReady = Boolean(
    !isUsdgMode && slippageValid && (
      activeAction === "deposit" ? requestedDirectMintShares : requestedRedeemShares
    ),
  );
  const underlyingRouteAvailable = entryContractsConfigured &&
    entryAdapterApproved !== false &&
    constituentPoolsReady &&
    (activeAction === "redeem" || !depositsPausedForAssetRemoval);
  const underlyingRouteChecking = Boolean(
    entryContractsConfigured && constituentPoolsConfigured && constituentLiquidityLoading,
  );
  const underlyingQuoteReady = activeAction === "deposit"
    ? entryQuoteReady && entryWithinBudget
    : redeemQuoteReady;
  const underlyingQuoteLoading = activeAction === "deposit"
    ? constituentLiquidityLoading || finalPreviewEntryLoading || finalEntryQuotesLoading
    : constituentLiquidityLoading || previewRedeemLoading || redeemQuotesLoading;
  const underlyingQuoteFailed = activeAction === "deposit"
    ? Boolean(finalPreviewEntryError || entryQuotesFailed)
    : Boolean(previewRedeemError || redeemQuotesFailed);
  const underlyingQuotedOutput = activeAction === "deposit"
    ? requestedEntryShares
    : quotedRedeemSettlement;

  async function approveSettlementToken() {
    if (
      !settlementToken ||
      !entryRouterAddress ||
      !publicClient ||
      maximumSettlementTotal === undefined ||
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
        if (resetReceipt.status !== "success") throw new Error("The USDG approval reset reverted.");
      }
      setEntryState("pending");
      const hash = await writeContractAsync({
        address: settlementToken,
        abi: erc20BalanceAbi,
        functionName: "approve",
        args: [entryRouterAddress, maximumSettlementTotal],
        chainId: robinhoodChainTestnet.id,
      });
      setEntryState("submitted");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The USDG approval reverted.");
      await refetchEntryAuthorization();
      setEntryState("confirmed");
    } catch (error) {
      setEntryError(errorMessage(error));
      setEntryState("reverted");
    }
  }

  async function enterWithSettlement() {
    if (
      !vault.address ||
      !connectedAddress ||
      !publicClient ||
      !entryRouterAddress ||
      !entryAdapterAddress ||
      !settlementToken ||
      !requestedEntryShares ||
      maximumSettlementTotal === undefined ||
      !entryQuoteReady ||
      !entryBalanceSufficient ||
      !entryAllowanceSufficient ||
      !entryWithinBudget
    ) return;
    const swaps = entryLegs.map((leg) => leg.isSettlement
      ? { adapter: zeroAddress, maxSettlementIn: 0n, adapterData: "0x" as `0x${string}` }
      : {
          adapter: entryAdapterAddress,
          maxSettlementIn: leg.maximumSettlement as bigint,
          adapterData: encodeAbiParameters(
            [{ type: "address[]" }],
            [[settlementToken, leg.address as `0x${string}`]],
          ),
        });
    setEntryError(undefined);
    try {
      setEntryState("pending");
      const hash = await writeContractAsync({
        address: entryRouterAddress,
        abi: otfEntryRouterAbi,
        functionName: "enterWithSettlement",
        args: [
          vault.address,
          requestedEntryShares,
          connectedAddress,
          maximumSettlementTotal,
          BigInt(Math.floor(Date.now() / 1_000) + 20 * 60),
          swaps,
        ],
        chainId: robinhoodChainTestnet.id,
      });
      setEntryState("submitted");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The USDG entry transaction reverted.");
      await refetchEntryAuthorization();
      await refetchEntryPreview();
      await refetchEntryQuotes();
      setEntryState("confirmed");
      setTradeReceipt({
        action: "deposit",
        detail: `${formatWalletTokenBalance(requestedEntryShares, 18)} ${vault.symbol} minted through the underlying RWA pools.`,
        transactionHash: hash,
      });
      setTradeAmount("");
    } catch (error) {
      setEntryError(errorMessage(error));
      setEntryState("reverted");
    }
  }

  async function approveBasketAssets() {
    if (!vault.address || !connectedAddress || !publicClient || !directBasketReady) return;
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

  async function redeemToSettlement() {
    if (
      !vault.address || !connectedAddress || !publicClient || !entryRouterAddress || !entryAdapterAddress ||
      !settlementToken || !requestedRedeemShares || !minimumRedeemSettlement || !redeemQuoteReady ||
      !redeemBalanceSufficient || !redeemAllowanceSufficient
    ) return;
    const swaps = redeemLegs.map((leg) => leg.isSettlement
      ? { adapter: zeroAddress, minSettlementOut: 0n, adapterData: "0x" as `0x${string}` }
      : {
          adapter: entryAdapterAddress,
          minSettlementOut: leg.minimumSettlement as bigint,
          adapterData: encodeAbiParameters(
            [{ type: "address[]" }],
            [[leg.address as `0x${string}`, settlementToken]],
          ),
        });
    setRedeemError(undefined);
    try {
      setRedeemState("pending");
      const hash = await writeContractAsync({
        address: entryRouterAddress,
        abi: otfEntryRouterAbi,
        functionName: "redeemToSettlement",
        args: [
          vault.address,
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
      if (receipt.status !== "success") throw new Error("The USDG redemption reverted.");
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
          fee: 500,
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

  function changeSettlementMode(nextMode: "usdg" | "rwas") {
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
      subtitle={isUsdgMode
        ? activeAction === "deposit" ? `Buy ${vault.symbol} with USDG` : `Redeem ${vault.symbol} for USDG`
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
                <th>Your amount</th>
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
                    <td data-label="Your amount">
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
                className={isUsdgMode ? "active" : ""}
                type="button"
                role="radio"
                aria-checked={isUsdgMode}
                onClick={() => changeSettlementMode("usdg")}
              >
                USDG
              </button>
              <button
                className={!isUsdgMode ? "active" : ""}
                type="button"
                role="radio"
                aria-checked={!isUsdgMode}
                onClick={() => changeSettlementMode("rwas")}
              >
                RWAs
              </button>
            </div>
          </div>
        </div>

        <div className="positionTicketInputs">
          <label>
            <span className="positionFieldHeading">
              <span>{!isUsdgMode && activeAction === "deposit" ? "Shares to mint" : `${inputTokenSymbol} amount`}</span>
              <span className="positionWalletBalance">Balance: {walletInputBalanceLabel}</span>
            </span>
            <div className="positionAmountInput">
              <input
                value={tradeAmount}
                onChange={(event) => updateTradeAmount(event.target.value)}
                type="number"
                min="0"
                inputMode="decimal"
                placeholder="0.00"
                aria-label={`${inputTokenSymbol} amount`}
                disabled={!isLive || entryBusy || redeemBusy || marketBusy}
              />
              {isUsdgMode || activeAction === "redeem" ? (
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
                type="number"
                min="0.01"
                max="20"
                step="0.1"
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
                  ? "Compare estimated OTF shares for the same USDG amount."
                  : "Compare estimated USDG proceeds for the same OTF shares."}
              </span>
            </div>
            <div className="positionRouteChoices" role="radiogroup" aria-label="Execution route">
              <button
                className={`positionRouteOption ${selectedRoute === "market" ? "selected" : ""}`}
                type="button"
                role="radio"
                aria-checked={selectedRoute === "market"}
                disabled={!marketRouteAvailable || redeemAmountExceedsBalance}
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
                        : marketQuoteError
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
                    ? marketLiquidityReady ? "V3 trade route is not configured" : "No funded OTF / USDG pool"
                    : activeAction === "deposit"
                      ? `${vault.symbol} shares received`
                      : "USDG received"}
                </small>
              </button>

              <button
                className={`positionRouteOption ${selectedRoute === "underlying" ? "selected" : ""}`}
                type="button"
                role="radio"
                aria-checked={selectedRoute === "underlying"}
                disabled={!underlyingRouteAvailable || redeemAmountExceedsBalance}
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
                      : underlyingQuoteFailed
                        ? "No quote"
                        : underlyingQuotedOutput
                          ? formatWalletTokenBalance(
                              underlyingQuotedOutput,
                              activeAction === "deposit" ? 18 : settlementDecimals,
                            )
                          : "—"}
                </strong>
                <small>
                  {!entryContractsConfigured || entryAdapterApproved === false
                    ? "Settlement route not configured"
                    : activeAction === "deposit" && depositsPausedForAssetRemoval
                      ? "Paused while an asset is removed"
                    : !constituentPoolsConfigured
                      ? "Constituent pools not configured"
                      : constituentLiquidityLoading
                        ? "Checking constituent liquidity"
                      : constituentLiquidityReadFailed
                        ? "Could not verify constituent liquidity"
                      : emptyConstituentPoolSymbols.length
                        ? `${emptyConstituentPoolSymbols.join(", ")} pool${emptyConstituentPoolSymbols.length === 1 ? " has" : "s have"} no active liquidity`
                      : !constituentPoolsReady
                        ? "Constituent liquidity unavailable"
                    : activeAction === "deposit"
                      ? `${vault.symbol} shares minted`
                      : "USDG received"}
                </small>
              </button>
            </div>
          </div>
        ) : !isUsdgMode && directInputsReady ? null : tradeReceipt ? (
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
              <strong>{isUsdgMode ? "Enter an amount to compare routes" : "Enter shares to preview the RWA basket"}</strong>
              <span>
                {isUsdgMode
                  ? `Both execution paths use the same ${inputTokenSymbol} amount and slippage limit.`
                  : activeAction === "deposit"
                    ? `You will supply each underlying asset required to mint ${vault.symbol}.`
                    : "You will receive each underlying asset directly in your wallet."}
              </span>
            </div>
          </div>
        )}

        {!isUsdgMode && directInputsReady ? (
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

            {activeAction === "deposit" && directMintPreviewError ? (
              <div className="validationSummary danger">
                <AlertTriangle size={15} />
                <div><strong>Basket preview unavailable</strong><span>{errorMessage(directMintPreviewError)}</span></div>
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
                  <span>{activeAction === "deposit" ? "Buy existing shares from the OTF / USDG pool." : "Sell shares into the OTF / USDG pool."}</span>
                </div>
              </div>
              <span className="stateBadge success">Selected</span>
            </div>
            <div className="positionExecutionQuote">
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
            </div>
            <div className="routeExecutionNote">
              <Info size={14} />
              <span>The open-market price comes from the direct OTF / USDG pool and can differ from portfolio value.</span>
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
                      ? "Buy the portfolio assets and mint new OTF shares."
                      : "Burn OTF shares and sell the portfolio assets for USDG."}
                  </span>
                </div>
              </div>
              <span className="stateBadge success">Selected</span>
            </div>

            {activeAction === "deposit" ? (
              <>
                <div className="positionExecutionQuote">
                  <div><span>USDG spent</span><strong>{maximumSettlementTotal !== undefined ? formatWalletTokenBalance(maximumSettlementTotal, settlementDecimals) : "—"} USDG</strong></div>
                  <div><span>Estimated shares</span><strong>{navEstimatedShares ? formatWalletTokenBalance(navEstimatedShares, 18) : "—"} {vault.symbol}</strong></div>
                  <div><span>Minimum shares</span><strong>{requestedEntryShares ? formatWalletTokenBalance(requestedEntryShares, 18) : "—"} {vault.symbol}</strong></div>
                </div>
                {!entryWithinBudget && maximumSettlementTotal !== undefined ? (
                  <div className="validationSummary danger">
                    <AlertTriangle size={15} />
                    <div><strong>Pool quote exceeds your USDG amount</strong><span>This route cannot guarantee the requested budget at the current constituent-pool prices.</span></div>
                  </div>
                ) : null}
                {entryQuoteReady && !entryBalanceSufficient ? (
                  <div className="validationSummary danger">
                    <AlertTriangle size={15} />
                    <div><strong>Insufficient USDG</strong><span>Your wallet balance is below this route&apos;s maximum spend.</span></div>
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
                    {entryAllowanceSufficient ? "USDG approved" : "Approve USDG"}
                  </button>
                  <button
                    className="primaryAction"
                    type="button"
                    disabled={entryBusy || !underlyingQuoteReady || !entryBalanceSufficient || !entryAllowanceSufficient}
                    onClick={enterWithSettlement}
                  >
                    {entryBusy ? <Loader2 className="spin" size={14} /> : <ArrowDownToLine size={14} />}
                    Mint {vault.symbol}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="positionExecutionQuote">
                  <div><span>Shares redeemed</span><strong>{requestedRedeemShares ? formatWalletTokenBalance(requestedRedeemShares, 18) : "—"} {vault.symbol}</strong></div>
                  <div><span>Expected proceeds</span><strong>{quotedRedeemSettlement !== undefined ? formatWalletTokenBalance(quotedRedeemSettlement, settlementDecimals) : "—"} USDG</strong></div>
                  <div><span>Minimum received</span><strong>{minimumRedeemSettlement !== undefined ? formatWalletTokenBalance(minimumRedeemSettlement, settlementDecimals) : "—"} USDG</strong></div>
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
                    onClick={redeemToSettlement}
                  >
                    {redeemBusy ? <Loader2 className="spin" size={14} /> : <ArrowRight size={14} />}
                    Redeem for USDG
                  </button>
                </div>
              </>
            )}

            <div className="routeExecutionNote">
              <Info size={14} />
              <span>Underlying execution uses approved RWA pools. Final USDG depends on their live liquidity and price impact.</span>
            </div>
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}

function configuredV3MarketRegistryAddress(): `0x${string}` | undefined {
  return robinhoodTestnetAddresses.v3MarketRegistry;
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

function TargetWeightsBuilder({ vault, onRefresh }: { vault: VaultView; onRefresh: () => Promise<unknown> }) {
  const activeTargetsKey = vault.allocations
    .map((asset) => `${asset.address.toLowerCase()}:${asset.symbol}:${asset.targetWeightBps}`)
    .join("|");
  const [targets, setTargets] = useState<StrategyTargetAsset[]>(() =>
    vault.allocations.map((asset) => ({
      ticker: asset.symbol,
      address: asset.address,
      targetWeight: String(asset.targetWeightBps / 100),
      initialAmount: "",
    })),
  );
  const initializedTargetsKey = useRef(activeTargetsKey);
  const [rationale, setRationale] = useState("");
  const [txState, setTxState] = useState<TxState>("idle");
  const [txError, setTxError] = useState<string>();
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

  useEffect(() => {
    if (initializedTargetsKey.current === activeTargetsKey) return;
    initializedTargetsKey.current = activeTargetsKey;
    setTargets(vault.allocations.map((asset) => ({
      ticker: asset.symbol,
      address: asset.address,
      targetWeight: String(asset.targetWeightBps / 100),
      initialAmount: "",
    })));
  }, [activeTargetsKey, vault.allocations]);

  const totalWeight = targets.reduce((sum, asset) => sum + Number(asset.targetWeight || 0), 0);
  const targetChanges = targets.map((asset) => {
    const currentAllocation = vault.allocations.find(
      (allocation) => allocation.address.toLowerCase() === asset.address.toLowerCase(),
    );
    const current = (currentAllocation?.actualWeightBps ?? 0) / 100;
    const activeTarget = (currentAllocation?.targetWeightBps ?? 0) / 100;
    return { ...asset, current, activeTarget, delta: Number(asset.targetWeight || 0) - current };
  });
  const turnover = Math.max(0, targetChanges.reduce((sum, asset) => sum + Math.abs(asset.delta), 0) / 2);
  const targetWeightBps = targets.map((asset) => Math.round(Number(asset.targetWeight) * 100));
  const weightSumValid = targetWeightBps.reduce((sum, weight) => sum + weight, 0) === 10_000;
  const targetBoundsKnown = vault.minNonZeroAssetWeightBps > 0
    && vault.maxSingleAssetWeightBps >= vault.minNonZeroAssetWeightBps;
  const belowMinimumTargets = targetWeightBps.flatMap((weight, index) =>
    !Number.isFinite(weight) || weight < vault.minNonZeroAssetWeightBps ? [targets[index].ticker] : [],
  );
  const aboveMaximumTargets = targetWeightBps.flatMap((weight, index) =>
    Number.isFinite(weight) && weight > vault.maxSingleAssetWeightBps ? [targets[index].ticker] : [],
  );
  const targetBoundsValid = targetBoundsKnown
    && belowMinimumTargets.length === 0
    && aboveMaximumTargets.length === 0;
  const weightsValid = weightSumValid && targetBoundsValid;
  const addressesValid = targets.length > 0 && targets.every((asset) => isAddress(asset.address));
  const targetsUnique = new Set(targets.map((asset) => asset.address.toLowerCase())).size === targets.length;
  const targetsChanged = targets.length !== vault.allocations.length || targets.some((target) => {
    const current = vault.allocations.find(
      (allocation) => allocation.address.toLowerCase() === target.address.toLowerCase(),
    );
    return !current || Math.round(Number(target.targetWeight) * 100) !== current.targetWeightBps;
  });
  const normalizedRationale = rationale.trim();
  const rationaleBytes = new TextEncoder().encode(normalizedRationale).length;
  const rationaleValid = rationaleBytes > 0 && rationaleBytes <= 2_048;
  const turnoverLimit = vault.maxTurnoverBps / 100;
  const turnoverBreach = turnover > turnoverLimit;
  const proposalBlocker = vault.canProposeStrategy || vault.dataMode !== "live"
    ? undefined
    : vault.challengeActive
      ? { title: "Resolve the active challenge first", detail: "New target proposals remain locked until the portfolio returns to its completion bands and the challenge is resolved." }
      : vault.strategyProposalPending
        ? { title: "A target proposal is already pending", detail: "Activate or cancel the pending proposal before creating another one." }
        : vault.strategicRebalanceActive
          ? { title: "Complete the active rebalance first", detail: "New targets remain locked until the live basket reaches its completion bands and the current rebalance completes." }
          : proposalCooldownRemaining > 0
            ? { title: "Strategy cooldown is active", detail: `New target proposals unlock in ${formatCooldown(proposalCooldownRemaining)}, on ${formatTimestamp(vault.nextStrategyChange)}.` }
            : !vault.withinCompletionBands
              ? { title: "Portfolio is outside its completion bands", detail: "Rebalance the live basket back inside every completion band before proposing new targets." }
              : { title: "Target proposal is not currently available", detail: "Refresh the onchain data to check the latest strategy state." };

  function updateTarget(index: number, patch: Partial<StrategyTargetAsset>) {
    setTargets((current) => current.map((asset, itemIndex) => itemIndex === index ? { ...asset, ...patch } : asset));
    setTxState("idle");
    setTxError(undefined);
  }

  function addTarget() {
    const selectedAddresses = new Set(targets.map((target) => target.address.toLowerCase()));
    const nextAsset = testnetCreateAssets.find((asset) => !selectedAddresses.has(asset.address.toLowerCase()));
    if (!nextAsset) return;
    setTargets((current) => [...current, {
      ticker: nextAsset.symbol,
      address: nextAsset.address,
      targetWeight: "",
      initialAmount: "",
    }]);
    setTxState("idle");
  }

  async function submitTargets() {
    if (!vault.address || !vault.connectedIsManager || !publicClient || !weightsValid || !addressesValid || !targetsUnique || !targetsChanged || !rationaleValid) return;
    setTxError(undefined);
    try {
      setTxState("simulating");
      const args = [
        targets.map((target) => target.address as `0x${string}`),
        targetWeightBps.map(BigInt),
        normalizedRationale,
      ] as const;
      await publicClient.simulateContract({
        account: vault.manager as `0x${string}`,
        address: vault.address,
        abi: managedOtfVaultAbi,
        functionName: "proposeStrategy",
        args,
      });
      setTxState("pending");
      const hash = await writeContractAsync({
        address: vault.address,
        abi: managedOtfVaultAbi,
        functionName: "proposeStrategy",
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
      <div className="builderBlock">
        <div className="subHeader">
          <span>Target weights</span>
          <small className={weightsValid ? "successText" : "warningText"}>Total: {totalWeight.toFixed(1)}%</small>
        </div>
        <div className="targetCardGrid">
          {targets.map((target, index) => (
            <div className="targetCard" key={`${target.ticker}-${index}`}>
              <div className="targetCardHeader">
                <div className="assetSelectWithLogo">
                  <AssetLogo logoUrl={catalogAssetForAddress(target.address)?.logoUrl} symbol={target.ticker} compact />
                  <select
                    className="targetTicker"
                    value={target.address}
                    disabled={vault.strategyProposalPending}
                    onChange={(event) => {
                      const selected = testnetCreateAssets.find((asset) => asset.address === event.target.value);
                      if (selected) updateTarget(index, { ticker: selected.symbol, address: selected.address });
                    }}
                  >
                    {testnetCreateAssets.map((asset) => (
                      <option key={asset.address} value={asset.address}>{asset.symbol}</option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  title={`Remove ${target.ticker || "asset"}`}
                  disabled={vault.strategyProposalPending}
                  onClick={() => setTargets((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <label>
                <span>Target weight</span>
                <div className="inputWithSuffix">
                  <input
                    value={target.targetWeight}
                    onChange={(event) => updateTarget(index, { targetWeight: event.target.value })}
                    type="number"
                    min={0}
                    max={100}
                    placeholder="0"
                    disabled={vault.strategyProposalPending}
                    aria-label={`${target.ticker || "Asset"} draft target weight`}
                  />
                  <span>%</span>
                </div>
              </label>
              <small>Active target {targetChanges[index]?.activeTarget.toFixed(1) ?? "0.0"}% · Live holding {targetChanges[index]?.current.toFixed(1) ?? "0.0"}%</small>
            </div>
          ))}
        </div>
        <button className="ghostAction addAssetAction" type="button" onClick={addTarget} disabled={vault.strategyProposalPending || targets.length >= vault.maxAssetCount || targets.length >= testnetCreateAssets.length}>
          <Plus size={13} />
          Add asset
        </button>
      </div>

      <div className="builderBlock strategyRationaleComposer">
        <div className="subHeader">
          <span>Strategy rationale</span>
          <small className={rationaleValid ? "successText" : rationaleBytes > 2_048 ? "dangerText" : "warningText"}>{rationaleBytes.toLocaleString()} / 2,048 UTF-8 bytes</small>
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
          disabled={vault.strategyProposalPending}
          aria-invalid={rationaleBytes > 2_048}
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
              <span className="assetNameWithLogo"><AssetLogo logoUrl={catalogAssetForAddress(target.address)?.logoUrl} symbol={target.ticker || "Asset"} compact /><strong>{target.ticker || "Asset"}</strong></span>
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
        {!weightSumValid ? (
          <div className="riskCallout warning"><AlertTriangle size={15} /><div><strong>Target weights must sum to exactly 100%</strong><span>Weights are submitted to the contract in whole basis points.</span></div></div>
        ) : null}
        {targetBoundsKnown && !targetBoundsValid ? (
          <div className="riskCallout warning"><AlertTriangle size={15} /><div>
            <strong>{belowMinimumTargets.length && aboveMaximumTargets.length
              ? "Some targets are outside the allowed range"
              : belowMinimumTargets.length
                ? `${belowMinimumTargets.join(", ")} ${belowMinimumTargets.length === 1 ? "is" : "are"} below the minimum target`
                : `${aboveMaximumTargets.join(", ")} ${aboveMaximumTargets.length === 1 ? "exceeds" : "exceed"} the maximum target`}</strong>
            <span>Each included asset must be between {(vault.minNonZeroAssetWeightBps / 100).toFixed(2)}% and {(vault.maxSingleAssetWeightBps / 100).toFixed(2)}%. Remove an asset instead of assigning it less than the minimum.</span>
          </div></div>
        ) : null}
        {!targetsUnique ? (
          <div className="riskCallout danger"><XCircle size={15} /><div><strong>Each asset may appear only once</strong><span>Select a different supported asset or remove the duplicate.</span></div></div>
        ) : null}
        {!targetsChanged ? (
          <div className="riskCallout warning"><AlertTriangle size={15} /><div><strong>Change at least one target</strong><span>Reordering the same assets or submitting identical weights does not create a new strategy.</span></div></div>
        ) : null}
        {!rationaleValid ? (
          <div className={`riskCallout ${rationaleBytes > 2_048 ? "danger" : "warning"}`}><BookOpen size={15} /><div><strong>{rationaleBytes > 2_048 ? "Strategy rationale is too long" : "Strategy rationale required"}</strong><span>{rationaleBytes > 2_048 ? "Shorten it to 2,048 UTF-8 bytes or fewer." : "Explain the target change before submitting the proposal."}</span></div></div>
        ) : null}
        {turnoverBreach ? (
          <div className="riskCallout danger"><XCircle size={15} /><div><strong>Target changes are too large</strong><span>Reduce the proposed weight changes before submitting.</span></div></div>
        ) : null}
        {proposalBlocker ? (
          <div className="riskCallout warning"><Clock3 size={15} /><div><strong>{proposalBlocker.title}</strong><span>{proposalBlocker.detail}</span></div></div>
        ) : null}
        {txError ? (
          <div className="riskCallout danger"><XCircle size={15} /><div><strong>Target update failed</strong><span>{txError}</span></div></div>
        ) : null}
      </div>

      <TxStatus state={txState} persistent />
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
            disabled={!vault.connectedIsManager || !vault.canProposeStrategy || !weightsValid || !addressesValid || !targetsUnique || !targetsChanged || !rationaleValid || turnoverBreach || txState === "pending" || txState === "submitted" || txState === "simulating"}
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
  const [tokenIn, setTokenIn] = useState(recommendedTrades[0]?.sell.address ?? "");
  const [tokenOut, setTokenOut] = useState(recommendedTrades[0]?.buy.address ?? "");
  const [tradeSize, setTradeSize] = useState<10 | 25 | 50 | 100 | "custom">(100);
  const [amountInText, setAmountInText] = useState("");
  const [slippageText, setSlippageText] = useState("1.0");
  const [txState, setTxState] = useState<TxState>("idle");
  const [txError, setTxError] = useState<string>();
  const { address: connectedAddress } = useAccount();
  const publicClient = usePublicClient({ chainId: robinhoodChainTestnet.id });
  const { writeContractAsync } = useWriteContract();
  const adapterAddress = configuredEntryAdapterAddress();
  const quoterAddress = configuredUniswapV3QuoterAddress();
  const settlementToken = configuredSettlementTokenAddress();
  const constituentFee = configuredConstituentFee();
  const hasAllowedTrade = recommendedTrades.length > 0;

  useEffect(() => {
    const selectedTradeStillAvailable = recommendedTrades.some(
      (trade) => trade.sell.address === tokenIn && trade.buy.address === tokenOut,
    );
    if (selectedTradeStillAvailable) return;
    setTokenIn(recommendedTrades[0]?.sell.address ?? "");
    setTokenOut(recommendedTrades[0]?.buy.address ?? "");
    setTradeSize(100);
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
    isLoading: tokenInVaultBalanceLoading,
    isError: tokenInVaultBalanceError,
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
  const path = settlementToken ? [tokenIn, settlementToken, tokenOut] : [tokenIn, tokenOut];
  const routeValid = path.every((address) => isAddress(address)) && tokenIn !== tokenOut;
  const inputPool = configuredConstituentPool(tokenIn);
  const outputPool = configuredConstituentPool(tokenOut);
  const rebalanceLiquidityContracts = [inputPool, outputPool].flatMap((pool) => pool ? [{
    address: pool,
    abi: uniswapV3PoolAbi,
    functionName: "liquidity" as const,
    chainId: robinhoodChainTestnet.id,
  }] : []);
  const {
    data: rebalanceLiquidityResults,
    isLoading: rebalanceLiquidityLoading,
  } = useReadContracts({
    contracts: rebalanceLiquidityContracts,
    query: { enabled: rebalanceLiquidityContracts.length === 2 },
  });
  const rebalancePoolsConfigured = Boolean(inputPool && outputPool);
  const rebalanceLiquidityReady = Boolean(
    rebalancePoolsConfigured && rebalanceLiquidityResults?.length === 2
      && rebalanceLiquidityResults.every(
        (result) => result.status === "success" && typeof result.result === "bigint" && result.result > 0n,
      ),
  );
  const packedPath = routeValid && settlementToken
    ? encodePacked(
        ["address", "uint24", "address", "uint24", "address"],
        [
          tokenIn as `0x${string}`,
          constituentFee,
          settlementToken,
          constituentFee,
          tokenOut as `0x${string}`,
        ],
      )
    : undefined;
  const quoteEnabled = Boolean(
    quoterAddress && packedPath && amountIn && amountIn > 0n && rebalanceLiquidityReady,
  );
  const {
    data: quoteResult,
    error: quoteError,
    isLoading: quoteLoading,
    refetch: refetchQuote,
  } = useReadContract({
    address: quoterAddress,
    abi: uniswapV3QuoterAbi,
    functionName: "quoteExactInput",
    args: amountIn && packedPath ? [packedPath, amountIn] : undefined,
    chainId: robinhoodChainTestnet.id,
    query: { enabled: quoteEnabled },
  });
  const quotedAmountOut = (quoteResult as readonly [bigint, readonly bigint[], readonly number[], bigint] | undefined)?.[0];
  const poolMinimumAmountOut = quotedAmountOut && slippageValid
    ? quotedAmountOut * BigInt(10_000 - slippageBps) / 10_000n
    : undefined;
  const outputAsset = vault.allocations.find((asset) => asset.address === tokenOut);
  const inputAsset = vault.allocations.find((asset) => asset.address === tokenIn);
  const inputOraclePrice = oraclePrices[tokenIn.toLowerCase()];
  const outputOraclePrice = oraclePrices[tokenOut.toLowerCase()];
  const inputBalanceValue = oracleTokenValue(tokenInVaultBalance, tokenInDecimals, inputOraclePrice);
  const outputBalanceValue = oracleTokenValue(tokenOutVaultBalance, tokenOutDecimals, outputOraclePrice);
  const inputTradeValue = oracleTokenValue(amountIn, tokenInDecimals, inputOraclePrice);
  const quotedOutputValue = oracleTokenValue(quotedAmountOut, tokenOutDecimals, outputOraclePrice);
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
  const turnoverMaxAmount = tokenInVaultBalance !== undefined && inputAsset?.actualWeightBps
    ? tokenInVaultBalance
      * BigInt(vault.maxTurnoverBps)
      / BigInt(inputAsset.actualWeightBps)
    : undefined;
  const recommendedTradeAmount = tokenInVaultBalance !== undefined
    && oracleBalancedTradeAmount !== undefined
    && turnoverMaxAmount !== undefined
    ? [tokenInVaultBalance, oracleBalancedTradeAmount, turnoverMaxAmount].reduce(
        (smallest, value) => value < smallest ? value : smallest,
      )
    : undefined;
  const maxSellAmount = tokenInVaultBalance !== undefined
    && sellSideMaxAmount !== undefined
    && turnoverMaxAmount !== undefined
    && buySideMaxAmount !== undefined
    ? [tokenInVaultBalance, sellSideMaxAmount, turnoverMaxAmount, buySideMaxAmount].reduce(
        (smallest, value) => value < smallest ? value : smallest,
      )
    : undefined;
  const maxSellAmountText = maxSellAmount !== undefined
    ? formatUnits(maxSellAmount, tokenInDecimals)
    : undefined;
  const amountExceedsSellLimit = Boolean(
    amountIn && maxSellAmount !== undefined && amountIn > maxSellAmount,
  );
  const amountWithinSellLimit = Boolean(
    amountIn && maxSellAmount !== undefined && amountIn <= maxSellAmount,
  );
  const tokenInVaultBalanceLabel = tokenInVaultBalanceLoading
    ? "Loading"
    : tokenInVaultBalanceError || tokenInVaultBalance === undefined
      ? "Unavailable"
      : `${formatWalletTokenBalance(tokenInVaultBalance, tokenInDecimals, 12)} ${inputAsset?.symbol ?? "tokens"}`;
  const sellLimitLabel = maxSellAmount === undefined
    ? "Unavailable"
    : `${formatWalletTokenBalance(maxSellAmount, tokenInDecimals, 12)} ${inputAsset?.symbol ?? "tokens"}`;
  const recommendedTradeAmountLabel = recommendedTradeAmount === undefined
    ? "Unavailable"
    : `${formatWalletTokenBalance(recommendedTradeAmount, tokenInDecimals, 12)} ${inputAsset?.symbol ?? "tokens"}`;
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

  useEffect(() => {
    if (tradeSize === "custom") return;
    const presetAmount = recommendedTradeAmount !== undefined
      ? recommendedTradeAmount * BigInt(tradeSize) / 100n
      : undefined;
    setAmountInText(presetAmount !== undefined ? formatUnits(presetAmount, tokenInDecimals) : "");
    resetTradeState();
  }, [recommendedTradeAmount, tokenInDecimals, tradeSize]);

  const contractsConfigured = Boolean(adapterAddress && quoterAddress && settlementToken);
  const busy = txState === "simulating" || txState === "pending" || txState === "submitted";
  const canSubmit = Boolean(
    vault.address && vault.connectedIsManager && connectedAddress && publicClient && contractsConfigured &&
    hasAllowedTrade && amountWithinSellLimit && minAmountOut && routeValid && slippageValid &&
    rebalanceLiquidityReady && predictedWeightsReady && !buyWouldMoveFartherFromTarget && !oracleValueLossTooHigh,
  );

  function resetTradeState() {
    if (txState !== "idle") setTxState("idle");
    if (txError) setTxError(undefined);
  }

  async function executeTrade() {
    if (!canSubmit || !vault.address || !adapterAddress || !connectedAddress || !publicClient || !amountIn || !minAmountOut) return;
    setTxError(undefined);
    try {
      setTxState("simulating");
      const trade = {
        adapter: adapterAddress,
        tokenIn: tokenIn as `0x${string}`,
        tokenOut: tokenOut as `0x${string}`,
        amountIn,
        minAmountOut,
        adapterData: encodeAbiParameters([{ type: "address[]" }], [path as `0x${string}`[]]),
      };
      await publicClient.simulateContract({
        account: connectedAddress,
        address: vault.address,
        abi: managedOtfVaultAbi,
        functionName: "executeRebalanceTrades",
        args: [[trade]],
      });
      setTxState("pending");
      const hash = await writeContractAsync({
        address: vault.address,
        abi: managedOtfVaultAbi,
        functionName: "executeRebalanceTrades",
        args: [[trade]],
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
      await refetchQuote();
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
        {!hasAllowedTrade ? (
          <div className="inlineEmptyState rebalanceEmptyState">
            <CheckCircle size={16} />
            <div><strong>No constrained trade is available</strong><span>The live basket has no overweight-to-underweight pair. Rebalance choices appear here only when a trade can move the portfolio closer to its active targets.</span></div>
          </div>
        ) : null}
        <div className="recommendedTradePlan">
          <div className="subHeader">
            <span>Recommended trades</span>
            <small>{recommendedTrades.length} {recommendedTrades.length === 1 ? "trade" : "trades"} to minimize portfolio drift</small>
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
                  <span className="recommendedTradeWeight">{(trade.transferBps / 100).toFixed(1)}% NAV</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="tradeSizeControl">
          <div className="subHeader">
            <span>Trade size</span>
            <small>100% recommended: {recommendedTradeAmountLabel}</small>
          </div>
          <div className="tradeSizeOptions" role="radiogroup" aria-label="Trade size">
            {([10, 25, 50, 100, "custom"] as const).map((size) => (
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
                {size === "custom" ? "Custom" : `${size}%`}
              </button>
            ))}
          </div>
        </div>

        <div className="tradeInputGrid">
          <label>
            <span className="positionFieldHeading">
              <span>Amount to sell</span>
              <span className="positionWalletBalance">OTF balance: {tokenInVaultBalanceLabel} · Custom limit: {sellLimitLabel}</span>
            </span>
            <div className="inputWithSuffix tradeAmountInput">
              <input
                type="number"
                min="0"
                max={maxSellAmountText}
                inputMode="decimal"
                value={amountInText}
                disabled={!hasAllowedTrade}
                readOnly={tradeSize !== "custom"}
                onChange={(event) => {
                  if (tradeSize !== "custom") return;
                  setAmountInText(event.target.value);
                  resetTradeState();
                }}
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

        <div className={`routeToggle ${!settlementToken ? "disabled" : ""}`}>
          <span>
            <strong>Routes through USDG</strong>
            <small>USDG is an internal Uniswap hop and never becomes an OTF constituent or recipient.</small>
          </span>
        </div>

        <div className="tradeExecutionQuote">
          <span>Uniswap quote</span>
          <strong>
            {quoteLoading ? "Loading" : quotedAmountOut
              ? `${formatWalletTokenBalance(quotedAmountOut, tokenOutDecimals)} ${outputAsset?.symbol ?? "tokens"}`
              : "Enter an amount"}
          </strong>
          <small>{`${inputAsset?.symbol ?? "Asset"} -> USDG -> ${outputAsset?.symbol ?? "Asset"}`}</small>
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
        {hasAllowedTrade && contractsConfigured && !rebalanceLiquidityLoading && !rebalancePoolsConfigured ? (
          <div className="validationSummary warning"><AlertTriangle size={15} /><div><strong>Constituent pools are not configured</strong><span>Both selected assets need recorded USDG pools before this rebalance route can be quoted.</span></div></div>
        ) : null}
        {hasAllowedTrade && contractsConfigured && rebalancePoolsConfigured && !rebalanceLiquidityLoading && !rebalanceLiquidityReady ? (
          <div className="validationSummary warning"><AlertTriangle size={15} /><div><strong>Awaiting constituent liquidity</strong><span>Both USDG pools exist, but this route stays disabled until they have active liquidity.</span></div></div>
        ) : null}
        {hasAllowedTrade && tokenIn === tokenOut ? (
          <div className="validationSummary warning"><AlertTriangle size={15} /><div><strong>Select two different assets</strong><span>The sold and purchased constituents cannot be the same token.</span></div></div>
        ) : null}
        {amountExceedsSellLimit ? (
          <div className="validationSummary warning"><AlertTriangle size={15} /><div><strong>Amount exceeds the trade limit</strong><span>Enter no more than {sellLimitLabel}. The limit includes both assets&apos; mirrored deviations, turnover, and the OTF balance.</span></div></div>
        ) : null}
        {buyWouldMoveFartherFromTarget ? (
          <div className="validationSummary warning"><AlertTriangle size={15} /><div><strong>{outputAsset?.symbol ?? "The buy asset"} would move too far past its target</strong><span>Crossing the target is allowed, but its predicted distance from target cannot exceed its current distance.</span></div></div>
        ) : null}
        {oracleValueLossTooHigh ? (
          <div className="validationSummary warning"><AlertTriangle size={15} /><div><strong>Pool price impact is too high</strong><span>This quote loses approximately {(quotedOracleLossBps / 100).toFixed(2)}% of oracle value; the OTF allows at most {(vault.maxNavLossBps / 100).toFixed(2)}%. Choose a smaller percentage or Custom amount.</span></div></div>
        ) : null}
        {quoteError ? (
          <div className="validationSummary danger"><XCircle size={15} /><div><strong>No usable pool quote</strong><span>{errorMessage(quoteError)}</span></div></div>
        ) : null}
        {txError ? (
          <div className="validationSummary danger"><XCircle size={15} /><div><strong>Trade failed</strong><span>{txError}</span></div></div>
        ) : null}
        <div className="riskCallout info"><ShieldCheck size={15} /><div><strong>The OTF contract performs the final checks</strong><span>The trade must use active constituents and an approved adapter, respect oracle value, NAV-loss, turnover, and exposure limits, avoid moving any asset farther from target, and improve the portfolio overall.</span></div></div>
        <TxStatus state={txState} />
        <button className="primaryAction" type="button" disabled={!canSubmit || busy} onClick={executeTrade}>
          {busy ? <Loader2 className="spin" size={14} /> : <RefreshCw size={14} />}
          {txState === "simulating" ? "Checking safety limits" : txState === "pending" ? "Confirm in wallet" : txState === "submitted" ? "Executing trade" : "Execute partial trade"}
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
            <strong>{overdueRewardCanBeSettled && !hasStoredReward ? "Calculated on claim" : vault.claimableChallengeRewardShares}</strong>
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

function SafetyLimits({ vault }: { vault: VaultView; onRefresh: () => Promise<unknown> }) {
  const limits = [
    ["Maximum turnover", bpsToPercent(vault.maxTurnoverBps), "Per rebalance, of NAV"],
    ["Maximum NAV loss", bpsToPercent(vault.maxNavLossBps), "Atomic revert threshold"],
    ["Maximum target deviation", `+/- ${bpsToPercent(vault.maxWeightDeviationBps)}`, "From oracle-priced actual weight"],
    ["Challenge deviation", `+/- ${bpsToPercent(vault.challengeWeightDeviationBps)}`, "Permissionless escalation threshold"],
    ["Maximum assets", String(vault.maxAssetCount), "Concurrent positions"],
    ["Maximum individual weight", bpsToPercent(vault.maxSingleAssetWeightBps), "Single-position cap"],
    ["Minimum nonzero weight", bpsToPercent(vault.minNonZeroAssetWeightBps), "Dust threshold"],
    ["Oracle max staleness", `${vault.maxOracleStaleness}s`, "Freshness required at execution"],
    ["Strategy change cooldown", formatCooldown(vault.cooldownSeconds), "Starts after completion"],
    ["Strategy activation delay", "48 hours", "Holder exit window"],
  ] as const;

  return (
    <SectionCard
      title="Safety limits"
      subtitle="Immutable at deployment"
      icon={<ShieldCheck size={15} />}
      action={<span className="stateBadge muted"><LockKeyhole size={11} /> Immutable</span>}
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
  description: string;
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
  connectedAddress,
  isTestnet,
  aumLoading,
  onManageVault,
  onOpenVault,
  onCreateVault,
}: {
  currentVault: VaultView;
  vaults: VaultSummary[];
  connectedAddress?: string;
  isTestnet: boolean;
  aumLoading: boolean;
  onManageVault: (address: `0x${string}`) => void;
  onOpenVault: (address: `0x${string}`) => void;
  onCreateVault: () => void;
}) {
  const [query, setQuery] = useState("");

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
  const managedVaults = connectedAddress
    ? vaults.filter(
        (row) => row.manager?.toLowerCase() === connectedAddress.toLowerCase(),
      )
    : [];
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
        actions={
          <button className="primaryAction" type="button" disabled={!isTestnet} onClick={onCreateVault}>
            <Plus size={14} />
            {isTestnet ? "Create OTF" : "Mainnet unavailable"}
          </button>
        }
      />

      <DataProvenance vault={currentVault} factory />

      <div className="directoryMetrics">
        <MetricCard label="Total AUM" value={totalAum} icon={null} />
        <MetricCard label="OTFs" value={String(vaults.length)} icon={null} />
        <MetricCard label="Supported RWA Assets" value={isTestnet ? String(testnetCreateAssets.length) : "0"} icon={null} />
      </div>

      {managedVaults.length ? (
        <section className="sectionCard managedVaultsPanel">
          <div className="managedVaultsHeading">
            <div>
              <span className="appPageIcon"><UserCog size={16} /></span>
              <div>
                <h2>OTFs you manage</h2>
                <p>Manager controls and protocol operations for OTFs created by this wallet.</p>
              </div>
            </div>
            <span className="stateBadge success">{managedVaults.length} OTF{managedVaults.length === 1 ? "" : "s"}</span>
          </div>
          <div className="directoryTableWrap">
            <table className="directoryTable managedDirectoryTable">
              <thead>
                <tr>
                  <th>OTF</th>
                  <th>NAV</th>
                  <th>Assets</th>
                  <th>Creator fee</th>
                  <th>Manager</th>
                  <th />
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
                        <span>{symbolMonogram(row.symbol)}</span>
                        <div>
                          <strong>{row.name}</strong>
                          <small>{row.symbol} · {shortAddress(row.address)}</small>
                        </div>
                      </div>
                    </td>
                    <td data-label="NAV">{row.nav ?? "Oracle read failed"}</td>
                    <td data-label="Assets">{row.assetCount}</td>
                    <td data-label="Creator fee">{bpsToPercent(row.creatorFeeBps)}</td>
                    <td data-label="Manager" className="monoValue">{shortAddress(row.manager)}</td>
                    <td>
                      <div className="managedTableActions">
                        <button className="primaryAction" type="button" onClick={(event) => {
                          event.stopPropagation();
                          onManageVault(row.address);
                        }}>
                          <UserCog size={14} />
                          Manage
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="sectionCard directoryPanel">
        <div className="directoryPanelHeading">
          <div>
            <h2>All OTFs</h2>
            <p>{isTestnet ? "Public OTFs remain discoverable whether or not you manage them." : "Robinhood Mainnet support has not launched yet."}</p>
          </div>
          <div className="directoryPanelMeta">
            <span className="stateBadge muted">{vaults.length} OTF{vaults.length === 1 ? "" : "s"}</span>
          </div>
        </div>
        <div className="directoryToolbar">
          <label className="searchField">
            <Search size={14} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by OTF name or symbol" />
          </label>
        </div>

        <div className="directoryTableWrap">
          <table className="directoryTable">
            <thead>
              <tr>
                <th>OTF</th>
                <th>NAV</th>
                <th>Assets</th>
                <th>Creator fee</th>
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
                      <span>{symbolMonogram(row.symbol)}</span>
                      <div>
                        <strong>{row.name}</strong>
                        <small>{row.symbol} · {shortAddress(row.address)}</small>
                      </div>
                    </div>
                  </td>
                  <td data-label="NAV">{row.nav ?? "Oracle read failed"}</td>
                  <td data-label="Assets">{row.assetCount}</td>
                  <td data-label="Creator fee">{bpsToPercent(row.creatorFeeBps)}</td>
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
  oraclePrices,
  onBack,
  onCreated,
}: {
  connectedAddress?: string;
  isTestnet: boolean;
  oraclePrices: CatalogOraclePrices;
  onBack: () => void;
  onCreated: (address: `0x${string}`, transactionHash: `0x${string}`) => void;
}) {
  const factoryAddress = configuredFactoryAddress();
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
  const [currentTimestamp, setCurrentTimestamp] = useState(() => BigInt(Math.floor(Date.now() / 1_000)));
  const [draft, setDraft] = useState({
    name: "",
    symbol: "OTF-",
    rationale: "",
    manager: connectedAddress ?? "",
    feeRecipient: connectedAddress ?? "",
    creatorFee: "0.50",
    initialShares: "100",
    initialPortfolioValue: "5",
    maxTurnover: "30",
    maxNavLoss: "2",
    maxDeviation: "2",
    challengeDeviation: "5",
    challengeGraceDays: "5",
    maxSingleWeight: "50",
    minNonzeroWeight: "1",
    maxAssets: "10",
    oracleStaleness: "1800",
  });
  const [portfolio, setPortfolio] = useState<TargetAsset[]>(
    testnetCreateAssets.map((asset) => ({
      ticker: asset.symbol,
      address: asset.address,
      targetWeight: 100 / testnetCreateAssets.length,
      initialAmount: "",
    })),
  );
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
  const { data: oracleRegistryAddress, isError: oracleRegistryReadFailed } = useReadContract({
    address: factoryAddress,
    abi: factoryDependencyAbi,
    functionName: "oracleRegistry",
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(isTestnet && factoryAddress) },
  });
  const canReadProtocolAssets = Boolean(oracleRegistryAddress);
  const protocolAssetContracts = canReadProtocolAssets
    ? portfolio.map((asset) => ({
        address: oracleRegistryAddress as `0x${string}`,
        abi: protocolAssetReadAbi,
        functionName: "priceFeedFor" as const,
        args: [asset.address as `0x${string}`],
        chainId: robinhoodChainTestnet.id,
      }))
    : [];
  const {
    data: protocolAssetResults,
    isLoading: protocolAssetsLoading,
    isError: protocolAssetsReadFailed,
  } = useReadContracts({
    contracts: protocolAssetContracts,
    query: { enabled: canReadProtocolAssets },
  });
  const protocolAssetReadFailed = Boolean(protocolAssetResults?.some((result) => result?.error !== undefined));
  const protocolAssetResultReady = Boolean(
    canReadProtocolAssets &&
    !protocolAssetsLoading &&
    !protocolAssetReadFailed &&
    !oracleRegistryReadFailed &&
    protocolAssetResults &&
    protocolAssetResults.length === protocolAssetContracts.length &&
    protocolAssetResults.every((result) => result?.error === undefined && result?.status === "success"),
  );
  const steps = [
    { label: "Basics", description: "Identity and roles" },
    { label: "Portfolio", description: "Assets and weights" },
    { label: "Safety", description: "Immutable limits" },
    { label: "Review", description: "Confirm deployment" },
  ];
  const totalWeight = portfolio.reduce((sum, asset) => sum + Number(asset.targetWeight || 0), 0);
  const targetWeightBps = portfolio.map((asset) => percentToBps(asset.targetWeight));
  const totalWeightBps = targetWeightBps.reduce((sum, weight) => sum + weight, 0);
  const totalWeightValid = totalWeightBps === 10_000;
  let initialPortfolioValue: bigint | undefined;
  try {
    initialPortfolioValue = Number(draft.initialPortfolioValue) > 0
      ? parseUnits(draft.initialPortfolioValue, 18)
      : undefined;
  } catch {
    initialPortfolioValue = undefined;
  }
  const derivedSeedAmounts = portfolio.map((asset, index) => {
    const price = oraclePrices[asset.address.toLowerCase()];
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
  const oracleStaleness = Number(draft.oracleStaleness);
  const configuredMaxOracleAge = Number.isInteger(oracleStaleness) && oracleStaleness > 0
    ? BigInt(oracleStaleness)
    : 0n;
  const staleSeedAssets = portfolio.filter((asset, index) => {
    const updatedAt = derivedSeedAmounts[index]?.price?.updatedAt;
    return updatedAt !== undefined && updatedAt > 0n && configuredMaxOracleAge > 0n
      ? currentTimestamp > updatedAt + configuredMaxOracleAge
      : false;
  });
  const seedOracleFreshnessReady = derivedSeedAmounts.every((seed) => {
    const updatedAt = seed.price?.updatedAt;
    return updatedAt !== undefined && updatedAt > 0n && configuredMaxOracleAge > 0n
      ? currentTimestamp <= updatedAt + configuredMaxOracleAge
      : false;
  });
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
    const priceFeed = protocolAssetResultReady
      ? resultAt<string>(protocolAssetResults as ReadResult | undefined, index)
      : undefined;
    const hasPriceFeed = Boolean(priceFeed && priceFeed !== "0x0000000000000000000000000000000000000000");
    const oracleUpdatedAt = derivedSeedAmounts[index]?.price?.updatedAt;
    return {
      ...asset,
      initialAmount: derivedSeedAmounts[index]?.displayAmount ?? "",
      requiredAmount,
      approvalAmount,
      balance,
      allowance,
      priceFeed,
      hasPriceFeed,
      oracleUpdatedAt,
      oracleFresh: oracleUpdatedAt !== undefined
        && oracleUpdatedAt > 0n
        && configuredMaxOracleAge > 0n
        && currentTimestamp <= oracleUpdatedAt + configuredMaxOracleAge,
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
  const protocolAssetReadsReady =
    protocolAssetResultReady &&
    seedAuthorizations.every((asset) => asset.hasPriceFeed);
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
  const basicsValid =
    draft.name.trim().length > 2 &&
    /^OTF-[A-Z0-9][A-Z0-9-]*$/.test(draft.symbol) &&
    draft.rationale.trim().length > 20 &&
    isAddress(draft.manager) &&
    isAddress(draft.feeRecipient);
  const portfolioValid =
    portfolio.length > 0 &&
    portfolio.every(
      (asset) =>
        asset.ticker.trim() &&
        isAddress(asset.address) &&
        asset.targetWeight > 0,
    ) &&
    totalWeightValid &&
    initialPortfolioValue !== undefined &&
    allSeedAmountsReady;
  const oracleStalenessValid =
    Number.isInteger(oracleStaleness) && oracleStaleness >= 1 && oracleStaleness <= 3_600;
  const challengeGraceDays = Number(draft.challengeGraceDays);
  const challengeGraceValid =
    Number.isInteger(challengeGraceDays) && challengeGraceDays >= 5 && challengeGraceDays <= 30;
  const remainingSafetyLimitsValid =
    Number(draft.creatorFee) >= 0 &&
    Number(draft.creatorFee) <= 10 &&
    Number(draft.initialShares) > 0 &&
    Number(draft.maxTurnover) > 0 &&
    Number(draft.maxNavLoss) > 0 &&
    Number(draft.maxDeviation) > 0 &&
    Number(draft.challengeDeviation) > Number(draft.maxDeviation) &&
    Number(draft.maxSingleWeight) <= 100 &&
    Number(draft.minNonzeroWeight) > 0 &&
    Number(draft.maxAssets) >= portfolio.length;
  const safetyValid = remainingSafetyLimitsValid && oracleStalenessValid && challengeGraceValid;
  const basicsIssues = [
    draft.name.trim().length > 2 ? null : "Enter an OTF name with at least 3 characters.",
    /^OTF-[A-Z0-9][A-Z0-9-]*$/.test(draft.symbol) ? null : "Add a ticker suffix after OTF-.",
    draft.rationale.trim().length > 20 ? null : "Write an initial strategy rationale with at least 21 characters.",
    isAddress(draft.manager) ? null : "Provide a valid manager address.",
    isAddress(draft.feeRecipient) ? null : "Provide a valid fee-recipient address.",
  ].filter((issue): issue is string => Boolean(issue));
  const portfolioIssues = [
    portfolio.length > 0 ? null : "Add at least one asset.",
    portfolio.every((asset) => asset.targetWeight > 0) ? null : "Every asset needs a positive target weight.",
    initialPortfolioValue !== undefined ? null : "Enter a positive initial portfolio value.",
    allSeedAmountsReady ? null : "Wait for valid oracle prices before continuing.",
    totalWeightValid ? null : `Adjust target weights to exactly 100%. Current total: ${(totalWeightBps / 100).toFixed(2)}%.`,
  ].filter((issue): issue is string => Boolean(issue));
  const safetyIssues = [
    Number(draft.creatorFee) <= 10 ? null : "The manager fee cannot exceed 10% per year.",
    Number(draft.initialShares) > 0 ? null : "Enter a positive initial share supply.",
    Number(draft.maxAssets) >= portfolio.length ? null : "Maximum assets cannot be lower than the initial portfolio size.",
    oracleStalenessValid ? null : "Oracle max staleness must be between 1 and 3,600 seconds.",
    challengeGraceValid ? null : "Challenge grace period must be between 5 and 30 whole days.",
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
    Boolean(connectedAddress) &&
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
  if (!connectedAddress) deploymentBlockers.push("Connect wallet");
  if (!seedBalancesSufficient) deploymentBlockers.push("Fund seed assets");
  if (!seedAllowancesSufficient) deploymentBlockers.push("Approve seed assets");
  if (!protocolAssetReadsReady) deploymentBlockers.push("Oracle feeds must be configured for seed assets");
  if (!seedOracleFreshnessReady) deploymentBlockers.push("Oracle prices are stale");
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
    const interval = window.setInterval(() => {
      setCurrentTimestamp(BigInt(Math.floor(Date.now() / 1_000)));
    }, 15_000);
    return () => window.clearInterval(interval);
  }, []);

  if (!isTestnet) {
    return (
      <div className="appView">
        <AppPageHeader
          title="Create OTF"
          description="Deploy an onchain traded fund with immutable safety bounds."
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

  function updateDraft(field: keyof typeof draft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function updatePortfolio(index: number, patch: Partial<TargetAsset>) {
    setPortfolio((current) => current.map((asset, itemIndex) => itemIndex === index ? { ...asset, ...patch } : asset));
  }

  function addPortfolioAsset() {
    if (!nextAvailableAsset) return;
    setPortfolio((current) => [
      ...current,
      {
        ticker: nextAvailableAsset.symbol,
        address: nextAvailableAsset.address,
        targetWeight: 0,
        initialAmount: "",
      },
    ]);
  }

  function vaultInitParams() {
    if (!isAddress(draft.manager) || !isAddress(draft.feeRecipient)) {
      throw new Error("Manager and fee-recipient addresses must be valid.");
    }
    const initialAssets = portfolio.map((asset) => {
      if (!isAddress(asset.address)) throw new Error(`${asset.ticker || "Asset"} has an invalid token address.`);
      return asset.address;
    });

    return {
      name: draft.name.trim(),
      symbol: draft.symbol.trim(),
      initialStrategyRationale: draft.rationale.trim(),
      manager: draft.manager,
      feeRecipient: draft.feeRecipient,
      initialAssets,
      initialTargetWeightsBps: targetWeightBps,
      initialAmounts: derivedSeedAmounts.map((seed, index) => {
        if (seed.requiredAmount === undefined || seed.requiredAmount <= 0n) {
          throw new Error(`${portfolio[index]?.ticker ?? "Asset"} seed amount is unavailable.`);
        }
        return seed.requiredAmount;
      }),
      initialShareSupply: parseUnits(draft.initialShares, 18),
      creatorFeeBpsPerYear: percentToBps(draft.creatorFee),
      maxTurnoverBps: percentToBps(draft.maxTurnover),
      maxNavLossBps: percentToBps(draft.maxNavLoss),
      maxWeightDeviationBps: percentToBps(draft.maxDeviation),
      challengeWeightDeviationBps: percentToBps(draft.challengeDeviation),
      maxSingleAssetWeightBps: percentToBps(draft.maxSingleWeight),
      minNonZeroAssetWeightBps: percentToBps(draft.minNonzeroWeight),
      maxAssetCount: Number(draft.maxAssets),
      maxOracleStaleness: Number(draft.oracleStaleness),
      challengeGracePeriod: daysToSeconds(draft.challengeGraceDays),
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
        description="Deploy an onchain traded fund with immutable safety bounds."
        icon={<FilePlus2 size={18} />}
      />

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
            <span>Portfolio limits and the change unlock become immutable after deployment.</span>
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
                    <input value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} placeholder="Technology Leaders OTF" />
                    <small>The name cannot be changed after deployment.</small>
                  </label>
                  <label>
                    <span>OTF ticker</span>
                    <div className="tickerInput">
                      <span>OTF-</span>
                      <input
                        value={draft.symbol.slice(4)}
                        onChange={(event) => {
                          const suffix = event.target.value
                            .toUpperCase()
                            .replace(/[^A-Z0-9-]/g, "")
                            .slice(0, 16);
                          updateDraft("symbol", `OTF-${suffix}`);
                        }}
                        placeholder="TECH"
                        aria-label="OTF ticker suffix"
                      />
                    </div>
                    <small>The OTF- prefix is fixed, and the ticker cannot be changed after deployment.</small>
                  </label>
                </div>
                <label>
                  <span>Initial strategy rationale</span>
                  <textarea value={draft.rationale} onChange={(event) => updateDraft("rationale", event.target.value)} rows={4} placeholder="Describe the portfolio mandate and investment rationale." />
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
                        ? "Custom address receives accrued creator-fee shares."
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
                    <span>Select from the testnet catalog. Valuation uses self-updating synthetic USD feeds.</span>
                  </div>
                  <span className={`stateBadge ${totalWeightValid ? "success" : "danger"}`}>Total {totalWeight.toFixed(1)}%</span>
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
                  {portfolio.map((asset, index) => (
                    <div className="createAssetRow" key={`${asset.ticker}-${index}`}>
                      <label className="assetSelectField">
                        <span>Asset</span>
                        <div className="createAssetPicker">
                          <AssetLogo logoUrl={catalogAssetForAddress(asset.address)?.logoUrl} symbol={asset.ticker} compact />
                          <span className="createAssetPickerIdentity">
                            <strong>{asset.ticker}</strong>
                            <small>{catalogAssetForAddress(asset.address)?.name ?? "Supported asset"}</small>
                          </span>
                          <ChevronDown aria-hidden="true" size={14} />
                          <select
                            aria-label={`Asset ${index + 1}`}
                            value={asset.address}
                            onChange={(event) => {
                              const selected = testnetCreateAssets.find((candidate) => candidate.address === event.target.value);
                              if (selected) {
                                updatePortfolio(index, { ticker: selected.symbol, address: selected.address });
                              }
                            }}
                          >
                            {testnetCreateAssets.map((candidate) => (
                              <option
                                key={candidate.address}
                                value={candidate.address}
                                disabled={portfolio.some(
                                  (portfolioAsset, assetIndex) =>
                                    assetIndex !== index && portfolioAsset.address === candidate.address,
                                )}
                              >
                                {candidate.symbol} · {candidate.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <small className="assetAddressLabel" title={asset.address}>Token: {shortAssetAddress(asset.address)}</small>
                      </label>
                      <label className="assetWeightField">
                        <span>Target weight</span>
                        <div className="inputWithSuffix">
                          <input type="number" min={0} max={100} value={asset.targetWeight} onChange={(event) => updatePortfolio(index, { targetWeight: Number(event.target.value) })} />
                          <span>%</span>
                        </div>
                      </label>
                      <div className="assetOraclePriceField">
                        <span>Oracle price</span>
                        <strong>{derivedSeedAmounts[index]?.price?.display ?? "Loading"}</strong>
                        <small>{derivedSeedAmounts[index]?.displayTargetValue} allocation</small>
                      </div>
                      <div className="assetSeedField">
                        <span>Seed tokens</span>
                        <strong>{derivedSeedAmounts[index]?.displayAmount || "Loading"}</strong>
                        <small>{asset.ticker} required</small>
                      </div>
                      <button type="button" title={`Remove ${asset.ticker}`} onClick={() => setPortfolio((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  className="secondaryAction"
                  type="button"
                  onClick={addPortfolioAsset}
                  disabled={!nextAvailableAsset || portfolio.length >= Number(draft.maxAssets)}
                >
                  <Plus size={14} />
                  Add asset
                </button>
                {!portfolioValid ? (
                  <div className="riskCallout warning">
                    <AlertTriangle size={15} />
                    <div><strong>Portfolio needs attention</strong><span>Set a positive initial value, use positive weights totaling exactly 100%, and wait for oracle prices.</span></div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {step === 2 ? (
              <div className="formSection">
                <div className="formGrid threeColumns">
                  <label><span>Manager fee</span><div className="inputWithSuffix"><input type="number" min={0} max={10} value={draft.creatorFee} onChange={(event) => updateDraft("creatorFee", event.target.value)} /><span>% / yr</span></div><small>Annual fee minted as OTF shares. Protocol range: 0–10% per year.</small></label>
                  <label><span>Initial shares</span><input type="number" min={1} value={draft.initialShares} onChange={(event) => updateDraft("initialShares", event.target.value)} /><small>Sets the initial OTF share supply. 0.000000000001 share is permanently locked; the manager receives the entered amount minus that share.</small></label>
                  <label><span>Maximum assets</span><input type="number" min={portfolio.length} max={20} value={draft.maxAssets} onChange={(event) => updateDraft("maxAssets", event.target.value)} /><small>Caps the number of portfolio constituents. Protocol range: {portfolio.length}–20 for this initial basket.</small></label>
                  <label><span>Maximum turnover</span><div className="inputWithSuffix"><input type="number" min={0} max={100} value={draft.maxTurnover} onChange={(event) => updateDraft("maxTurnover", event.target.value)} /><span>% NAV</span></div><small>Caps the oracle-valued volume traded in each partial rebalance. Protocol maximum: 100% of NAV.</small></label>
                  <label><span>Maximum NAV loss</span><div className="inputWithSuffix"><input type="number" min={0} max={10} value={draft.maxNavLoss} onChange={(event) => updateDraft("maxNavLoss", event.target.value)} /><span>%</span></div><small>Caps the value an OTF may lose during each partial rebalance. Protocol maximum: 10%.</small></label>
                  <label><span>Completion band</span><div className="inputWithSuffix"><input type="number" min={0.01} max={10} value={draft.maxDeviation} onChange={(event) => updateDraft("maxDeviation", event.target.value)} /><span>+/- %</span></div><small>Every asset must enter this distance from its target to complete. Protocol range: above 0% to 10%.</small></label>
                  <label><span>Challenge band</span><div className="inputWithSuffix"><input type="number" min={0.01} max={25} value={draft.challengeDeviation} onChange={(event) => updateDraft("challengeDeviation", event.target.value)} /><span>+/- %</span></div><small>Defines when an out-of-band portfolio can be challenged. Must exceed the completion band; protocol maximum: 25%.</small></label>
                  <label><span>Challenge grace period</span><div className="inputWithSuffix"><input type="number" min={5} max={30} value={draft.challengeGraceDays} onChange={(event) => updateDraft("challengeGraceDays", event.target.value)} /><span>days</span></div><small>Time allowed to restore the portfolio after a challenge. Protocol range: 5–30 whole days.</small></label>
                  <label><span>Maximum single weight</span><div className="inputWithSuffix"><input type="number" min={0} max={100} value={draft.maxSingleWeight} onChange={(event) => updateDraft("maxSingleWeight", event.target.value)} /><span>%</span></div><small>Caps any asset’s target allocation. Protocol maximum: 100%; it cannot be below the minimum nonzero weight.</small></label>
                  <label><span>Minimum nonzero weight</span><div className="inputWithSuffix"><input type="number" min={0.01} max={100} value={draft.minNonzeroWeight} onChange={(event) => updateDraft("minNonzeroWeight", event.target.value)} /><span>%</span></div><small>Prevents dust-sized target allocations. Protocol range: above 0% to 100%; it cannot exceed the maximum single weight.</small></label>
                  <label><span>Oracle max staleness</span><div className="inputWithSuffix"><input type="number" min={1} max={3600} step={60} value={draft.oracleStaleness} onChange={(event) => updateDraft("oracleStaleness", event.target.value)} /><span>seconds</span></div><small>Rejects rebalance valuations older than this. Protocol range: 1–3,600 seconds; default: 30 minutes.</small></label>
                </div>
                <div className="executionPolicy createGuarantees">
                  <ShieldCheck size={14} />
                  <div>
                    <strong>Trade execution remains constrained</strong>
                    <span>Strategy changes unlock 14 days after the previous rebalance completes. Each partial trade uses current constituents, approved adapters, oracle limits, exact temporary approvals, and must move the basket closer to target.</span>
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
                  <div><h2>{draft.name}</h2><span>{draft.symbol} · {portfolio.length} assets · {draft.creatorFee}% annual manager fee</span></div>
                </div>
                <div className="reviewGrid">
                  <div className="reviewKeyMetric"><span>Annual manager fee</span><strong>{draft.creatorFee}%</strong></div>
                  <div><span>Manager</span><strong>{shortAddress(draft.manager)}</strong></div>
                  <div><span>Fee recipient</span><strong>{shortAddress(draft.feeRecipient)}</strong></div>
                  <div><span>Initial value</span><strong>{Number(draft.initialPortfolioValue) > 0 ? formatOraclePrice(Number(draft.initialPortfolioValue)) : "Not set"}</strong></div>
                  <div><span>Strategy cooldown</span><strong>14 days after deployment or completion</strong></div>
                  <div><span>Maximum turnover</span><strong>{draft.maxTurnover}%</strong></div>
                  <div><span>Maximum NAV loss</span><strong>{draft.maxNavLoss}%</strong></div>
                  <div><span>Completion band</span><strong>+/- {draft.maxDeviation}%</strong></div>
                  <div><span>Challenge band</span><strong>+/- {draft.challengeDeviation}%</strong></div>
                  <div><span>Challenge grace</span><strong>{draft.challengeGraceDays} days</strong></div>
                  <div><span>Oracle staleness</span><strong>{formatCooldown(Number(draft.oracleStaleness))}</strong></div>
                </div>
                <div>
                  <div className="subHeader"><span>Initial portfolio</span><small>Total {(totalWeightBps / 100).toFixed(2)}%</small></div>
                  <div className="reviewPortfolio">
                    {portfolio.map((asset, index) => <span key={asset.address}><AssetLogo logoUrl={catalogAssetForAddress(asset.address)?.logoUrl} symbol={asset.ticker} compact /><strong>{asset.ticker}</strong>{asset.targetWeight.toFixed(1)}% / {derivedSeedAmounts[index]?.displayAmount || "Loading"} seed</span>)}
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
                            <AssetLogo logoUrl={catalogAssetForAddress(asset.address)?.logoUrl} symbol={asset.ticker} />
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
                              oracleRegistryReadFailed || protocolAssetReadFailed
                                ? "danger"
                                : asset.priceFeed === undefined
                                  ? "muted"
                                  : asset.hasPriceFeed && asset.oracleFresh ? "success" : "danger"
                            }`}>
                              {oracleRegistryReadFailed || protocolAssetReadFailed
                                ? "Feed read failed"
                                : asset.priceFeed === undefined
                                  ? "Checking feed"
                                  : !asset.hasPriceFeed
                                    ? "Price feed missing"
                                    : asset.oracleFresh ? "Oracle price fresh" : "Oracle price stale"}
                            </span>
                          </div>
                          {asset.allowanceSufficient ? (
                            <span className="seedApprovalComplete"><CheckCircle size={14} /> Seed allowance ready</span>
                          ) : (
                            <button
                              className="secondaryAction seedApprovalAction"
                              type="button"
                              disabled={
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
                  {connectedAddress && seedAuthorizations.some(
                    (asset) => protocolAssetResultReady && asset.priceFeed !== undefined && !asset.hasPriceFeed,
                  ) ? (
                    <div className="validationSummary danger" role="alert">
                      <AlertTriangle size={15} />
                      <div>
                        <strong>Oracle feed is incomplete</strong>
                        <span>Selected assets must have configured oracle feeds before this OTF can be deployed.</span>
                      </div>
                    </div>
                  ) : null}
                  {connectedAddress && staleSeedAssets.length ? (
                    <div className="validationSummary danger" role="alert">
                      <Clock3 size={15} />
                      <div>
                        <strong>{staleSeedAssets.map((asset) => asset.ticker).join(", ")} oracle prices are stale</strong>
                        <span>Self-updating testnet feeds should remain current. This deployment may still reference a legacy feed; reconfigure the testnet catalog before creating this OTF.</span>
                      </div>
                    </div>
                  ) : null}
                  {connectedAddress && (seedAuthorizationsFailed || oracleRegistryReadFailed || protocolAssetsReadFailed || protocolAssetReadFailed) ? (
                    <div className="validationSummary danger" role="alert">
                      <RefreshCw size={15} />
                      <div><strong>Preflight checks could not be loaded</strong><span>Check the testnet connection, then reload these contract reads before approving or deploying.</span></div>
                    </div>
                  ) : null}
                </div>
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
                  <div><strong>Review immutable settings carefully</strong><span>The manager cannot weaken safety limits or shorten the portfolio change unlock after deployment.</span></div>
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
}: {
  connectedAddress?: string;
  vaults: VaultSummary[];
  isTestnet: boolean;
  onBrowseVaults: () => void;
  onOpenVault: (address: `0x${string}`) => void;
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
            <div className="directoryPanelHeading">
              <div><h2>OTF positions</h2><p>Shares held by the connected wallet.</p></div>
              <span className="stateBadge muted">{positions.length} position{positions.length === 1 ? "" : "s"}</span>
            </div>
            {positions.length ? <div className="directoryTableWrap"><table className="directoryTable depositsTable">
              <thead><tr><th>OTF</th><th>Shares</th><th>NAV / share</th></tr></thead>
              <tbody>{positions.map((position) => <tr key={position.address} role="button" tabIndex={0} onClick={() => onOpenVault(position.address)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onOpenVault(position.address); }}>
                <td><div className="directoryVault"><span>{symbolMonogram(position.symbol)}</span><div><strong>{position.name}</strong><small>{position.symbol}</small></div></div></td>
                <td data-label="Shares" className="monoValue">{position.displayBalance}</td>
                <td data-label="NAV / share">{position.navPerShare ?? "Unavailable"}</td>
              </tr>)}</tbody>
            </table></div> : <div className="inlineEmptyState"><CircleDollarSign size={18} /><div><strong>No OTF positions found</strong><span>Your OTF shares will appear here after a purchase or deposit.</span></div></div>}
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

function RwaCatalogView({ isTestnet, oraclePrices }: { isTestnet: boolean; oraclePrices: CatalogOraclePrices }) {
  return (
    <div className="appView">
      <AppPageHeader
        title="Supported RWAs"
        description="Tokenized assets available to OTF strategies on Robinhood Chain."
        icon={<Landmark size={18} />}
        actions={isTestnet ? <a className="secondaryAction" href="https://faucet.testnet.chain.robinhood.com/" target="_blank" rel="noreferrer"><Droplets size={14} />Testnet faucet<ExternalLink size={12} /></a> : undefined}
      />
      {!isTestnet ? (
        <section className="sectionCard depositsEmpty"><span><Network size={22} /></span><h2>Mainnet assets are not supported yet</h2><p>Switch on Testnet mode in Settings to inspect the current RWA catalog.</p></section>
      ) : (
        <section className="sectionCard walletAssets">
          <div className="directoryPanelHeading"><div><h2>RWA catalog</h2><p>Token contracts and live oracle prices.</p></div><span className="stateBadge success">{testnetCreateAssets.length} supported</span></div>
          <div className="directoryTableWrap"><table className="directoryTable rwaCatalogTable">
            <thead><tr><th>Asset</th><th>Token address</th><th>Liquidity pool</th><th>Oracle price</th></tr></thead>
            <tbody>{testnetCreateAssets.map((asset) => {
              const pool = configuredConstituentPool(asset.address);
              return (
                <tr key={asset.address}>
                  <td><div className="rwaAssetIdentity"><AssetLogo logoUrl={asset.logoUrl} symbol={asset.symbol} /><div><strong>{asset.symbol}</strong><small>{asset.name}</small></div></div></td>
                  <td data-label="Token address" className="monoValue">
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
                  <td data-label="Liquidity pool" className="monoValue">
                    {pool ? (
                      <a
                        className="tableAddressLink"
                        href={`${robinhoodChainTestnet.blockExplorers.default.url}/address/${pool}`}
                        target="_blank"
                        rel="noreferrer"
                        title={`Open ${asset.symbol} / USDG liquidity pool ${pool}`}
                      >
                        {shortAssetAddress(pool)}
                        <ExternalLink size={11} />
                      </a>
                    ) : "Not configured"}
                  </td>
                  <td data-label="Oracle price" className="monoValue">{oraclePrices[asset.address.toLowerCase()]?.display ?? "Loading"}</td>
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
  const registry = configuredV3MarketRegistryAddress();
  const settlementToken = configuredSettlementTokenAddress();
  const { data: officialPoolResult, isLoading: poolLoading } = useReadContract({
    address: registry,
    abi: otfV3MarketRegistryAbi,
    functionName: "officialPool",
    args: vault.address ? [vault.address] : undefined,
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(registry && vault.address) },
  });
  const pool = officialPoolResult && officialPoolResult !== zeroAddress
    ? officialPoolResult as `0x${string}`
    : undefined;
  const { data: liquidity, isLoading: liquidityLoading, isError: liquidityError } = useReadContract({
    address: pool,
    abi: uniswapV3PoolAbi,
    functionName: "liquidity",
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(pool) },
  });
  const liquidityAvailable = typeof liquidity === "bigint" && liquidity > 0n;
  const checking = poolLoading || (Boolean(pool) && liquidityLoading);
  const testnetUsesSynthra = robinhoodTestnetV3Venue.provider === "synthra";
  const addLiquidityUrl = testnetUsesSynthra
    ? vault.address ? `/liquidity?vault=${vault.address}` : "/liquidity"
    : vault.address && settlementToken
      ? `https://app.uniswap.org/positions/create/v3?currencyA=${vault.address}&currencyB=${settlementToken}&fee=500`
      : "https://app.uniswap.org/positions/create";

  return (
    <SectionCard
      title={`${vault.symbol} liquidity pool`}
      subtitle={`${testnetUsesSynthra ? "Synthra" : "Uniswap"} V3 market for ${vault.symbol}`}
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
            <strong>Immutable official market</strong>
            <span>This OTF is permanently paired with USDG at the 0.05% fee tier. The manager cannot remove, replace, or change the pool association.</span>
          </div>
        </div>

        {!registry ? (
          <div className="validationSummary danger" role="alert">
            <AlertTriangle size={15} />
            <div><strong>Liquidity pool registry is not configured</strong><span>Add the registry address to the Robinhood testnet address JSON to load this OTF&apos;s market.</span></div>
          </div>
        ) : null}

        {pool ? (
          <>
            <div className="roleCurrent">
              <span>Official OTF / USDG pool</span>
              <strong><a href={`${robinhoodChainTestnet.blockExplorers.default.url}/address/${pool}`} target="_blank" rel="noreferrer">{shortAddress(pool)} <ExternalLink size={11} /></a></strong>
            </div>
            <div className="accrualSummary">
              <div><span>Fee tier</span><strong>0.05%</strong></div>
              <div><span>Pool association</span><strong>Permanent</strong></div>
              <div><span>Position ownership</span><strong>Liquidity providers</strong></div>
              <div><span>Active liquidity</span><strong>{liquidityLoading ? "Checking" : liquidityError ? "Read unavailable" : liquidityAvailable ? "Available" : "Zero"}</strong></div>
            </div>
            {!liquidityLoading && !liquidityError && !liquidityAvailable ? (
              <div className="validationSummary warning">
                <AlertTriangle size={15} />
                <div><strong>Secondary-market trading is not active yet</strong><span>The liquidity pool exists, but direct OTF / USDG trading stays disabled until someone adds liquidity.</span></div>
              </div>
            ) : null}
            <div className="riskCallout info">
              <Info size={15} />
              <div><strong>Permissionless liquidity</strong><span>Any wallet can supply OTF shares and USDG. Each resulting Uniswap position belongs to the supplying wallet and does not use assets held by the OTF portfolio.</span></div>
            </div>
            <a className="primaryAction" href={addLiquidityUrl} target={testnetUsesSynthra ? undefined : "_blank"} rel={testnetUsesSynthra ? undefined : "noreferrer"}>
              <Droplets size={14} />{testnetUsesSynthra ? "Manage liquidity" : "Add liquidity on Uniswap"}{testnetUsesSynthra ? null : <ExternalLink size={12} />}
            </a>
          </>
        ) : registry && !poolLoading ? (
          <div className="validationSummary danger" role="alert">
            <AlertTriangle size={15} />
            <div><strong>Liquidity pool was not found</strong><span>This OTF may predate automatic pool creation. Verify the deployment before accepting deposits.</span></div>
          </div>
        ) : null}
      </div>
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
  const [activeOperation, setActiveOperation] = useState<"targets" | "rebalance" | "liquidity" | "roles" | "fees">("targets");
  const { address: connectedAddress } = useAccount();
  const publicClient = usePublicClient({ chainId: robinhoodChainTestnet.id });
  const { writeContractAsync } = useWriteContract();
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
    query: { enabled: Boolean(vault.enabled && vault.address && vault.manager) },
  });
  const pendingManagerFeeShares = feeWithdrawalPreview?.result !== undefined
    ? feeWithdrawalPreview.result * BigInt(10_000 - vault.protocolFeeShareBps) / 10_000n
    : undefined;
  const pendingManagerFeeDisplay = feeWithdrawalPreviewLoading
    ? "Calculating"
    : pendingManagerFeeShares !== undefined
      ? `${formatWalletTokenBalance(pendingManagerFeeShares, 18)} ${vault.symbol}`
      : "Preview unavailable";
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

  async function transferManager() {
    if (!vault.address || !vault.connectedIsManager || !managerValid) return;
    const vaultAddress = vault.address;
    await runRoleWrite(
      () => writeContractAsync({
        address: vaultAddress,
        abi: managedOtfVaultAbi,
        functionName: "transferOwnership",
        args: [managerTarget as `0x${string}`],
        chainId: robinhoodChainTestnet.id,
      }),
      setManagerTransferState,
      setManagerTransferError,
      "The manager transfer reverted.",
      () => setManagerTarget(""),
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

      <section className="manageVaultHeader">
        <div className="vaultIdentity">
          <span className="vaultMonogram">{symbolMonogram(vault.symbol)}</span>
          <div>
            <div className="titleLine"><h2>{vault.name}</h2><span className="symbolBadge">{vault.symbol}</span></div>
            <div className="addressLine"><AddressPill label="OTF" address={vault.address} copied={copied} onCopy={copyVaultAddress} /></div>
          </div>
        </div>
        <div className="vaultMetaBadges">
          <span className={`stateBadge ${vault.connectedIsManager ? "success" : "muted"}`}>
            {vault.connectedIsManager ? "Manager connected" : "Observer mode"}
          </span>
        </div>
      </section>

      <ChallengeCountdownBanner vault={vault} />

      <DataProvenance vault={vault} />

      <div className="manageMetrics">
        <MetricCard label="Current Manager" value={shortAddress(vault.manager)} icon={<KeyRound size={14} />} />
        <MetricCard label="Fee Recipient" value={shortAddress(vault.feeRecipient)} icon={<ReceiptText size={14} />} />
        <MetricCard label="Manager Fee" value={bpsToPercent(vault.creatorFeeBps)} icon={<Percent size={14} />} />
        <MetricCard label="Strategy Cooldown" value={formatCooldown(vault.cooldownSeconds)} icon={<Clock3 size={14} />} />
      </div>

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
        <SectionCard title="Manager transfer" subtitle="Transfer strategy authority immediately" icon={<KeyRound size={15} />} action={<span className="stateBadge danger">Immediate</span>}>
          <div className="operationFlow">
            <div className="roleCurrent"><span>Current manager</span><strong>{shortAddress(vault.manager)}</strong></div>
            <label className="fieldLabel">New manager address</label>
            <input className={!managerValid && managerTarget ? "invalid" : ""} value={managerTarget} onChange={(event) => setManagerTarget(event.target.value)} placeholder="0x..." disabled={!vault.enabled || !vault.connectedIsManager} />
            <div className="riskCallout danger managerTransferWarning">
              <AlertTriangle size={17} />
              <div>
                <strong>You cannot undo this transfer from your current wallet</strong>
                <span>You will immediately lose every manager permission. The new manager can change the manager fee within the protocol cap, redirect its fee recipient, change strategy, and appoint executors.</span>
              </div>
            </div>
            <p>All current executors are cleared, then the new manager is added automatically as the sole executor.</p>
            {managerTransferError ? <div className="validationSummary danger" role="alert"><AlertTriangle size={15} /><div><strong>Manager transfer failed</strong><span>{managerTransferError}</span></div></div> : null}
            <TxStatus state={managerTransferState} />
            {vault.connectedIsManager ? <button className="dangerAction" type="button" disabled={!managerValid || managerTransferBusy} onClick={transferManager}>
              <UserCog size={14} />
              {managerTransferBusy ? "Confirming transfer" : "Transfer manager now"}
            </button> : null}
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
            <div className="accrualSummary">
              <div><span>Pending manager fees</span><strong>{pendingManagerFeeDisplay}</strong></div>
              <div><span>Manager fee</span><strong>{bpsToPercent(vault.creatorFeeBps)} / yr</strong></div>
              <div><span>Protocol cut</span><strong>{bpsToPercent(vault.protocolFeeShareBps)} of accrued fees</strong></div>
              <div><span>Historically forfeited</span><strong>{vault.forfeitedManagerFeeShares}</strong></div>
            </div>
            <p>Pending fees are calculated by simulating a withdrawal at the latest block. They are minted as OTF shares when the withdrawal confirms, with the protocol cut sent to the collector and the remainder sent to the fee recipient.</p>
            <div className="riskCallout info"><Info size={15} /><div><strong>Targets gate fee withdrawals</strong><span>If the manager tries to withdraw while the portfolio is outside challenge bands, the strategy challenge starts instead.</span></div></div>
            {feeAccrualError ? <div className="riskCallout danger"><AlertTriangle size={15} /><div><strong>Fee withdrawal failed</strong><span>{feeAccrualError}</span></div></div> : null}
            <TxStatus state={feeAccrualState} />
            <button
              className="secondaryAction"
              type="button"
              disabled={!connectedAddress || !vault.connectedIsManager || !pendingManagerFeeShares || feeAccrualState === "pending" || feeAccrualState === "submitted"}
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
            <div><CheckCircle size={14} /><span><strong>May execute partial maintenance trades</strong><small>Every batch must reduce target deviation and satisfy oracle, adapter, slippage, turnover, and exposure limits.</small></span></div>
            <div><CheckCircle size={14} /><span><strong>May propose targets with a rationale</strong><small>The rationale becomes permanent only when those targets activate.</small></span></div>
            <div><XCircle size={14} /><span><strong>Cannot withdraw portfolio assets</strong><small>No arbitrary manager-call or asset-transfer path exists.</small></span></div>
            <div><XCircle size={14} /><span><strong>Cannot shorten the change unlock</strong><small>The configured delay is permanently immutable.</small></span></div>
          </div>
        </SectionCard>
        ) : null}
      </div> : null}
    </div>
  );
}

