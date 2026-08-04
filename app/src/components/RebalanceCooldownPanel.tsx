"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { managedOtfVaultAbi, otfEntryRouterAbi, otfFactoryAbi } from "@onchaintradedfunds/generated";
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
  KeyRound,
  Landmark,
  Moon,
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
import { encodeAbiParameters, formatUnits, isAddress, parseEventLogs, parseUnits, zeroAddress } from "viem";
import {
  useAccount,
  useBalance,
  useBlockNumber,
  useChainId,
  useDisconnect,
  usePublicClient,
  useReadContract,
  useReadContracts,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { robinhoodChain, robinhoodChainTestnet } from "@/lib/chains";
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
export type AppView = "landing" | "detail" | "vaults" | "create" | "created" | "manage" | "deposits" | "rwas";
type DataMode = "live" | "empty" | "unavailable";

type Allocation = {
  symbol: string;
  name: string;
  address: string;
  targetWeightBps: number;
  actualWeightBps: number;
  tone: string;
};

type TargetAsset = {
  ticker: string;
  address: string;
  targetWeight: number;
  initialAmount: string;
};

type CatalogOraclePrice = {
  answer?: bigint;
  decimals?: number;
  updatedAt?: bigint;
  value?: number;
  display: string;
};

type CatalogOraclePrices = Record<string, CatalogOraclePrice>;

type ThesisVersionResult = {
  timestamp: bigint;
  author: `0x${string}`;
  portfolioHash: `0x${string}`;
  text: string;
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
  currentThesis: string;
  cooldownSeconds: number;
  lastPortfolioChange?: number;
  nextPortfolioChange?: number;
  canRebalance: boolean;
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
  nextStrategyChangeTime?: number;
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
  lastCompletedStrategicRebalance?: number;
  canProposeTargetWeights: boolean;
  authorizedExecutors: readonly string[];
  maxSingleAssetWeightBps: number;
  minNonZeroAssetWeightBps: number;
  maxOracleStaleness: number;
  maxAssetCount: number;
  connectedIsManager: boolean;
  enabled: boolean;
  isLoading: boolean;
  dataMode: DataMode;
  blockNumber?: bigint;
  lastReadAt?: number;
  nav?: string;
  navPerShare?: string;
  navPerShareValue?: bigint;
  factoryAddress?: `0x${string}`;
  factoryVaultCount: number;
  factoryReadFailed: boolean;
};

const navTabs = ["OTFs", "RWAs"];

const testnetCreateAssets = [
  {
    symbol: "TSLA",
    name: "Tesla",
    address: "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E",
  },
  {
    symbol: "AMZN",
    name: "Amazon",
    address: "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02",
  },
  {
    symbol: "PLTR",
    name: "Palantir Technologies",
    address: "0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0",
  },
  {
    symbol: "NFLX",
    name: "Netflix",
    address: "0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93",
  },
  {
    symbol: "AMD",
    name: "AMD",
    address: "0x71178BAc73cBeb415514eB542a8995b82669778d",
  },
] as const;

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
      { indexed: false, name: "rebalanceCooldown", type: "uint32" },
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

const uniswapV2QuoteAbi = [
  {
    type: "function",
    name: "getAmountsIn",
    stateMutability: "view",
    inputs: [
      { name: "amountOut", type: "uint256" },
      { name: "path", type: "address[]" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "getAmountsOut",
    stateMutability: "view",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "path", type: "address[]" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "factory",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "factory", type: "address" }],
  },
  {
    type: "function",
    name: "swapTokensForExactTokens",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountOut", type: "uint256" },
      { name: "amountInMax", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "swapExactTokensForTokens",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "addLiquidity",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "amountADesired", type: "uint256" },
      { name: "amountBDesired", type: "uint256" },
      { name: "amountAMin", type: "uint256" },
      { name: "amountBMin", type: "uint256" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [
      { name: "amountA", type: "uint256" },
      { name: "amountB", type: "uint256" },
      { name: "liquidity", type: "uint256" },
    ],
  },
] as const;

const uniswapV2FactoryAbi = [
  {
    type: "function",
    name: "getPair",
    stateMutability: "view",
    inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }],
    outputs: [{ name: "pair", type: "address" }],
  },
  {
    type: "function",
    name: "createPair",
    stateMutability: "nonpayable",
    inputs: [{ name: "tokenA", type: "address" }, { name: "tokenB", type: "address" }],
    outputs: [{ name: "pair", type: "address" }],
  },
] as const;

const uniswapV2PairAbi = [
  {
    type: "function",
    name: "getReserves",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "reserve0", type: "uint112" },
      { name: "reserve1", type: "uint112" },
      { name: "blockTimestampLast", type: "uint32" },
    ],
  },
] as const;

const allocationTones = ["teal", "green", "gold", "blue", "rose", "violet"];

function configuredFactoryAddress(): `0x${string}` | undefined {
  const value = process.env.NEXT_PUBLIC_FACTORY_ADDRESS;
  return value && isAddress(value) ? value : undefined;
}

function configuredEntryRouterAddress(): `0x${string}` | undefined {
  const value = process.env.NEXT_PUBLIC_ENTRY_ROUTER_ADDRESS;
  return value && isAddress(value) ? value : undefined;
}

function configuredEntryAdapterAddress(): `0x${string}` | undefined {
  const value = process.env.NEXT_PUBLIC_UNISWAP_ADAPTER_ADDRESS;
  return value && isAddress(value) ? value : undefined;
}

function configuredUniswapRouterAddress(): `0x${string}` | undefined {
  const value = process.env.NEXT_PUBLIC_UNISWAP_V2_ROUTER_ADDRESS;
  return value && isAddress(value) ? value : undefined;
}

function configuredSettlementTokenAddress(): `0x${string}` | undefined {
  const value = process.env.NEXT_PUBLIC_USDG_ADDRESS;
  return value && isAddress(value) ? value : undefined;
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

function formatWalletTokenBalance(value: bigint | undefined, decimals: number): string {
  if (value === undefined) return "—";
  const amount = Number(formatUnits(value, decimals));
  return amount.toLocaleString(undefined, { maximumFractionDigits: 6 });
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
    const catalogAsset = testnetCreateAssets.find(
      (asset) => asset.address.toLowerCase() === address.toLowerCase(),
    );
    return {
      symbol: catalogAsset?.symbol ?? `Asset ${index + 1}`,
      name: catalogAsset?.name ?? "Supported token",
      address,
      targetWeightBps: weight,
      actualWeightBps: Number(currentWeights?.[index] ?? weight),
      tone: allocationTones[index % allocationTones.length],
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
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "currentThesis" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "rebalanceCooldown" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "lastRebalanceTimestamp" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "nextRebalanceTime" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "canRebalance" },
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
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "lastCompletedStrategicRebalance" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "canProposeTargetWeights" },
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
    query: { enabled: Boolean(readContracts) && isTestnet },
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
  const currentThesis = resultAt<string>(results, 13) ?? "";
  const cooldownSeconds = Number(resultAt<number>(results, 14) ?? 7 * 86_400);
  const lastPortfolioChange = resultAt<bigint>(results, 15)
    ? Number(resultAt<bigint>(results, 15))
    : undefined;
  const nextPortfolioChange = resultAt<bigint>(results, 16)
    ? Number(resultAt<bigint>(results, 16))
    : undefined;
  const canRebalance = Boolean(resultAt<boolean>(results, 17));
  const maxSingleAssetWeightBps = resultAt<number>(results, 18) ?? 0;
  const minNonZeroAssetWeightBps = resultAt<number>(results, 19) ?? 0;
  const maxOracleStaleness = resultAt<number>(results, 20) ?? 0;
  const totalAssetsValue = resultAt<bigint>(results, 21);
  const navPerShareValue = resultAt<bigint>(results, 22);
  const currentWeights = resultAt<readonly number[] | readonly bigint[]>(results, 23);
  const challengeWeightDeviationBps = resultAt<number>(results, 24) ?? 0;
  const challengeGracePeriod = resultAt<number>(results, 25) ?? 0;
  const withinCompletionBands = Boolean(resultAt<boolean>(results, 26));
  const strategicRebalanceActive = Boolean(resultAt<boolean>(results, 27));
  const challengeActive = Boolean(resultAt<boolean>(results, 28));
  const challengeStartedAt = resultAt<bigint>(results, 29)
    ? Number(resultAt<bigint>(results, 29))
    : undefined;
  const challengeDeadline = resultAt<bigint>(results, 30)
    ? Number(resultAt<bigint>(results, 30))
    : undefined;
  const challengeTimeRemaining = Number(resultAt<bigint>(results, 31) ?? 0n);
  const feeState = Number(resultAt<number>(results, 32) ?? 0);
  const escrowedManagerFeeSharesValue = resultAt<bigint>(results, 33);
  const forfeitedManagerFeeSharesValue = resultAt<bigint>(results, 34);
  const claimableChallengeRewardValue = resultAt<bigint>(results, 35);
  const lastCompletedStrategicRebalance = resultAt<bigint>(results, 36)
    ? Number(resultAt<bigint>(results, 36))
    : undefined;
  const canProposeTargetWeights = Boolean(resultAt<boolean>(results, 37));
  const authorizedExecutors = resultAt<readonly string[]>(results, 38) ?? [];
  const withinChallengeBands = Boolean(resultAt<boolean>(results, 39));
  const strategyProposalPending = Boolean(resultAt<boolean>(results, 40));
  const pendingStrategyActivationTime = resultAt<bigint>(results, 41)
    ? Number(resultAt<bigint>(results, 41))
    : undefined;
  const nextStrategyChangeTime = resultAt<bigint>(results, 42)
    ? Number(resultAt<bigint>(results, 42))
    : undefined;
  const challengeCaller = resultAt<string>(results, 43);
  const allocations = normalizeAllocations(assets, targetWeights, currentWeights);
  const cooldownProgress = progressThroughCooldown(lastPortfolioChange, nextPortfolioChange);
  const connectedIsManager =
    connectedAddress && manager && connectedAddress.toLowerCase() === manager.toLowerCase();
  const supplyDisplay = totalSupply
    ? `${Number(formatUnits(totalSupply, 18)).toLocaleString()} ${vaultSymbol}`
    : "";
  const dataMode: DataMode = !isTestnet
    ? "unavailable"
    : enabled && Boolean(results?.[0]?.result) && !error
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
    currentThesis,
    cooldownSeconds,
    lastPortfolioChange,
    nextPortfolioChange,
    canRebalance,
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
    nextStrategyChangeTime,
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
    lastCompletedStrategicRebalance,
    canProposeTargetWeights,
    authorizedExecutors,
    maxSingleAssetWeightBps,
    minNonZeroAssetWeightBps,
    maxOracleStaleness,
    maxAssetCount,
    connectedIsManager: Boolean(connectedIsManager),
    enabled,
    isLoading: Boolean(vaultAddress) && isLoading,
    dataMode,
    blockNumber,
    lastReadAt,
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
            <ChallengeCountdownBanner vault={vault} />
            <DataProvenance vault={vault} />
            <VaultMetrics vault={vault} />

            <div className="dashboardGrid">
              <div className="primaryColumn">
                <UserActions vault={vault} oraclePrices={catalogOraclePrices} />
                <PortfolioAllocation vault={vault} allocations={allocations} oraclePrices={catalogOraclePrices} onRefresh={refetchVaultData} />
              </div>

              <aside className="sideColumn">
                <ThesisModule vaultAddress={vault.address} />
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

function TopNav({
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
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [palette, setPalette] = useState<"default" | "robinhood">("default");
  const chainId = useChainId();
  const testnetMode = chainId === robinhoodChainTestnet.id;
  const { switchChain, isPending: networkSwitchPending } = useSwitchChain();
  const networkRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("otf-theme");
    const initialTheme = savedTheme === "light" ? "light" : "dark";
    const savedPalette = window.localStorage.getItem("otf-palette");
    const initialPalette = savedPalette === "robinhood" ? "robinhood" : "default";
    setTheme(initialTheme);
    setPalette(initialPalette);
    document.documentElement.dataset.theme = initialTheme;
    document.documentElement.dataset.palette = initialPalette;
  }, []);

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

  function changeTheme(nextTheme: "dark" | "light") {
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
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
                  <span>Environment and appearance</span>
                </div>
                <div className="settingsGroup">
                  <span className="settingsLabel">Environment</span>
                  <button
                    className="settingsOption"
                    type="button"
                    aria-pressed={testnetMode}
                    disabled={networkSwitchPending}
                    onClick={toggleTestnetMode}
                  >
                    <span className="settingsOptionIcon"><Zap size={15} /></span>
                    <span className="settingsOptionText">
                      <strong>Testnet mode</strong>
                      <small>{testnetMode ? "On" : "Off"}</small>
                    </span>
                    <span className={`themeSwitch ${testnetMode ? "active" : ""}`} aria-hidden="true">
                      <span />
                    </span>
                  </button>
                </div>
                <div className="settingsGroup">
                  <span className="settingsLabel">Appearance</span>
                  <button
                    className="settingsOption"
                    type="button"
                    aria-pressed={theme === "light"}
                    onClick={() => changeTheme(theme === "light" ? "dark" : "light")}
                  >
                    <span className="settingsOptionIcon">
                      {theme === "light" ? <Sun size={15} /> : <Moon size={15} />}
                    </span>
                    <span className="settingsOptionText">
                      <strong>Light mode</strong>
                      <small>{theme === "light" ? "On" : "Off"}</small>
                    </span>
                    <span className={`themeSwitch ${theme === "light" ? "active" : ""}`} aria-hidden="true">
                      <span />
                    </span>
                  </button>
                  <div className="settingsThemePicker">
                    <div className="settingsThemeHeading">
                      <span className="settingsOptionIcon"><Palette size={15} /></span>
                      <span className="settingsOptionText">
                        <strong>Theme</strong>
                        <small>Choose the application color palette</small>
                      </span>
                    </div>
                    <div className="settingsThemeChoices" role="radiogroup" aria-label="Application theme">
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

function WalletConnectionAction() {
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
      <MetricCard label="Total Supply" value={vault.totalSupply} />
      <MetricCard label="Manager Fee" value={bpsToPercent(vault.creatorFeeBps)} tone={vault.feeState === 2 ? "danger" : vault.feeState === 1 ? "warning" : "neutral"} />
      <MetricCard label="Portfolio Status" value={portfolioState} tone={vault.challengeActive ? "danger" : vault.withinCompletionBands ? "success" : "warning"} />
      <MetricCard label="Authorized Executors" value={String(vault.authorizedExecutors.length)} />
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
    ? "Live contract data"
    : isEmpty && vault.factoryReadFailed
      ? "OTF data unavailable"
      : isEmpty && vault.factoryAddress
        ? `${vault.factoryVaultCount} OTF${vault.factoryVaultCount === 1 ? "" : "s"}`
        : isEmpty
          ? "Protocol unavailable"
          : "Network unavailable";
  const tone = isLive ? "success" : "muted";

  return (
    <div className={`provenanceBanner ${vault.dataMode}`} role="status">
      <span className={`stateBadge ${tone}`}>{label}</span>
      <div>
        <strong>
          {isLive
            ? "Values are being read from Robinhood Chain Testnet."
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
  tone = "neutral",
  sub,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
  sub?: string;
}) {
  return (
    <div className={`metricCard ${tone}`}>
      <div className="metricLabel">
        {icon ?? null}
        {label}
      </div>
      <strong>{value}</strong>
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
  const portfolioCooldownRemaining = useLiveCountdown(vault.nextPortfolioChange);
  const portfolioCooldownAvailable = isLive && portfolioCooldownRemaining === 0;
  return (
    <SectionCard
      title="Portfolio Change Unlock"
      subtitle={`${formatCooldown(vault.cooldownSeconds)} interval before the next possible portfolio change`}
      icon={<Clock3 size={15} />}
      action={<span className={`stateBadge ${isLive ? (portfolioCooldownAvailable ? "success" : "warning") : "muted"}`}>{isLive ? (portfolioCooldownAvailable ? "Available now" : "Cooling down") : "Live data required"}</span>}
    >
      <div className="cooldownStats">
        <TimelineItem label="Cooldown length" value={vault.isLoading ? "Loading" : formatCooldown(vault.cooldownSeconds)} icon={<LockKeyhole size={13} />} />
        <TimelineItem label="Last portfolio change" value={isLive ? formatTimestamp(vault.lastPortfolioChange) : "Not available"} icon={<Clock3 size={13} />} />
        <TimelineItem label="Next possible change" value={isLive ? (portfolioCooldownAvailable ? "Now" : formatTimestamp(vault.nextPortfolioChange)) : "Not available"} icon={<Activity size={13} />} />
        <TimelineItem label="State" value={isLive ? (portfolioCooldownAvailable ? "Available" : "Cooling down") : "Not available"} icon={<Activity size={13} />} />
      </div>

      {isLive ? <div className="progressBlock">
        <div className="progressMeta">
          <span>Unlock progress</span>
          <strong>{formatRelativeAvailability(vault.nextPortfolioChange)}</strong>
        </div>
        <div className="progressTrack">
          <span style={{ width: `${vault.cooldownProgress}%` }} />
          <i style={{ left: `calc(${vault.cooldownProgress}% - 5px)` }} />
        </div>
        <div className="progressDates">
          <span>{formatTimestamp(vault.lastPortfolioChange)}</span>
          <span>{formatTimestamp(vault.nextPortfolioChange)}</span>
        </div>
      </div> : null}

      <div className="cardFooterAction">
        <span className="mutedInline">
          <Info size={14} />
          {isLive
            ? portfolioCooldownAvailable
              ? "Portfolio change unlock reached. Strategy proposals also follow the fixed 14-day schedule and 48-hour notice period."
              : "Maintenance trades, challenges, thesis amendments, and fee accrual do not reset this timer."
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
  return (
    <SectionCard
      title="Portfolio allocation"
      subtitle="Target vs actual contract weights"
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
              <th>Price</th>
              <th>Target</th>
              <th>Actual</th>
              <th>Drift</th>
            </tr>
          </thead>
          <tbody>
            {allocations.map((asset) => {
              const diff = asset.actualWeightBps - asset.targetWeightBps;
              const driftTone = diff > 0 ? "warning" : diff < 0 ? "success" : "neutral";
              return (
                <tr key={asset.address}>
                  <td>
                    <div className="assetIdentity">
                      <div>
                        <strong>{asset.symbol}</strong>
                        <span>{shortAssetAddress(asset.address)}</span>
                      </div>
                    </div>
                  </td>
                  <td>{oraclePrices[asset.address.toLowerCase()]?.display ?? "Loading"}</td>
                  <td>{bpsToAllocationPercent(asset.targetWeightBps)}</td>
                  <td className="actualWeight">{bpsToAllocationPercent(asset.actualWeightBps)}</td>
                  <td>
                    <span className={`driftValue ${driftTone}`}>{signedBpsToAllocationPercent(diff)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="executionPolicy portfolioMandate">
        <ShieldCheck size={14} />
        <div>
          <strong>Bounded portfolio authority</strong>
          <span>The manager may rotate assets only inside these bounds and cannot transfer OTF assets out.</span>
        </div>
      </div>
      <StrategyChallenge vault={vault} onRefresh={onRefresh} />

    </SectionCard>
  );
}

function ThesisModule({ vaultAddress }: { vaultAddress?: `0x${string}` }) {
  const {
    data: thesisVersionCount,
    isLoading: thesisCountLoading,
    isError: thesisCountFailed,
  } = useReadContract({
    address: vaultAddress,
    abi: managedOtfVaultAbi,
    functionName: "thesisVersionCount",
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(vaultAddress), refetchInterval: 12_000 },
  });
  const versionCount = Number(thesisVersionCount ?? 0n);
  const thesisVersionContracts = vaultAddress
    ? Array.from({ length: versionCount }, (_, index) => ({
        address: vaultAddress,
        abi: managedOtfVaultAbi,
        functionName: "getThesisVersion" as const,
        args: [BigInt(index)],
        chainId: robinhoodChainTestnet.id,
      }))
    : [];
  const {
    data: thesisVersionResults,
    isLoading: thesisVersionsLoading,
    isError: thesisVersionsFailed,
  } = useReadContracts({
    contracts: thesisVersionContracts,
    query: {
      enabled: thesisVersionContracts.length > 0,
      refetchInterval: 12_000,
    },
  });
  const versions = (thesisVersionResults ?? []).flatMap((entry, index) => {
    if (entry.status !== "success") return [];
    const version = entry.result as ThesisVersionResult;
    return [{ ...version, index }];
  }).reverse();
  const historyLoading = thesisCountLoading || (versionCount > 0 && thesisVersionsLoading);
  const historyFailed = thesisCountFailed || thesisVersionsFailed;

  return (
    <SectionCard
      title="Investment thesis"
      subtitle="Permanent onchain history of the manager's strategy statements"
      icon={<BookOpen size={15} />}
      action={<span className="stateBadge muted">{versionCount} entr{versionCount === 1 ? "y" : "ies"}</span>}
    >
      {historyLoading ? (
        <div className="inlineEmptyState">
          <Loader2 className="spin" size={17} />
          <div><strong>Loading thesis history</strong><span>Reading every thesis entry from the OTF contract.</span></div>
        </div>
      ) : historyFailed ? (
        <div className="inlineEmptyState">
          <RefreshCw size={17} />
          <div><strong>Thesis history unavailable</strong><span>The contract did not return every stored entry.</span></div>
        </div>
      ) : versions.length ? (
        <div className="thesisHistory">
          {versions.map((version) => {
            const isCurrent = version.index === versionCount - 1;
            const isInitial = version.index === 0;
            return (
              <article className={`thesisVersion ${isCurrent ? "current" : ""}`} key={version.index}>
                <div className="thesisVersionHeader">
                  <div>
                    <strong>{isInitial ? "Initial thesis" : `Amendment ${version.index}`}</strong>
                    {isCurrent ? <span className="stateBadge success">Current</span> : null}
                  </div>
                  <time>{formatTimestamp(Number(version.timestamp))}</time>
                </div>
                <p>{version.text}</p>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="inlineEmptyState">
          <BookOpen size={17} />
          <div><strong>No thesis entries found</strong><span>This OTF did not return an initialized thesis record.</span></div>
        </div>
      )}
    </SectionCard>
  );
}

function ThesisAmendmentCard({
  currentThesis,
  canManage,
  vaultAddress,
  onRefresh,
}: {
  currentThesis: string;
  canManage: boolean;
  vaultAddress?: `0x${string}`;
  onRefresh: () => Promise<unknown>;
}) {
  const [draft, setDraft] = useState("");
  const [submitState, setSubmitState] = useState<TxState>("idle");
  const [submitError, setSubmitError] = useState<string>();
  const publicClient = usePublicClient({ chainId: robinhoodChainTestnet.id });
  const { writeContractAsync } = useWriteContract();
  const { data: thesisVersionCount } = useReadContract({
    address: vaultAddress,
    abi: managedOtfVaultAbi,
    functionName: "thesisVersionCount",
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(vaultAddress), refetchInterval: 12_000 },
  });
  const versionCount = Number(thesisVersionCount ?? 0n);
  const { data: initialThesisVersion, isLoading: initialThesisLoading } = useReadContract({
    address: vaultAddress,
    abi: managedOtfVaultAbi,
    functionName: "getThesisVersion",
    args: [0n],
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(vaultAddress && versionCount > 0), refetchInterval: 12_000 },
  });
  const { data: latestThesisVersion, isLoading: latestThesisLoading } = useReadContract({
    address: vaultAddress,
    abi: managedOtfVaultAbi,
    functionName: "getThesisVersion",
    args: [BigInt(Math.max(0, versionCount - 1))],
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(vaultAddress && versionCount > 1), refetchInterval: 12_000 },
  });
  const initialThesis = (initialThesisVersion as ThesisVersionResult | undefined)?.text ?? currentThesis;
  const latestAmendment = latestThesisVersion as ThesisVersionResult | undefined;
  const amendment = draft.trim();
  const amendmentBytes = new TextEncoder().encode(amendment).length;
  const amendmentValid = amendmentBytes > 0 && amendmentBytes <= 2_048;
  const submitting = submitState === "pending" || submitState === "submitted";

  async function submitAmendment() {
    if (!canManage || !vaultAddress || !publicClient || !amendmentValid) return;
    setSubmitError(undefined);
    try {
      setSubmitState("pending");
      const hash = await writeContractAsync({
        address: vaultAddress,
        abi: managedOtfVaultAbi,
        functionName: "appendThesisAmendment",
        args: [amendment],
        chainId: robinhoodChainTestnet.id,
      });
      setSubmitState("submitted");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The thesis amendment reverted.");
      await onRefresh();
      setDraft("");
      setSubmitState("confirmed");
    } catch (error) {
      setSubmitError(errorMessage(error));
      setSubmitState("reverted");
    }
  }

  return (
    <SectionCard
      title="Thesis history and amendment"
      subtitle="Review the strategy record and append a permanent update"
      icon={<BookOpen size={15} />}
      action={<span className="stateBadge muted">Manager</span>}
    >
      <div className="operationFlow">
        <div className="managedThesisHistory">
          <article>
            <span>Initial thesis</span>
            <p>{initialThesisLoading ? "Loading initial thesis..." : initialThesis}</p>
          </article>
          <article>
            <span>Latest amendment</span>
            {versionCount > 1 ? (
              <>
                <p>{latestThesisLoading ? "Loading latest amendment..." : latestAmendment?.text ?? "Amendment unavailable"}</p>
                {latestAmendment ? <time>{formatTimestamp(Number(latestAmendment.timestamp))}</time> : null}
              </>
            ) : (
              <p className="mutedCopy">No amendments have been added.</p>
            )}
          </article>
        </div>
        <label className="fieldLabel" htmlFor="thesis-amendment">New amendment</label>
        <textarea
          id="thesis-amendment"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            if (submitState === "confirmed" || submitState === "reverted") setSubmitState("idle");
            if (submitError) setSubmitError(undefined);
          }}
          placeholder="Describe the updated investment thesis or rationale..."
          rows={4}
          aria-invalid={amendmentBytes > 2_048}
          disabled={!canManage || submitting}
        />
        <p>{amendmentBytes.toLocaleString()} / 2,048 bytes. Amendments are permanent, public, and do not reset the portfolio change unlock.</p>
        {amendmentBytes > 2_048 ? (
          <div className="validationSummary danger" role="alert">
            <AlertTriangle size={15} />
            <div><strong>Amendment is too long</strong><span>Shorten it to 2,048 UTF-8 bytes or fewer.</span></div>
          </div>
        ) : null}
        {submitError ? (
          <div className="validationSummary danger" role="alert">
            <XCircle size={15} />
            <div><strong>Amendment failed</strong><span>{submitError}</span></div>
          </div>
        ) : null}
        <TxStatus state={submitState} />
        <button
          className="primaryAction"
          type="button"
          disabled={!canManage || !vaultAddress || !amendmentValid || submitting}
          title={!canManage ? "Connect the manager wallet to submit amendments" : !amendmentValid ? "Enter an amendment within the contract limit" : undefined}
          onClick={submitAmendment}
        >
          {submitting ? <Loader2 className="spin" size={14} /> : <BookOpen size={14} />}
          {submitState === "pending" ? "Confirm in wallet" : submitState === "submitted" ? "Confirming amendment" : "Submit amendment"}
        </button>
      </div>
    </SectionCard>
  );
}

function UserActions({
  vault,
  oraclePrices,
}: {
  vault: VaultView;
  oraclePrices: CatalogOraclePrices;
}) {
  const [activeAction, setActiveAction] = useState<"deposit" | "redeem">("deposit");
  const [selectedRoute, setSelectedRoute] = useState<"market" | "underlying">();
  const [tradeAmount, setTradeAmount] = useState("");
  const [maxSlippage, setMaxSlippage] = useState("1.0");
  const [entryState, setEntryState] = useState<TxState>("idle");
  const [entryError, setEntryError] = useState<string>();
  const [redeemState, setRedeemState] = useState<TxState>("idle");
  const [redeemError, setRedeemError] = useState<string>();
  const [marketState, setMarketState] = useState<TxState>("idle");
  const [marketError, setMarketError] = useState<string>();
  const { address: connectedAddress } = useAccount();
  const publicClient = usePublicClient({ chainId: robinhoodChainTestnet.id });
  const { writeContractAsync } = useWriteContract();
  const isLive = vault.dataMode === "live";
  const entryRouterAddress = configuredEntryRouterAddress();
  const entryAdapterAddress = configuredEntryAdapterAddress();
  const uniswapRouterAddress = configuredUniswapRouterAddress();
  const configuredSettlementToken = configuredSettlementTokenAddress();
  const entryContractsConfigured = Boolean(
    entryRouterAddress && entryAdapterAddress && uniswapRouterAddress,
  );
  const parsedSlippage = Number(maxSlippage);
  const slippageBps = Number.isFinite(parsedSlippage)
    ? Math.round(parsedSlippage * 100)
    : 0;
  const slippageValid = slippageBps >= 1 && slippageBps <= 2_000;
  let normalizedUsdgAmount: bigint | undefined;
  try {
    normalizedUsdgAmount = activeAction === "deposit" && Number(tradeAmount) > 0
      ? parseUnits(tradeAmount, 18)
      : undefined;
  } catch {
    normalizedUsdgAmount = undefined;
  }
  const navEstimatedShares = normalizedUsdgAmount && vault.navPerShareValue
    ? normalizedUsdgAmount * 10n ** 18n / vault.navPerShareValue
    : undefined;
  let requestedEntryShares: bigint | undefined;
  if (activeAction === "deposit" && navEstimatedShares && slippageValid) {
    requestedEntryShares = navEstimatedShares * 10_000n / BigInt(10_000 + slippageBps);
  }
  let requestedRedeemShares: bigint | undefined;
  try {
    requestedRedeemShares = activeAction === "redeem" && Number(tradeAmount) > 0
      ? parseUnits(tradeAmount, 18)
      : undefined;
  } catch {
    requestedRedeemShares = undefined;
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
  const { data: settlementDecimalsRead } = useReadContract({
    address: settlementToken,
    abi: erc20BalanceAbi,
    functionName: "decimals",
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(settlementToken) },
  });
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
    vault.address &&
    requestedEntryShares &&
    requestedEntryShares > 0n &&
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
    args: requestedEntryShares ? [requestedEntryShares] : undefined,
    chainId: robinhoodChainTestnet.id,
    query: { enabled: canQuoteEntry },
  });
  const entryQuoteContracts = canQuoteEntry && previewEntryAmounts && settlementToken && uniswapRouterAddress
    ? vault.allocations.flatMap((asset, index) => {
        if (asset.address.toLowerCase() === settlementToken.toLowerCase()) return [];
        const amountOut = previewEntryAmounts[index];
        if (amountOut === undefined || amountOut === 0n) return [];
        return [{
          address: uniswapRouterAddress,
          abi: uniswapV2QuoteAbi,
          functionName: "getAmountsIn" as const,
          args: [amountOut, [settlementToken, asset.address as `0x${string}`]],
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
  const redeemQuoteContracts = previewRedeemAmounts && settlementToken && uniswapRouterAddress && redeemSlippageValid
    ? vault.allocations.flatMap((asset, index) => {
        if (asset.address.toLowerCase() === settlementToken.toLowerCase()) return [];
        const amountIn = previewRedeemAmounts[index];
        if (amountIn === undefined || amountIn === 0n) return [];
        return [{
          address: uniswapRouterAddress,
          abi: uniswapV2QuoteAbi,
          functionName: "getAmountsOut" as const,
          args: [amountIn, [asset.address as `0x${string}`, settlementToken]],
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
  let entryQuoteIndex = 0;
  const entryLegs = vault.allocations.map((asset, index) => {
    const requiredAmount = previewEntryAmounts?.[index];
    const isSettlement = Boolean(
      settlementToken && asset.address.toLowerCase() === settlementToken.toLowerCase(),
    );
    let quotedSettlement: bigint | undefined;
    let quoteFailed = false;
    if (isSettlement) {
      quotedSettlement = requiredAmount;
    } else if (requiredAmount !== undefined && requiredAmount > 0n) {
      const result = entryQuoteResults?.[entryQuoteIndex];
      entryQuoteIndex += 1;
      const amounts = result?.result as readonly bigint[] | undefined;
      quotedSettlement = amounts?.[0];
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
  const entryQuotesFailed = entryLegs.some((leg) => leg.quoteFailed);
  const entryQuoteReady = Boolean(
    requestedEntryShares &&
    previewEntryAmounts?.length === vault.allocations.length &&
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
  const settlementDecimals = Number(settlementDecimalsRead ?? entryAuthorizationResults?.[2]?.result ?? 18);
  let requestedUsdgAmount: bigint | undefined;
  try {
    requestedUsdgAmount = activeAction === "deposit" && Number(tradeAmount) > 0
      ? parseUnits(tradeAmount, settlementDecimals)
      : undefined;
  } catch {
    requestedUsdgAmount = undefined;
  }
  const {
    data: marketFactoryResult,
    isLoading: marketFactoryLoading,
  } = useReadContract({
    address: uniswapRouterAddress,
    abi: uniswapV2QuoteAbi,
    functionName: "factory",
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(uniswapRouterAddress) },
  });
  const marketFactory = typeof marketFactoryResult === "string" && isAddress(marketFactoryResult)
    ? marketFactoryResult
    : undefined;
  const {
    data: marketPairResult,
    isLoading: marketPairLoading,
  } = useReadContract({
    address: marketFactory,
    abi: uniswapV2FactoryAbi,
    functionName: "getPair",
    args: vault.address && settlementToken ? [vault.address, settlementToken] : undefined,
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(marketFactory && vault.address && settlementToken) },
  });
  const marketPair = typeof marketPairResult === "string" && isAddress(marketPairResult) && marketPairResult !== zeroAddress
    ? marketPairResult
    : undefined;
  const {
    data: marketReservesResult,
    isLoading: marketReservesLoading,
  } = useReadContract({
    address: marketPair,
    abi: uniswapV2PairAbi,
    functionName: "getReserves",
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(marketPair) },
  });
  const marketReserves = marketReservesResult as readonly [bigint, bigint, number] | undefined;
  const marketLiquidityReady = Boolean(
    marketPair && marketReserves && marketReserves[0] > 0n && marketReserves[1] > 0n,
  );
  const marketPoolChecking = Boolean(uniswapRouterAddress && settlementToken && vault.address) && (
    marketFactoryLoading || marketPairLoading || (Boolean(marketPair) && marketReservesLoading)
  );
  const marketPath = activeAction === "deposit"
    ? [settlementToken ?? zeroAddress, vault.address ?? zeroAddress]
    : [vault.address ?? zeroAddress, settlementToken ?? zeroAddress];
  const marketInputAmount = activeAction === "deposit" ? requestedUsdgAmount : requestedRedeemShares;
  const {
    data: marketQuoteResult,
    error: marketQuoteError,
    isLoading: marketQuoteLoading,
    refetch: refetchMarketQuote,
  } = useReadContract({
    address: uniswapRouterAddress,
    abi: uniswapV2QuoteAbi,
    functionName: "getAmountsOut",
    args: marketInputAmount ? [marketInputAmount, marketPath] : undefined,
    chainId: robinhoodChainTestnet.id,
    query: {
      enabled: Boolean(
        marketLiquidityReady && marketInputAmount && marketInputAmount > 0n && slippageValid,
      ),
    },
  });
  const marketQuoteAmounts = marketQuoteResult as readonly bigint[] | undefined;
  const marketQuotedOutput = marketQuoteAmounts?.[marketQuoteAmounts.length - 1];
  const marketMinimumOutput = marketQuotedOutput === undefined || !slippageValid
    ? undefined
    : marketQuotedOutput * BigInt(10_000 - slippageBps) / 10_000n;
  const marketInputToken = activeAction === "deposit" ? settlementToken : vault.address;
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
        (uniswapRouterAddress ?? zeroAddress) as `0x${string}`,
      ],
      chainId: robinhoodChainTestnet.id,
    },
  ] as const);
  const {
    data: marketAuthorizationResults,
    refetch: refetchMarketAuthorization,
  } = useReadContracts({
    contracts: marketAuthorizationContracts,
    query: { enabled: Boolean(marketInputToken && connectedAddress && uniswapRouterAddress) },
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
  const entryBalanceSufficient = maximumSettlementTotal !== undefined &&
    settlementBalance !== undefined && settlementBalance >= maximumSettlementTotal;
  const entryWithinBudget = maximumSettlementTotal !== undefined && requestedUsdgAmount !== undefined &&
    maximumSettlementTotal <= requestedUsdgAmount;
  const entryAllowanceSufficient = maximumSettlementTotal !== undefined &&
    settlementAllowance !== undefined && settlementAllowance >= maximumSettlementTotal;
  const entryOracleValue = entryQuoteReady && entryLegs.every(
    (leg) => oraclePrices[leg.address.toLowerCase()]?.answer !== undefined,
  )
    ? entryLegs.reduce((sum, leg) => {
        const price = oraclePrices[leg.address.toLowerCase()];
        if (leg.requiredAmount === undefined || price?.answer === undefined || price.decimals === undefined) {
          return sum;
        }
        return sum + (leg.requiredAmount * price.answer) / (10n ** BigInt(price.decimals));
      }, 0n)
    : undefined;
  const entryBusy = entryState === "pending" || entryState === "submitted";
  const redeemShareBalance = redeemAuthorizationResults?.[0]?.result as bigint | undefined;
  const redeemShareAllowance = redeemAuthorizationResults?.[1]?.result as bigint | undefined;
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
      const amounts = result?.result as readonly bigint[] | undefined;
      quotedSettlement = amounts?.[amounts.length - 1];
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
  const inputTokenSymbol = activeAction === "deposit" ? "USDG" : vault.symbol;
  const inputTokenDecimals = activeAction === "deposit" ? settlementDecimals : 18;
  const walletInputBalance = activeAction === "deposit" ? settlementBalance : redeemShareBalance;
  const walletInputBalanceLoading = activeAction === "deposit"
    ? entryAuthorizationLoading
    : redeemAuthorizationLoading;
  const walletInputBalanceLabel = !connectedAddress
    ? "Connect wallet"
    : walletInputBalanceLoading
      ? "Checking..."
      : walletInputBalance === undefined
        ? "Unavailable"
        : `${formatWalletTokenBalance(walletInputBalance, inputTokenDecimals)} ${inputTokenSymbol}`;
  const routeInputsReady = Boolean(marketInputAmount && marketInputAmount > 0n && slippageValid);
  const underlyingRouteAvailable = entryContractsConfigured && entryAdapterApproved !== false;
  const underlyingQuoteReady = activeAction === "deposit"
    ? entryQuoteReady && entryWithinBudget
    : redeemQuoteReady;
  const underlyingQuoteLoading = activeAction === "deposit"
    ? previewEntryLoading || entryQuotesLoading
    : previewRedeemLoading || redeemQuotesLoading;
  const underlyingQuoteFailed = activeAction === "deposit"
    ? Boolean(previewEntryError || entryQuotesFailed)
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
      setTradeAmount("");
    } catch (error) {
      setEntryError(errorMessage(error));
      setEntryState("reverted");
    }
  }

  async function approveSharesForSettlementExit() {
    if (!vault.address || !entryRouterAddress || !publicClient || !requestedRedeemShares || redeemShareAllowance === undefined) return;
    setRedeemError(undefined);
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
      !uniswapRouterAddress ||
      !marketRequiredInput ||
      !publicClient
    ) return;
    setMarketError(undefined);
    try {
      setMarketState("pending");
      if ((marketInputAllowance ?? 0n) > 0n) {
        const resetHash = await writeContractAsync({
          address: marketInputToken,
          abi: erc20BalanceAbi,
          functionName: "approve",
          args: [uniswapRouterAddress, 0n],
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
        args: [uniswapRouterAddress, marketRequiredInput],
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
      !uniswapRouterAddress ||
      !vault.address ||
      !settlementToken ||
      !connectedAddress ||
      !publicClient ||
      !marketInputAmount ||
      !marketMinimumOutput ||
      !marketQuoteReady ||
      !marketBalanceSufficient ||
      !marketAllowanceSufficient
    ) return;
    setMarketError(undefined);
    try {
      setMarketState("pending");
      const deadline = BigInt(Math.floor(Date.now() / 1_000) + 20 * 60);
      const hash = await writeContractAsync({
        address: uniswapRouterAddress,
        abi: uniswapV2QuoteAbi,
        functionName: "swapExactTokensForTokens",
        args: [
          marketInputAmount,
          marketMinimumOutput,
          marketPath,
          connectedAddress,
          deadline,
        ],
        chainId: robinhoodChainTestnet.id,
      });
      setMarketState("submitted");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The open-market trade reverted.");
      await Promise.all([refetchMarketAuthorization(), refetchMarketQuote()]);
      setTradeAmount("");
      setMarketState("confirmed");
    } catch (error) {
      setMarketError(errorMessage(error));
      setMarketState("reverted");
    }
  }

  function updateTradeAmount(nextAmount: string) {
    setTradeAmount(nextAmount);
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
    setActiveAction(nextAction);
    setTradeAmount("");
    setSelectedRoute(undefined);
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
      subtitle={activeAction === "deposit" ? `Buy ${vault.symbol} with USDG` : `Redeem ${vault.symbol} for USDG`}
      icon={<Wallet size={15} />}
    >
      <div className="positionTradeTicket">
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

        <div className="positionTicketInputs">
          <label>
            <span className="positionFieldHeading">
              <span>{inputTokenSymbol} amount</span>
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
                disabled={!marketLiquidityReady}
                onClick={() => setSelectedRoute("market")}
              >
                <span className="positionRouteIcon"><Droplets size={18} /></span>
                <span className="positionRouteName">Open market</span>
                <strong className="positionRouteQuote">
                  {marketPoolChecking
                    ? <Loader2 className="spin" size={18} />
                    : !marketLiquidityReady
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
                  {!marketLiquidityReady
                    ? "No funded OTF / USDG pool"
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
                disabled={!underlyingRouteAvailable}
                onClick={() => setSelectedRoute("underlying")}
              >
                <span className="positionRouteIcon"><Landmark size={18} /></span>
                <span className="positionRouteName">Underlying pools</span>
                <strong className="positionRouteQuote">
                  {!underlyingRouteAvailable
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
                  {!underlyingRouteAvailable
                    ? "Settlement route not configured"
                    : activeAction === "deposit"
                      ? `${vault.symbol} shares minted`
                      : "USDG received"}
                </small>
              </button>
            </div>
          </div>
        ) : (
          <div className="positionRoutePrompt">
            <ArrowDownToLine size={17} />
            <div>
              <strong>Enter an amount to compare routes</strong>
              <span>
                Both execution paths use the same {inputTokenSymbol} amount and slippage limit.
              </span>
            </div>
          </div>
        )}

        {selectedRoute === "market" && routeInputsReady ? (
          <div className="positionExecutionPanel">
            <div className="positionExecutionHeader">
              <div>
                <span className="positionRouteIcon"><Droplets size={16} /></span>
                <div>
                  <strong>Open market</strong>
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
                  <strong>Underlying pools</strong>
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
                  <div><span>Estimated shares</span><strong>{requestedEntryShares ? formatWalletTokenBalance(requestedEntryShares, 18) : "—"} {vault.symbol}</strong></div>
                  <div><span>Maximum spend</span><strong>{maximumSettlementTotal !== undefined ? formatWalletTokenBalance(maximumSettlementTotal, settlementDecimals) : "—"} USDG</strong></div>
                  <div><span>Oracle-priced basket</span><strong>{entryOracleValue === undefined ? "Unavailable" : formatUsd18(entryOracleValue)}</strong></div>
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
              <span>Underlying execution uses approved constituent pools. Final USDG depends on their live liquidity and price impact.</span>
            </div>
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
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
  const initialTargets = useMemo(
    () => vault.allocations.map((asset) => ({
      ticker: asset.symbol,
      address: asset.address,
      targetWeight: asset.targetWeightBps / 100,
      initialAmount: "",
    })),
    [vault.allocations],
  );
  const [targets, setTargets] = useState<TargetAsset[]>(initialTargets);
  const [txState, setTxState] = useState<TxState>("idle");
  const [txError, setTxError] = useState<string>();
  const publicClient = usePublicClient({ chainId: robinhoodChainTestnet.id });
  const { writeContractAsync } = useWriteContract();
  const activationRemaining = useLiveCountdown(vault.pendingStrategyActivationTime);

  useEffect(() => setTargets(initialTargets), [initialTargets]);

  const totalWeight = targets.reduce((sum, asset) => sum + Number(asset.targetWeight || 0), 0);
  const targetChanges = targets.map((asset) => {
    const currentAllocation = vault.allocations.find(
      (allocation) => allocation.address.toLowerCase() === asset.address.toLowerCase(),
    );
    const current = (currentAllocation?.actualWeightBps ?? 0) / 100;
    return { ...asset, current, delta: Number(asset.targetWeight || 0) - current };
  });
  const turnover = Math.max(0, targetChanges.reduce((sum, asset) => sum + Math.abs(asset.delta), 0) / 2);
  const maxDeviation = Math.max(0, ...targetChanges.map((asset) => Math.abs(asset.delta)));
  const targetWeightBps = targets.map((asset) => Math.round(Number(asset.targetWeight) * 100));
  const weightsValid = targetWeightBps.reduce((sum, weight) => sum + weight, 0) === 10_000;
  const addressesValid = targets.length > 0 && targets.every((asset) => isAddress(asset.address));
  const targetsUnique = new Set(targets.map((asset) => asset.address.toLowerCase())).size === targets.length;
  const turnoverLimit = vault.maxTurnoverBps / 100;
  const turnoverBreach = turnover > turnoverLimit;
  const reductions = targetChanges.filter((asset) => asset.delta < -0.01);
  const increases = targetChanges.filter((asset) => asset.delta > 0.01);
  const tradeInstructions = reductions.flatMap((sell) =>
    increases.map((buy) => ({
      from: sell.ticker || "Asset",
      to: buy.ticker || "Asset",
      notional: `${Math.min(Math.abs(sell.delta), buy.delta).toFixed(1)}% NAV`,
      adapter: "Approved adapter",
    })),
  ).slice(0, 3);

  function updateTarget(index: number, patch: Partial<TargetAsset>) {
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
      targetWeight: 0,
      initialAmount: "",
    }]);
    setTxState("idle");
  }

  async function submitTargets() {
    if (!vault.address || !vault.connectedIsManager || !publicClient || !weightsValid || !addressesValid || !targetsUnique) return;
    setTxError(undefined);
    try {
      setTxState("simulating");
      const args = [
        targets.map((target) => target.address as `0x${string}`),
        targetWeightBps.map(BigInt),
      ] as const;
      await publicClient.simulateContract({
        account: vault.manager as `0x${string}`,
        address: vault.address,
        abi: managedOtfVaultAbi,
        functionName: "rebalance",
        args,
      });
      setTxState("pending");
      const hash = await writeContractAsync({
        address: vault.address,
        abi: managedOtfVaultAbi,
        functionName: "rebalance",
        args,
        chainId: robinhoodChainTestnet.id,
      });
      setTxState("submitted");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The target update reverted.");
      await onRefresh();
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
                    onChange={(event) => updateTarget(index, { targetWeight: Number(event.target.value) })}
                    type="number"
                    min={0}
                    max={100}
                    placeholder="0"
                    disabled={vault.strategyProposalPending}
                  />
                  <span>%</span>
                </div>
              </label>
              <small>Current {targetChanges[index]?.current.toFixed(1) ?? "0.0"}%</small>
            </div>
          ))}
        </div>
        <button className="ghostAction addAssetAction" type="button" onClick={addTarget} disabled={vault.strategyProposalPending || targets.length >= vault.maxAssetCount || targets.length >= testnetCreateAssets.length}>
          <Plus size={13} />
          Add asset
        </button>
      </div>

      <div className="previewBlock">
        <div className="subHeader">
          <span>Current vs target</span>
          <small>Estimated turnover {turnover.toFixed(1)}%</small>
        </div>
        <div className="weightPreviewList">
          {targetChanges.map((target, index) => (
            <div className="weightPreviewRow" key={`${target.ticker}-preview-${index}`}>
              <strong>{target.ticker || "Asset"}</strong>
              <div className="weightTrack" aria-label={`${target.ticker} current ${target.current.toFixed(1)}%, target ${target.targetWeight.toFixed(1)}%`}>
                <span style={{ width: `${Math.min(target.current, 100)}%` }} />
                <i style={{ left: `${Math.min(Number(target.targetWeight || 0), 100)}%` }} />
              </div>
              <div>
                <span>{target.current.toFixed(1)}%</span>
                <ArrowRight size={12} />
                <strong>{Number(target.targetWeight || 0).toFixed(1)}%</strong>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="builderBlock">
        <div className="subHeader">
          <span className="inlineLabel"><ListChecks size={13} /> Trade instructions</span>
          <small>Approved adapters only</small>
        </div>
        <div className="tradeTableWrap">
          <table className="tradeTable">
            <thead>
              <tr>
                <th>Sell</th>
                <th>Buy</th>
                <th>Notional</th>
                <th>Adapter</th>
              </tr>
            </thead>
            <tbody>
              {tradeInstructions.length ? tradeInstructions.map((trade, index) => (
                <tr key={`${trade.from}-${trade.to}-${index}`}>
                  <td>{trade.from}</td>
                  <td>{trade.to}</td>
                  <td>{trade.notional}</td>
                  <td><span className="stateBadge success">{trade.adapter}</span></td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={4} className="emptyTableCell">No trades required for the current target set.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="riskMetricGrid">
        <div className={turnoverBreach ? "danger" : "warning"}>
          <span>Estimated turnover</span>
          <strong>{turnover.toFixed(1)}%</strong>
          <small>Limit {turnoverLimit.toFixed(1)}%</small>
        </div>
        <div>
          <span>NAV impact</span>
          <strong>Not calculated</strong>
          <small>Requires contract simulation</small>
        </div>
        <div className={maxDeviation === 0 ? "success" : "warning"}>
          <span>Largest completion gap</span>
          <strong>{maxDeviation.toFixed(1)}%</strong>
          <small>Completion band +/- {(vault.maxWeightDeviationBps / 100).toFixed(1)}%</small>
        </div>
      </div>

      <div className="builderWarnings">
        {!weightsValid ? (
          <div className="riskCallout warning"><AlertTriangle size={15} /><div><strong>Target weights must sum to exactly 100%</strong><span>Weights are submitted to the contract in whole basis points.</span></div></div>
        ) : null}
        {!targetsUnique ? (
          <div className="riskCallout danger"><XCircle size={15} /><div><strong>Each asset may appear only once</strong><span>Select a different supported asset or remove the duplicate.</span></div></div>
        ) : null}
        {turnoverBreach ? (
          <div className="riskCallout danger"><XCircle size={15} /><div><strong>Turnover exceeds the immutable limit</strong><span>This transaction would revert atomically.</span></div></div>
        ) : null}
        {!vault.canProposeTargetWeights ? (
          <div className="riskCallout warning"><Clock3 size={15} /><div><strong>Target proposal unavailable</strong><span>The change unlock, completion bands, active challenge, and unfinished strategic state are checked onchain.</span></div></div>
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
            disabled={!vault.connectedIsManager || !vault.canProposeTargetWeights || !weightsValid || !addressesValid || !targetsUnique || turnoverBreach || txState === "pending" || txState === "submitted" || txState === "simulating"}
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

function RebalanceTradesPanel({ vault, onRefresh }: { vault: VaultView; onRefresh: () => Promise<unknown> }) {
  const [tokenIn, setTokenIn] = useState(vault.allocations[0]?.address ?? "");
  const [tokenOut, setTokenOut] = useState(vault.allocations[1]?.address ?? "");
  const [amountInText, setAmountInText] = useState("");
  const [slippageText, setSlippageText] = useState("1.0");
  const [routeThroughUsdg, setRouteThroughUsdg] = useState(false);
  const [txState, setTxState] = useState<TxState>("idle");
  const [txError, setTxError] = useState<string>();
  const { address: connectedAddress } = useAccount();
  const publicClient = usePublicClient({ chainId: robinhoodChainTestnet.id });
  const { writeContractAsync } = useWriteContract();
  const adapterAddress = configuredEntryAdapterAddress();
  const uniswapRouterAddress = configuredUniswapRouterAddress();
  const settlementToken = configuredSettlementTokenAddress();

  useEffect(() => {
    if (!vault.allocations.some((asset) => asset.address === tokenIn)) setTokenIn(vault.allocations[0]?.address ?? "");
    if (!vault.allocations.some((asset) => asset.address === tokenOut)) setTokenOut(vault.allocations[1]?.address ?? "");
  }, [tokenIn, tokenOut, vault.allocations]);

  const { data: tokenInDecimalsResult } = useReadContract({
    address: isAddress(tokenIn) ? tokenIn : undefined,
    abi: erc20BalanceAbi,
    functionName: "decimals",
    chainId: robinhoodChainTestnet.id,
    query: { enabled: isAddress(tokenIn) },
  });
  const tokenInDecimals = Number(tokenInDecimalsResult ?? 18);
  const { data: tokenOutDecimalsResult } = useReadContract({
    address: isAddress(tokenOut) ? tokenOut : undefined,
    abi: erc20BalanceAbi,
    functionName: "decimals",
    chainId: robinhoodChainTestnet.id,
    query: { enabled: isAddress(tokenOut) },
  });
  const tokenOutDecimals = Number(tokenOutDecimalsResult ?? 18);
  let amountIn: bigint | undefined;
  try {
    amountIn = Number(amountInText) > 0 ? parseUnits(amountInText, tokenInDecimals) : undefined;
  } catch {
    amountIn = undefined;
  }
  const slippageBps = Math.round(Number(slippageText) * 100);
  const slippageValid = Number.isFinite(slippageBps) && slippageBps >= 1 && slippageBps <= 2_000;
  const path = routeThroughUsdg && settlementToken
    ? [tokenIn, settlementToken, tokenOut]
    : [tokenIn, tokenOut];
  const routeValid = path.every((address) => isAddress(address)) && tokenIn !== tokenOut;
  const quoteEnabled = Boolean(uniswapRouterAddress && amountIn && amountIn > 0n && routeValid);
  const {
    data: quoteAmounts,
    error: quoteError,
    isLoading: quoteLoading,
    refetch: refetchQuote,
  } = useReadContract({
    address: uniswapRouterAddress,
    abi: uniswapV2QuoteAbi,
    functionName: "getAmountsOut",
    args: amountIn && routeValid ? [amountIn, path as `0x${string}`[]] : undefined,
    chainId: robinhoodChainTestnet.id,
    query: { enabled: quoteEnabled },
  });
  const quotedAmountOut = quoteAmounts?.[quoteAmounts.length - 1];
  const minAmountOut = quotedAmountOut && slippageValid
    ? quotedAmountOut * BigInt(10_000 - slippageBps) / 10_000n
    : undefined;
  const outputAsset = vault.allocations.find((asset) => asset.address === tokenOut);
  const inputAsset = vault.allocations.find((asset) => asset.address === tokenIn);
  const contractsConfigured = Boolean(adapterAddress && uniswapRouterAddress);
  const busy = txState === "simulating" || txState === "pending" || txState === "submitted";
  const canSubmit = Boolean(
    vault.address && vault.connectedIsManager && connectedAddress && publicClient && contractsConfigured &&
    amountIn && minAmountOut && routeValid && slippageValid,
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
      await onRefresh();
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
      title="Execute rebalance trade"
      subtitle="Move the live basket toward its active target with a constrained partial swap"
      icon={<RefreshCw size={15} />}
      action={<span className={`stateBadge ${vault.strategicRebalanceActive ? "warning" : "muted"}`}>{vault.strategicRebalanceActive ? "Target active" : "Maintenance trade"}</span>}
    >
      <div className="rebalanceTradeForm">
        <div className="tradeAssetPair">
          <label>
            <span>Sell</span>
            <select value={tokenIn} onChange={(event) => { setTokenIn(event.target.value); resetTradeState(); }}>
              {vault.allocations.map((asset) => <option key={asset.address} value={asset.address}>{asset.symbol}</option>)}
            </select>
          </label>
          <ArrowRight size={15} />
          <label>
            <span>Buy</span>
            <select value={tokenOut} onChange={(event) => { setTokenOut(event.target.value); resetTradeState(); }}>
              {vault.allocations.map((asset) => <option key={asset.address} value={asset.address}>{asset.symbol}</option>)}
            </select>
          </label>
        </div>

        <div className="tradeInputGrid">
          <label>
            <span>Amount to sell</span>
            <div className="inputWithSuffix">
              <input type="number" min="0" value={amountInText} onChange={(event) => { setAmountInText(event.target.value); resetTradeState(); }} placeholder="0.00" />
              <span>{inputAsset?.symbol ?? "Asset"}</span>
            </div>
          </label>
          <label>
            <span>Maximum pool slippage</span>
            <div className="inputWithSuffix">
              <input type="number" min="0.01" max="20" step="0.1" value={slippageText} onChange={(event) => { setSlippageText(event.target.value); resetTradeState(); }} />
              <span>%</span>
            </div>
          </label>
        </div>

        <label className={`routeToggle ${!settlementToken ? "disabled" : ""}`}>
          <input type="checkbox" checked={routeThroughUsdg} disabled={!settlementToken} onChange={(event) => { setRouteThroughUsdg(event.target.checked); resetTradeState(); }} />
          <span>
            <strong>Route through USDG</strong>
            <small>USDG is an internal Uniswap hop and never becomes an OTF constituent or recipient.</small>
          </span>
        </label>

        <div className="tradeExecutionQuote">
          <span>Uniswap quote</span>
          <strong>
            {quoteLoading ? "Loading" : quotedAmountOut
              ? `${formatWalletTokenBalance(quotedAmountOut, tokenOutDecimals)} ${outputAsset?.symbol ?? "tokens"}`
              : "Enter an amount"}
          </strong>
          <small>{routeThroughUsdg ? `${inputAsset?.symbol ?? "Asset"} -> USDG -> ${outputAsset?.symbol ?? "Asset"}` : `${inputAsset?.symbol ?? "Asset"} -> ${outputAsset?.symbol ?? "Asset"}`}</small>
        </div>

        {!contractsConfigured ? (
          <div className="validationSummary warning"><AlertTriangle size={15} /><div><strong>Trading adapter not configured</strong><span>Deploy and configure the approved Uniswap adapter before submitting rebalance trades.</span></div></div>
        ) : null}
        {tokenIn === tokenOut ? (
          <div className="validationSummary warning"><AlertTriangle size={15} /><div><strong>Select two different assets</strong><span>The sold and purchased constituents cannot be the same token.</span></div></div>
        ) : null}
        {quoteError ? (
          <div className="validationSummary danger"><XCircle size={15} /><div><strong>No usable pool quote</strong><span>{errorMessage(quoteError)}</span></div></div>
        ) : null}
        {txError ? (
          <div className="validationSummary danger"><XCircle size={15} /><div><strong>Trade failed</strong><span>{txError}</span></div></div>
        ) : null}
        <div className="riskCallout info"><ShieldCheck size={15} /><div><strong>The OTF contract performs the final checks</strong><span>The trade must use active constituents and an approved adapter, respect oracle value, NAV-loss, turnover, and exposure limits, and move every affected asset closer to target.</span></div></div>
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
  const challengeButtonLabel = !connectedAddress
    ? "Connect wallet to challenge"
    : challengeBusy
      ? challengeState === "pending" ? "Confirm in wallet" : "Confirming transaction"
      : challengeAction === "flagOutOfBand"
        ? "Challenge strategy"
        : challengeAction === "resolveOutOfBandChallenge"
          ? "Resolve challenge"
          : vault.challengeActive
            ? "Challenge active"
            : "Within challenge band";

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
    <div className="challengeActionBlock portfolioChallenge">
      <div className="subHeader">
        <span>Strategy challenge</span>
        <small>{vault.challengeActive ? "Active" : vault.withinChallengeBands ? "In bounds" : "Eligible"}</small>
      </div>
      <p>
        {vault.challengeActive
          ? vault.challengeTimeRemaining > 0
            ? `Manager fee withdrawals are locked for another ${formatCooldown(vault.challengeTimeRemaining)} while the portfolio returns to its completion band.`
            : "The response deadline has passed. The original challenger may collect forfeited fee rewards, while restoration remains available once the portfolio returns to its completion band."
            : "Anyone may start the response countdown when fresh oracle prices place the portfolio outside its challenge band."}
      </p>
        <div className="challengeRewardLine">
        <span>Caller reward</span>
        <strong>{overdueRewardCanBeSettled && !hasStoredReward ? "Calculated on claim" : vault.claimableChallengeRewardShares}</strong>
      </div>
      {challengeError ? <div className="validationSummary danger" role="alert"><AlertTriangle size={15} /><div><strong>Challenge transaction failed</strong><span>{challengeError}</span></div></div> : null}
      {rewardError ? <div className="validationSummary danger" role="alert"><AlertTriangle size={15} /><div><strong>Reward claim failed</strong><span>{rewardError}</span></div></div> : null}
      <TxStatus state={challengeState} />
      <TxStatus state={rewardState} />
      <div className="buttonRow">
        <button className="secondaryAction" type="button" disabled={!connectedAddress || !challengeAction || challengeBusy} onClick={submitChallengeAction}>
          <ShieldCheck size={14} />
          {challengeButtonLabel}
        </button>
        <button className="secondaryAction" type="button" disabled={!connectedAddress || !canClaimReward || rewardBusy} onClick={claimChallengeReward}>
          <CircleDollarSign size={14} />
          {rewardBusy ? "Claiming reward" : "Claim reward"}
        </button>
      </div>
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
    ["Portfolio change unlock", formatCooldown(vault.cooldownSeconds), "Cannot be shortened"],
    ["Strategy-change cooldown", "14 days", "Fixed protocol minimum"],
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
                        <button className="secondaryAction" type="button" onClick={(event) => {
                          event.stopPropagation();
                          onOpenVault(row.address);
                        }}>
                          Open OTF
                        </button>
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
                <th />
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
                  <td><ChevronRight size={14} /></td>
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
    thesis: "",
    manager: connectedAddress ?? "",
    feeRecipient: connectedAddress ?? "",
    creatorFee: "0.50",
    initialShares: "100",
    initialPortfolioValue: "5",
    cooldownDays: "7",
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
    draft.thesis.trim().length > 20 &&
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
    Number(draft.cooldownDays) >= 7 &&
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
    draft.thesis.trim().length > 20 ? null : "Write an initial thesis with at least 21 characters.",
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
    Number(draft.cooldownDays) >= 7 ? null : "The portfolio change unlock must be at least 7 days.",
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
      initialThesis: draft.thesis.trim(),
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
      rebalanceCooldown: daysToSeconds(draft.cooldownDays),
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
                    <input value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} placeholder="Technology Leaders" />
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
                    <small>The OTF- prefix is fixed.</small>
                  </label>
                </div>
                <label>
                  <span>Initial investment thesis</span>
                  <textarea value={draft.thesis} onChange={(event) => updateDraft("thesis", event.target.value)} rows={4} placeholder="Describe the portfolio mandate and investment rationale." />
                  <small>This begins the OTF&apos;s permanent, append-only thesis history.</small>
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
                        ? "Custom manager may propose rebalances and amend the thesis."
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
                        <select
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
                  <label><span>Manager fee</span><div className="inputWithSuffix"><input type="number" min={0} value={draft.creatorFee} onChange={(event) => updateDraft("creatorFee", event.target.value)} /><span>% / yr</span></div></label>
                  <label><span>Initial shares</span><input type="number" min={1} value={draft.initialShares} onChange={(event) => updateDraft("initialShares", event.target.value)} /><small>Minted to the manager after minimum liquidity is locked.</small></label>
                  <label><span>Portfolio change unlock</span><div className="inputWithSuffix"><input type="number" min={7} value={draft.cooldownDays} onChange={(event) => updateDraft("cooldownDays", event.target.value)} /><span>days</span></div><small>Seven-day protocol minimum between possible portfolio changes.</small></label>
                  <label><span>Maximum assets</span><input type="number" min={portfolio.length} value={draft.maxAssets} onChange={(event) => updateDraft("maxAssets", event.target.value)} /></label>
                  <label><span>Maximum turnover</span><div className="inputWithSuffix"><input type="number" value={draft.maxTurnover} onChange={(event) => updateDraft("maxTurnover", event.target.value)} /><span>% NAV</span></div></label>
                  <label><span>Maximum NAV loss</span><div className="inputWithSuffix"><input type="number" value={draft.maxNavLoss} onChange={(event) => updateDraft("maxNavLoss", event.target.value)} /><span>%</span></div></label>
                  <label><span>Completion band</span><div className="inputWithSuffix"><input type="number" value={draft.maxDeviation} onChange={(event) => updateDraft("maxDeviation", event.target.value)} /><span>+/- %</span></div><small>Portfolio must enter this narrower band to complete.</small></label>
                  <label><span>Challenge band</span><div className="inputWithSuffix"><input type="number" value={draft.challengeDeviation} onChange={(event) => updateDraft("challengeDeviation", event.target.value)} /><span>+/- %</span></div><small>Must be wider than the completion band.</small></label>
                  <label><span>Challenge grace period</span><div className="inputWithSuffix"><input type="number" min={5} max={30} value={draft.challengeGraceDays} onChange={(event) => updateDraft("challengeGraceDays", event.target.value)} /><span>days</span></div><small>Minimum: 5 days. This spans scheduled market weekends and holiday closures.</small></label>
                  <label><span>Maximum single weight</span><div className="inputWithSuffix"><input type="number" value={draft.maxSingleWeight} onChange={(event) => updateDraft("maxSingleWeight", event.target.value)} /><span>%</span></div></label>
                  <label><span>Minimum nonzero weight</span><div className="inputWithSuffix"><input type="number" value={draft.minNonzeroWeight} onChange={(event) => updateDraft("minNonzeroWeight", event.target.value)} /><span>%</span></div></label>
                  <label><span>Oracle max staleness</span><div className="inputWithSuffix"><input type="number" min={1} max={3600} step={60} value={draft.oracleStaleness} onChange={(event) => updateDraft("oracleStaleness", event.target.value)} /><span>seconds</span></div><small>Default: 30 minutes. Protocol maximum: 1 hour.</small></label>
                </div>
                <div className="executionPolicy createGuarantees">
                  <ShieldCheck size={14} />
                  <div>
                    <strong>Trade execution remains constrained</strong>
                    <span>Each partial trade uses current constituents, approved adapters, oracle limits, exact temporary approvals, and must move the basket closer to target.</span>
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
                  <div><span>Change unlock</span><strong>{draft.cooldownDays} days</strong></div>
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
                    {portfolio.map((asset, index) => <span key={asset.address}><strong>{asset.ticker}</strong>{asset.targetWeight.toFixed(1)}% / {derivedSeedAmounts[index]?.displayAmount || "Loading"} seed</span>)}
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
                            <span className="assetSymbolMark">{asset.ticker.slice(0, 4)}</span>
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
          <div><span>Change unlock</span><strong>{detailsReady ? formatCooldown(vault.cooldownSeconds) : "Loading"}</strong></div>
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
            {isTestnet ? <a className="secondaryAction" href="https://faucet.testnet.chain.robinhood.com/" target="_blank" rel="noreferrer"><Droplets size={14} />Testnet faucet<ExternalLink size={12} /></a> : null}
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
                {addressCopied ? (
                  <span className="walletAddressCopyFeedback" role="status" aria-live="polite">Address copied</span>
                ) : (
                  <button
                    className="iconOnly compact walletAddressCopyAction"
                    type="button"
                    title="Copy wallet address"
                    aria-label="Copy wallet address"
                    onClick={copyWalletAddress}
                  >
                    <Copy size={13} />
                  </button>
                )}
              </div>
              <div className="walletAddressValue">
                <strong title={connectedAddress}>{shortAddress(connectedAddress)}</strong>
              </div>
            </div>
            <MetricCard label="OTF Positions" value={positionsLoading ? "..." : String(positions.length)} />
            <MetricCard label="ETH Balance" value={nativeBalanceLabel} />
          </div>

          <section className="sectionCard depositPositions">
            <div className="directoryPanelHeading">
              <div><h2>OTF positions</h2><p>Shares held by the connected wallet.</p></div>
              <span className="stateBadge muted">{positions.length} position{positions.length === 1 ? "" : "s"}</span>
            </div>
            {positions.length ? <div className="directoryTableWrap"><table className="directoryTable depositsTable">
              <thead><tr><th>OTF</th><th>Shares</th><th>NAV / share</th><th /></tr></thead>
              <tbody>{positions.map((position) => <tr key={position.address} role="button" tabIndex={0} onClick={() => onOpenVault(position.address)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onOpenVault(position.address); }}>
                <td><div className="directoryVault"><span>{symbolMonogram(position.symbol)}</span><div><strong>{position.name}</strong><small>{position.symbol}</small></div></div></td>
                <td data-label="Shares" className="monoValue">{position.displayBalance}</td>
                <td data-label="NAV / share">{position.navPerShare ?? "Unavailable"}</td>
                <td><ChevronRight size={14} /></td>
              </tr>)}</tbody>
            </table></div> : <div className="inlineEmptyState"><CircleDollarSign size={18} /><div><strong>No OTF positions found</strong><span>Your OTF shares will appear here after a purchase or deposit.</span></div></div>}
          </section>
        </>
      ) : (
        <section className="sectionCard depositsEmpty">
          <span><Wallet size={22} /></span>
          <h2>Connect your wallet to view positions</h2>
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
            <thead><tr><th>Asset</th><th>Token address</th><th>Oracle price</th><th /></tr></thead>
            <tbody>{testnetCreateAssets.map((asset) => {
              return (
                <tr key={asset.address}>
                  <td><div className="rwaAssetIdentity"><strong>{asset.symbol}</strong><small>{asset.name}</small></div></td>
                  <td data-label="Token address" className="monoValue" title={asset.address}>{shortAssetAddress(asset.address)}</td>
                  <td data-label="Oracle price" className="monoValue">{oraclePrices[asset.address.toLowerCase()]?.display ?? "Loading"}</td>
                  <td><a className="iconOnly compact" href={`${robinhoodChainTestnet.blockExplorers.default.url}/address/${asset.address}`} target="_blank" rel="noreferrer" title={`Open ${asset.symbol} token contract`}><ExternalLink size={13} /></a></td>
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
  const [otfAmount, setOtfAmount] = useState("");
  const [usdgAmount, setUsdgAmount] = useState("");
  const [txState, setTxState] = useState<TxState>("idle");
  const [txError, setTxError] = useState<string>();
  const { address: connectedAddress } = useAccount();
  const publicClient = usePublicClient({ chainId: robinhoodChainTestnet.id });
  const { writeContractAsync } = useWriteContract();
  const router = configuredUniswapRouterAddress();
  const settlementToken = configuredSettlementTokenAddress();
  const { data: factoryResult } = useReadContract({
    address: router,
    abi: uniswapV2QuoteAbi,
    functionName: "factory",
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(router) },
  });
  const factory = typeof factoryResult === "string" && isAddress(factoryResult) ? factoryResult : undefined;
  const { data: pairResult, isLoading: pairLoading, refetch: refetchPair } = useReadContract({
    address: factory,
    abi: uniswapV2FactoryAbi,
    functionName: "getPair",
    args: vault.address && settlementToken ? [vault.address, settlementToken] : undefined,
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(factory && vault.address && settlementToken) },
  });
  const pair = typeof pairResult === "string" && isAddress(pairResult) && pairResult !== zeroAddress ? pairResult : undefined;
  const { data: settlementDecimalsResult } = useReadContract({
    address: settlementToken,
    abi: erc20BalanceAbi,
    functionName: "decimals",
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(settlementToken) },
  });
  const settlementDecimals = Number(settlementDecimalsResult ?? 18);
  let parsedOtf: bigint | undefined;
  let parsedUsdg: bigint | undefined;
  try { parsedOtf = Number(otfAmount) > 0 ? parseUnits(otfAmount, 18) : undefined; } catch { parsedOtf = undefined; }
  try { parsedUsdg = Number(usdgAmount) > 0 ? parseUnits(usdgAmount, settlementDecimals) : undefined; } catch { parsedUsdg = undefined; }
  const authorizationContracts = ([
    { address: vault.address ?? zeroAddress, abi: erc20BalanceAbi, functionName: "balanceOf" as const, args: [connectedAddress ?? zeroAddress], chainId: robinhoodChainTestnet.id },
    { address: vault.address ?? zeroAddress, abi: erc20BalanceAbi, functionName: "allowance" as const, args: [connectedAddress ?? zeroAddress, router ?? zeroAddress], chainId: robinhoodChainTestnet.id },
    { address: settlementToken ?? zeroAddress, abi: erc20BalanceAbi, functionName: "balanceOf" as const, args: [connectedAddress ?? zeroAddress], chainId: robinhoodChainTestnet.id },
    { address: settlementToken ?? zeroAddress, abi: erc20BalanceAbi, functionName: "allowance" as const, args: [connectedAddress ?? zeroAddress, router ?? zeroAddress], chainId: robinhoodChainTestnet.id },
  ] as const);
  const { data: authorization, refetch: refetchAuthorization } = useReadContracts({ contracts: authorizationContracts, query: { enabled: Boolean(vault.address && settlementToken && connectedAddress && router) } });
  const otfBalance = authorization?.[0]?.result as bigint | undefined;
  const otfAllowance = authorization?.[1]?.result as bigint | undefined;
  const usdgBalance = authorization?.[2]?.result as bigint | undefined;
  const usdgAllowance = authorization?.[3]?.result as bigint | undefined;
  const amountsReady = Boolean(parsedOtf && parsedUsdg);
  const balancesReady = amountsReady && (otfBalance ?? 0n) >= (parsedOtf ?? 0n) && (usdgBalance ?? 0n) >= (parsedUsdg ?? 0n);
  const approvalsReady = amountsReady && (otfAllowance ?? 0n) >= (parsedOtf ?? 0n) && (usdgAllowance ?? 0n) >= (parsedUsdg ?? 0n);
  const busy = txState === "pending" || txState === "submitted";

  async function createPair() {
    if (!factory || !vault.address || !settlementToken || !publicClient) return;
    setTxError(undefined);
    try {
      setTxState("pending");
      const hash = await writeContractAsync({ address: factory, abi: uniswapV2FactoryAbi, functionName: "createPair", args: [vault.address, settlementToken], chainId: robinhoodChainTestnet.id });
      setTxState("submitted");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Pool creation reverted.");
      await refetchPair();
      setTxState("confirmed");
    } catch (error) { setTxError(errorMessage(error)); setTxState("reverted"); }
  }

  async function setExactApproval(token: `0x${string}`, current: bigint, amount: bigint) {
    if (!router || !publicClient) throw new Error("The Uniswap router is not configured.");
    if (current > 0n) {
      const resetHash = await writeContractAsync({ address: token, abi: erc20BalanceAbi, functionName: "approve", args: [router, 0n], chainId: robinhoodChainTestnet.id });
      const resetReceipt = await publicClient.waitForTransactionReceipt({ hash: resetHash });
      if (resetReceipt.status !== "success") throw new Error("Approval reset reverted.");
    }
    const hash = await writeContractAsync({ address: token, abi: erc20BalanceAbi, functionName: "approve", args: [router, amount], chainId: robinhoodChainTestnet.id });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("Approval reverted.");
  }

  async function approveLiquidity() {
    if (!vault.address || !settlementToken || !parsedOtf || !parsedUsdg) return;
    setTxError(undefined);
    try {
      setTxState("pending");
      if ((otfAllowance ?? 0n) < parsedOtf) await setExactApproval(vault.address, otfAllowance ?? 0n, parsedOtf);
      if ((usdgAllowance ?? 0n) < parsedUsdg) await setExactApproval(settlementToken, usdgAllowance ?? 0n, parsedUsdg);
      await refetchAuthorization();
      setTxState("confirmed");
    } catch (error) { setTxError(errorMessage(error)); setTxState("reverted"); }
  }

  async function addLiquidity() {
    if (!router || !vault.address || !settlementToken || !connectedAddress || !publicClient || !parsedOtf || !parsedUsdg) return;
    setTxError(undefined);
    try {
      setTxState("pending");
      const hash = await writeContractAsync({
        address: router,
        abi: uniswapV2QuoteAbi,
        functionName: "addLiquidity",
        args: [vault.address, settlementToken, parsedOtf, parsedUsdg, parsedOtf * 95n / 100n, parsedUsdg * 95n / 100n, connectedAddress, BigInt(Math.floor(Date.now() / 1_000) + 20 * 60)],
        chainId: robinhoodChainTestnet.id,
      });
      setTxState("submitted");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Adding liquidity reverted.");
      await refetchAuthorization();
      setOtfAmount(""); setUsdgAmount(""); setTxState("confirmed");
    } catch (error) { setTxError(errorMessage(error)); setTxState("reverted"); }
  }

  return (
    <SectionCard title="OTF share market" subtitle="Create and seed the direct OTF / USDG market" icon={<Droplets size={15} />} action={<span className={`stateBadge ${pair ? "success" : "muted"}`}>{pairLoading ? "Checking" : pair ? "Pool created" : "No pool"}</span>}>
      <div className="operationFlow shareMarketSetup">
        <div className="riskCallout info"><Info size={15} /><div><strong>Liquidity comes from the manager wallet</strong><span>This does not move assets held by the OTF. The pool price can differ from the OTF’s oracle-priced portfolio value.</span></div></div>
        <div className="roleCurrent"><span>OTF / USDG pair</span><strong>{pair ? shortAddress(pair) : "Not created"}</strong></div>
        {!pair ? <button className="primaryAction" type="button" disabled={!vault.connectedIsManager || !factory || busy} onClick={createPair}><Plus size={14} />Create share pool</button> : <>
          <div className="liquidityAmountGrid">
            <div><label className="fieldLabel">OTF shares</label><div className="inputWithSuffix"><input value={otfAmount} onChange={(event) => setOtfAmount(event.target.value)} type="number" min="0" placeholder="0.00" disabled={busy} /><span>{vault.symbol}</span></div></div>
            <div><label className="fieldLabel">USDG</label><div className="inputWithSuffix"><input value={usdgAmount} onChange={(event) => setUsdgAmount(event.target.value)} type="number" min="0" placeholder="0.00" disabled={busy} /><span>USDG</span></div></div>
          </div>
          {amountsReady && !balancesReady ? <div className="validationSummary danger"><AlertTriangle size={15} /><div><strong>Insufficient wallet balance</strong><span>The manager wallet must supply both OTF shares and USDG.</span></div></div> : null}
          {txError ? <div className="validationSummary danger"><AlertTriangle size={15} /><div><strong>Share-market setup failed</strong><span>{txError}</span></div></div> : null}
          <TxStatus state={txState} />
          <div className="buttonRow"><button className="secondaryAction" type="button" disabled={!vault.connectedIsManager || busy || !balancesReady || approvalsReady} onClick={approveLiquidity}><ShieldCheck size={14} />{approvalsReady ? "Assets approved" : "Approve liquidity"}</button><button className="primaryAction" type="button" disabled={!vault.connectedIsManager || busy || !balancesReady || !approvalsReady} onClick={addLiquidity}><Droplets size={14} />Add liquidity</button></div>
        </>}
      </div>
    </SectionCard>
  );
}

function ManageVaultsView({
  vault,
  onBack,
  onOpenVault,
  onRefresh,
}: {
  vault: VaultView;
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
  const [activeOperation, setActiveOperation] = useState<"targets" | "rebalance" | "liquidity" | "roles" | "fees" | "thesis">("targets");
  const { address: connectedAddress } = useAccount();
  const publicClient = usePublicClient({ chainId: robinhoodChainTestnet.id });
  const { writeContractAsync } = useWriteContract();
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
        <MetricCard label="Current Manager" value={shortAddress(vault.manager)} icon={<KeyRound size={14} />} sub="Immediate transfer" />
        <MetricCard label="Fee Recipient" value={shortAddress(vault.feeRecipient)} icon={<ReceiptText size={14} />} sub="Immediate update" />
        <MetricCard label="Manager Fee" value={bpsToPercent(vault.creatorFeeBps)} icon={<Percent size={14} />} sub={["Withdrawable", "Challenge active", "Challenge overdue"][vault.feeState] ?? "Unavailable"} />
        <MetricCard label="Portfolio Change Unlock" value={formatCooldown(vault.cooldownSeconds)} icon={<Clock3 size={14} />} sub="Permanently immutable" />
      </div>

      <div className="managerOperationTabs" role="tablist" aria-label="Manager operations">
        {([
          ["targets", "Update targets"],
          ["rebalance", "Rebalance"],
          ["liquidity", "Liquidity"],
          ["roles", "Roles"],
          ["fees", "Fees"],
          ["thesis", "Thesis"],
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

      {activeOperation === "rebalance" ? <RebalanceTradesPanel vault={vault} onRefresh={onRefresh} /> : null}

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
        <SectionCard title="Manager fees" subtitle="Withdraw fees when the portfolio is inside its target bands" icon={<CircleDollarSign size={15} />} action={<span className={`stateBadge ${vault.feeState === 2 ? "danger" : vault.feeState === 1 ? "warning" : "success"}`}>{["Withdrawable", "Challenge active", "Challenge overdue"][vault.feeState] ?? "Unavailable"}</span>}>
          <div className="operationFlow">
            <div className="accrualSummary">
              <div><span>Manager fee</span><strong>{bpsToPercent(vault.creatorFeeBps)} / yr</strong></div>
              <div><span>Protocol share</span><strong>{bpsToPercent(vault.protocolFeeShareBps)}</strong></div>
              <div><span>Forfeited fees</span><strong>{vault.forfeitedManagerFeeShares}</strong></div>
              <div><span>Your caller reward</span><strong>{vault.claimableChallengeRewardShares}</strong></div>
            </div>
            <div className="riskCallout info"><Info size={15} /><div><strong>Targets gate fee withdrawals</strong><span>If the manager tries to withdraw while the portfolio is outside challenge bands, the strategy challenge starts instead.</span></div></div>
            {feeAccrualError ? <div className="riskCallout danger"><AlertTriangle size={15} /><div><strong>Fee withdrawal failed</strong><span>{feeAccrualError}</span></div></div> : null}
            <TxStatus state={feeAccrualState} />
            <button
              className="secondaryAction"
              type="button"
              disabled={!connectedAddress || !vault.connectedIsManager || feeAccrualState === "pending" || feeAccrualState === "submitted"}
              onClick={withdrawVaultFees}
            >
              <CircleDollarSign size={14} />
              Withdraw manager fees
            </button>
          </div>
        </SectionCard>
        ) : null}

        {activeOperation === "thesis" ? (
          <ThesisAmendmentCard
            currentThesis={vault.currentThesis}
            canManage={vault.connectedIsManager && vault.enabled}
            vaultAddress={vault.address}
            onRefresh={onRefresh}
          />
        ) : null}

        {activeOperation === "roles" ? (
        <SectionCard title="Manager permissions" subtitle="Capabilities constrained by the OTF contract" icon={<ShieldCheck size={15} />} action={<span className="stateBadge muted">Onchain</span>}>
          <div className="permissionList">
            <div><CheckCircle size={14} /><span><strong>May propose strategic targets</strong><small>Targets lock until the basket reaches its completion bands.</small></span></div>
            <div><CheckCircle size={14} /><span><strong>May authorize constrained executors</strong><small>{vault.authorizedExecutors.length} currently authorized; all are cleared on manager transfer.</small></span></div>
            <div><CheckCircle size={14} /><span><strong>May execute partial maintenance trades</strong><small>Every batch must reduce target deviation and satisfy oracle, adapter, slippage, turnover, and exposure limits.</small></span></div>
            <div><CheckCircle size={14} /><span><strong>May append thesis amendments</strong><small>History remains permanent and public.</small></span></div>
            <div><XCircle size={14} /><span><strong>Cannot withdraw portfolio assets</strong><small>No arbitrary manager-call or asset-transfer path exists.</small></span></div>
            <div><XCircle size={14} /><span><strong>Cannot shorten the change unlock</strong><small>The configured delay is permanently immutable.</small></span></div>
          </div>
        </SectionCard>
        ) : null}
        {activeOperation === "roles" ? (
          <div className="riskCallout info manageNotice">
            <Info size={15} />
            <div><strong>Role transfers leave the change unlock unchanged</strong><span>The next eligible portfolio change stays the same because changing an address does not change the portfolio.</span></div>
          </div>
        ) : null}
      </div> : null}
    </div>
  );
}

