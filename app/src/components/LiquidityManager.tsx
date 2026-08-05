"use client";

import { AlertTriangle, ArrowDownToLine, ArrowLeft, CheckCircle, Droplets, ExternalLink, Loader2, MinusCircle, PlusCircle, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  encodeFunctionData,
  formatUnits,
  getAddress,
  isAddress,
  isAddressEqual,
  parseEventLogs,
  parseUnits,
  zeroAddress,
  type Address,
  type Hash,
} from "viem";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { Providers } from "@/app/providers";
import { robinhoodChainTestnet } from "@/lib/chains";
import { robinhoodTestnetAddresses, robinhoodTestnetV3Venue } from "@/lib/deployment";
import { TopNav, WalletConnectionAction } from "./RebalanceCooldownPanel";

const MIN_TICK = -887272;
const MAX_TICK = 887272;
const MAX_UINT128 = (1n << 128n) - 1n;
const OTF_FEE = 500;

const assetNames: Record<string, string> = {
  "0xc9f9c86933092bbbfff3ccb4b105a4a94bf3bd4e": "TSLA",
  "0x5884ad2f920c162cfbbacc88c9c51aa75ec09e02": "AMZN",
  "0x1fbe1a0e43594b3455993b5de5fd0a7a266298d0": "PLTR",
  "0x3b8262a63d25f0477c4dde23f83cfe22cb768c93": "NFLX",
  "0x71178bac73cbeb415514eb542a8995b82669778d": "AMD",
};

const erc20Abi = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [{ type: "address", name: "spender" }, { type: "uint256", name: "amount" }],
    outputs: [{ type: "bool" }],
  },
] as const;

const poolAbi = [
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "fee", stateMutability: "view", inputs: [], outputs: [{ type: "uint24" }] },
  { type: "function", name: "liquidity", stateMutability: "view", inputs: [], outputs: [{ type: "uint128" }] },
  {
    type: "function",
    name: "slot0",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { type: "uint160", name: "sqrtPriceX96" },
      { type: "int24", name: "tick" },
      { type: "uint16", name: "observationIndex" },
      { type: "uint16", name: "observationCardinality" },
      { type: "uint16", name: "observationCardinalityNext" },
      { type: "uint8", name: "feeProtocol" },
      { type: "bool", name: "unlocked" },
    ],
  },
] as const;

const v3FactoryAbi = [
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }, { type: "uint24" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "feeAmountTickSpacing",
    stateMutability: "view",
    inputs: [{ type: "uint24" }],
    outputs: [{ type: "int24" }],
  },
] as const;

const marketRegistryAbi = [{
  type: "function",
  name: "officialPool",
  stateMutability: "view",
  inputs: [{ type: "address", name: "vault" }],
  outputs: [{ type: "address", name: "pool" }],
}] as const;

const positionManagerAbi = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ type: "uint256", name: "tokenId" }],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "positions",
    stateMutability: "view",
    inputs: [{ type: "uint256", name: "tokenId" }],
    outputs: [
      { type: "uint96", name: "nonce" },
      { type: "address", name: "operator" },
      { type: "address", name: "token0" },
      { type: "address", name: "token1" },
      { type: "uint24", name: "fee" },
      { type: "int24", name: "tickLower" },
      { type: "int24", name: "tickUpper" },
      { type: "uint128", name: "liquidity" },
      { type: "uint256", name: "feeGrowthInside0LastX128" },
      { type: "uint256", name: "feeGrowthInside1LastX128" },
      { type: "uint128", name: "tokensOwed0" },
      { type: "uint128", name: "tokensOwed1" },
    ],
  },
  {
    type: "function",
    name: "mint",
    stateMutability: "payable",
    inputs: [{
      type: "tuple",
      name: "params",
      components: [
        { type: "address", name: "token0" },
        { type: "address", name: "token1" },
        { type: "uint24", name: "fee" },
        { type: "int24", name: "tickLower" },
        { type: "int24", name: "tickUpper" },
        { type: "uint256", name: "amount0Desired" },
        { type: "uint256", name: "amount1Desired" },
        { type: "uint256", name: "amount0Min" },
        { type: "uint256", name: "amount1Min" },
        { type: "address", name: "recipient" },
        { type: "uint256", name: "deadline" },
      ],
    }],
    outputs: [
      { type: "uint256", name: "tokenId" },
      { type: "uint128", name: "liquidity" },
      { type: "uint256", name: "amount0" },
      { type: "uint256", name: "amount1" },
    ],
  },
  {
    type: "function",
    name: "decreaseLiquidity",
    stateMutability: "payable",
    inputs: [{
      type: "tuple",
      name: "params",
      components: [
        { type: "uint256", name: "tokenId" },
        { type: "uint128", name: "liquidity" },
        { type: "uint256", name: "amount0Min" },
        { type: "uint256", name: "amount1Min" },
        { type: "uint256", name: "deadline" },
      ],
    }],
    outputs: [{ type: "uint256", name: "amount0" }, { type: "uint256", name: "amount1" }],
  },
  {
    type: "function",
    name: "collect",
    stateMutability: "payable",
    inputs: [{
      type: "tuple",
      name: "params",
      components: [
        { type: "uint256", name: "tokenId" },
        { type: "address", name: "recipient" },
        { type: "uint128", name: "amount0Max" },
        { type: "uint128", name: "amount1Max" },
      ],
    }],
    outputs: [{ type: "uint256", name: "amount0" }, { type: "uint256", name: "amount1" }],
  },
  {
    type: "function",
    name: "multicall",
    stateMutability: "payable",
    inputs: [{ type: "bytes[]", name: "data" }],
    outputs: [{ type: "bytes[]", name: "results" }],
  },
] as const;

const erc721TransferEventAbi = [{
  type: "event",
  name: "Transfer",
  inputs: [
    { indexed: true, type: "address", name: "from" },
    { indexed: true, type: "address", name: "to" },
    { indexed: true, type: "uint256", name: "tokenId" },
  ],
}] as const;

type Position = readonly [
  bigint,
  Address,
  Address,
  Address,
  number,
  number,
  number,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
];

type TxPhase = "idle" | "approving" | "simulating" | "signing" | "confirming" | "confirmed" | "error";

function parseAmount(value: string, decimals: number | undefined): bigint | undefined {
  if (decimals === undefined || !value.trim()) return undefined;
  try {
    const parsed = parseUnits(value, decimals);
    return parsed > 0n ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function formatAmount(value: bigint | undefined, decimals: number | undefined): string {
  if (value === undefined || decimals === undefined) return "—";
  const numeric = Number(formatUnits(value, decimals));
  return numeric.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function shortAddress(value: string | undefined): string {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "Not resolved";
}

function friendlyError(error: unknown): string {
  if (error && typeof error === "object" && "shortMessage" in error) {
    return String((error as { shortMessage?: unknown }).shortMessage);
  }
  if (error instanceof Error) return error.message;
  return "The wallet request could not be completed.";
}

function fullRangeTicks(tickSpacing: number | undefined): [number, number] | undefined {
  if (!tickSpacing || tickSpacing <= 0) return undefined;
  return [Math.ceil(MIN_TICK / tickSpacing) * tickSpacing, Math.floor(MAX_TICK / tickSpacing) * tickSpacing];
}

function LiquidityWorkspace() {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId: robinhoodChainTestnet.id });
  const { switchChainAsync, isPending: switchingNetwork } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const positionManager = robinhoodTestnetAddresses.uniswapV3PositionManager;
  const v3Factory = robinhoodTestnetAddresses.uniswapV3Factory;
  const settlementToken = robinhoodTestnetAddresses.usdg;
  const marketRegistry = robinhoodTestnetAddresses.v3MarketRegistry;
  const configuredMarkets = robinhoodTestnetV3Venue.constituentPools;
  const initialVault = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("vault") ?? "";
  const [marketChoice, setMarketChoice] = useState(initialVault && isAddress(initialVault) ? "otf" : configuredMarkets[0]?.asset ?? "otf");
  const [otfAddress, setOtfAddress] = useState(initialVault);
  const [operation, setOperation] = useState<"add" | "remove">("add");
  const [amount0Text, setAmount0Text] = useState("");
  const [amount1Text, setAmount1Text] = useState("");
  const [positionIdText, setPositionIdText] = useState("");
  const [removePercent, setRemovePercent] = useState(100);
  const [slippageText, setSlippageText] = useState("1.0");
  const [phase, setPhase] = useState<TxPhase>("idle");
  const [statusText, setStatusText] = useState("Choose a market and enter token amounts.");
  const [lastHash, setLastHash] = useState<Hash>();

  const validOtfAddress = isAddress(otfAddress) ? getAddress(otfAddress) : undefined;
  const selectedConstituent = configuredMarkets.find(
    (market) => market.asset.toLowerCase() === marketChoice.toLowerCase(),
  );
  const isOtfMarket = marketChoice === "otf";

  const { data: officialPool, isLoading: officialPoolLoading } = useReadContract({
    address: marketRegistry,
    abi: marketRegistryAbi,
    functionName: "officialPool",
    args: validOtfAddress ? [validOtfAddress] : undefined,
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(isOtfMarket && validOtfAddress && marketRegistry) },
  });

  const assetAddress = isOtfMarket ? validOtfAddress : selectedConstituent?.asset;
  const fee = isOtfMarket ? OTF_FEE : selectedConstituent?.fee;
  const poolAddress = isOtfMarket
    ? officialPool && !isAddressEqual(officialPool, zeroAddress) ? officialPool : undefined
    : selectedConstituent?.pool;
  const token0 = assetAddress && settlementToken
    ? BigInt(assetAddress) < BigInt(settlementToken) ? assetAddress : settlementToken
    : undefined;
  const token1 = assetAddress && settlementToken
    ? isAddressEqual(token0!, assetAddress) ? settlementToken : assetAddress
    : undefined;

  const { data: resolvedFactoryPool } = useReadContract({
    address: v3Factory,
    abi: v3FactoryAbi,
    functionName: "getPool",
    args: assetAddress && settlementToken && fee !== undefined ? [assetAddress, settlementToken, fee] : undefined,
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(v3Factory && assetAddress && settlementToken && fee !== undefined) },
  });
  const { data: tickSpacing } = useReadContract({
    address: v3Factory,
    abi: v3FactoryAbi,
    functionName: "feeAmountTickSpacing",
    args: fee !== undefined ? [fee] : undefined,
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(v3Factory && fee !== undefined) },
  });
  const { data: actualToken0 } = useReadContract({ address: poolAddress, abi: poolAbi, functionName: "token0", chainId: robinhoodChainTestnet.id, query: { enabled: Boolean(poolAddress) } });
  const { data: actualToken1 } = useReadContract({ address: poolAddress, abi: poolAbi, functionName: "token1", chainId: robinhoodChainTestnet.id, query: { enabled: Boolean(poolAddress) } });
  const { data: actualFee } = useReadContract({ address: poolAddress, abi: poolAbi, functionName: "fee", chainId: robinhoodChainTestnet.id, query: { enabled: Boolean(poolAddress) } });
  const { data: poolLiquidity, refetch: refetchPoolLiquidity } = useReadContract({ address: poolAddress, abi: poolAbi, functionName: "liquidity", chainId: robinhoodChainTestnet.id, query: { enabled: Boolean(poolAddress), refetchInterval: 12_000 } });
  const { data: slot0 } = useReadContract({ address: poolAddress, abi: poolAbi, functionName: "slot0", chainId: robinhoodChainTestnet.id, query: { enabled: Boolean(poolAddress) } });

  const { data: token0Symbol } = useReadContract({ address: token0, abi: erc20Abi, functionName: "symbol", chainId: robinhoodChainTestnet.id, query: { enabled: Boolean(token0) } });
  const { data: token1Symbol } = useReadContract({ address: token1, abi: erc20Abi, functionName: "symbol", chainId: robinhoodChainTestnet.id, query: { enabled: Boolean(token1) } });
  const { data: token0Decimals } = useReadContract({ address: token0, abi: erc20Abi, functionName: "decimals", chainId: robinhoodChainTestnet.id, query: { enabled: Boolean(token0) } });
  const { data: token1Decimals } = useReadContract({ address: token1, abi: erc20Abi, functionName: "decimals", chainId: robinhoodChainTestnet.id, query: { enabled: Boolean(token1) } });
  const { data: token0Balance, refetch: refetchToken0Balance } = useReadContract({ address: token0, abi: erc20Abi, functionName: "balanceOf", args: [address ?? zeroAddress], chainId: robinhoodChainTestnet.id, query: { enabled: Boolean(token0 && address), refetchInterval: 12_000 } });
  const { data: token1Balance, refetch: refetchToken1Balance } = useReadContract({ address: token1, abi: erc20Abi, functionName: "balanceOf", args: [address ?? zeroAddress], chainId: robinhoodChainTestnet.id, query: { enabled: Boolean(token1 && address), refetchInterval: 12_000 } });
  const { data: token0Allowance, refetch: refetchToken0Allowance } = useReadContract({ address: token0, abi: erc20Abi, functionName: "allowance", args: [address ?? zeroAddress, positionManager ?? zeroAddress], chainId: robinhoodChainTestnet.id, query: { enabled: Boolean(token0 && address && positionManager) } });
  const { data: token1Allowance, refetch: refetchToken1Allowance } = useReadContract({ address: token1, abi: erc20Abi, functionName: "allowance", args: [address ?? zeroAddress, positionManager ?? zeroAddress], chainId: robinhoodChainTestnet.id, query: { enabled: Boolean(token1 && address && positionManager) } });

  const range = fullRangeTicks(tickSpacing);
  const amount0Desired = parseAmount(amount0Text, token0Decimals);
  const amount1Desired = parseAmount(amount1Text, token1Decimals);
  const slippageBps = Math.round(Number(slippageText) * 100);
  const slippageValid = Number.isFinite(slippageBps) && slippageBps >= 1 && slippageBps <= 2_000;
  const poolVerified = Boolean(
    poolAddress && resolvedFactoryPool && isAddressEqual(poolAddress, resolvedFactoryPool)
      && token0 && token1 && actualToken0 && actualToken1
      && isAddressEqual(token0, actualToken0) && isAddressEqual(token1, actualToken1)
      && actualFee === fee && slot0?.[0] && slot0[0] > 0n && range,
  );
  const marketLabel = isOtfMarket
    ? `${token0Symbol === "USDG" ? token1Symbol ?? "OTF" : token0Symbol ?? "OTF"}/USDG`
    : `${assetNames[selectedConstituent?.asset.toLowerCase() ?? ""] ?? "RWA"}/USDG`;

  let positionId: bigint | undefined;
  try {
    if (positionIdText.trim()) positionId = BigInt(positionIdText);
  } catch {
    positionId = undefined;
  }
  const { data: positionOwner, isError: positionOwnerError, refetch: refetchPositionOwner } = useReadContract({
    address: positionManager,
    abi: positionManagerAbi,
    functionName: "ownerOf",
    args: positionId !== undefined ? [positionId] : undefined,
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(positionManager && positionId !== undefined) },
  });
  const { data: positionData, isError: positionError, refetch: refetchPosition } = useReadContract({
    address: positionManager,
    abi: positionManagerAbi,
    functionName: "positions",
    args: positionId !== undefined ? [positionId] : undefined,
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(positionManager && positionId !== undefined) },
  });
  const position = positionData as Position | undefined;
  const positionMatchesMarket = Boolean(
    position && token0 && token1 && range
      && isAddressEqual(position[2], token0) && isAddressEqual(position[3], token1)
      && position[4] === fee && position[5] === range[0] && position[6] === range[1],
  );
  const positionOwned = Boolean(address && positionOwner && isAddressEqual(address, positionOwner));
  const positionLiquidity = position?.[7];
  const liquidityToRemove = positionLiquidity && removePercent > 0
    ? positionLiquidity * BigInt(removePercent) / 100n
    : undefined;
  const busy = phase === "approving" || phase === "simulating" || phase === "signing" || phase === "confirming";
  const canAdd = Boolean(
    address && chainId === robinhoodChainTestnet.id && publicClient && positionManager
      && poolVerified && token0 && token1 && range && amount0Desired && amount1Desired
      && amount0Desired <= (token0Balance ?? 0n) && amount1Desired <= (token1Balance ?? 0n)
      && slippageValid && !busy,
  );
  const canRemove = Boolean(
    address && chainId === robinhoodChainTestnet.id && publicClient && positionManager
      && poolVerified && positionId !== undefined && positionOwned && positionMatchesMarket
      && liquidityToRemove && liquidityToRemove > 0n && slippageValid && !busy,
  );

  useEffect(() => {
    setAmount0Text("");
    setAmount1Text("");
    setPositionIdText("");
    setPhase("idle");
    setStatusText("Choose a market and enter token amounts.");
    setLastHash(undefined);
  }, [marketChoice, otfAddress]);

  function changeOperation(nextOperation: "add" | "remove") {
    if (busy) return;
    setOperation(nextOperation);
    setPhase("idle");
    setStatusText(
      nextOperation === "add"
        ? "Choose a market and enter token amounts."
        : "Enter a full-range position NFT ID and choose how much liquidity to remove.",
    );
    setLastHash(undefined);
  }

  async function waitFor(hash: Hash) {
    if (!publicClient) throw new Error("Robinhood testnet client is unavailable.");
    setLastHash(hash);
    setPhase("confirming");
    setStatusText("Transaction submitted. Waiting for confirmation.");
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("The transaction reverted on-chain.");
    return receipt;
  }

  async function approveIfNeeded(token: Address, current: bigint | undefined, required: bigint, symbol: string) {
    if (!positionManager || !publicClient) throw new Error("Synthra position manager is unavailable.");
    if ((current ?? 0n) >= required) return;
    setPhase("approving");
    if ((current ?? 0n) > 0n) {
      setStatusText(`Reset the existing ${symbol} approval in your wallet.`);
      const resetHash = await writeContractAsync({ address: token, abi: erc20Abi, functionName: "approve", args: [positionManager, 0n], chainId: robinhoodChainTestnet.id });
      const resetReceipt = await publicClient.waitForTransactionReceipt({ hash: resetHash });
      if (resetReceipt.status !== "success") throw new Error(`${symbol} approval reset reverted.`);
    }
    setStatusText(`Approve the exact ${symbol} maximum in your wallet.`);
    const approvalHash = await writeContractAsync({ address: token, abi: erc20Abi, functionName: "approve", args: [positionManager, required], chainId: robinhoodChainTestnet.id });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash });
    if (receipt.status !== "success") throw new Error(`${symbol} approval reverted.`);
  }

  async function refreshMarket() {
    await Promise.all([
      refetchPoolLiquidity(),
      refetchToken0Balance(),
      refetchToken1Balance(),
      refetchToken0Allowance(),
      refetchToken1Allowance(),
      refetchPositionOwner(),
      refetchPosition(),
    ]);
  }

  async function addLiquidity() {
    if (!canAdd || !address || !publicClient || !positionManager || !token0 || !token1 || !range || !amount0Desired || !amount1Desired || fee === undefined) return;
    try {
      setLastHash(undefined);
      await approveIfNeeded(token0, token0Allowance, amount0Desired, token0Symbol ?? "token 0");
      await approveIfNeeded(token1, token1Allowance, amount1Desired, token1Symbol ?? "token 1");
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
      const baseParams = {
        token0,
        token1,
        fee,
        tickLower: range[0],
        tickUpper: range[1],
        amount0Desired,
        amount1Desired,
        amount0Min: 0n,
        amount1Min: 0n,
        recipient: address,
        deadline,
      };
      setPhase("simulating");
      setStatusText("Simulating the full-range position at the current pool price.");
      const preview = await publicClient.simulateContract({
        address: positionManager,
        abi: positionManagerAbi,
        functionName: "mint",
        args: [baseParams],
        account: address,
      });
      const [, , expectedAmount0, expectedAmount1] = preview.result;
      const amount0Min = expectedAmount0 * BigInt(10_000 - slippageBps) / 10_000n;
      const amount1Min = expectedAmount1 * BigInt(10_000 - slippageBps) / 10_000n;
      await publicClient.simulateContract({
        address: positionManager,
        abi: positionManagerAbi,
        functionName: "mint",
        args: [{ ...baseParams, amount0Min, amount1Min }],
        account: address,
      });
      setPhase("signing");
      setStatusText("Simulation passed. Confirm the position mint in your wallet.");
      const hash = await writeContractAsync({
        address: positionManager,
        abi: positionManagerAbi,
        functionName: "mint",
        args: [{ ...baseParams, amount0Min, amount1Min }],
        chainId: robinhoodChainTestnet.id,
      });
      const receipt = await waitFor(hash);
      const mintedPosition = parseEventLogs({
        abi: erc721TransferEventAbi,
        logs: receipt.logs,
        eventName: "Transfer",
        strict: false,
      }).find((event) => isAddressEqual(event.address, positionManager)
        && event.args.from !== undefined && event.args.to !== undefined
        && isAddressEqual(event.args.from, zeroAddress) && isAddressEqual(event.args.to, address));
      const mintedTokenId = mintedPosition?.args.tokenId;
      setPhase("confirmed");
      setStatusText(mintedTokenId !== undefined
        ? `Full-range position #${mintedTokenId} created in your wallet.`
        : "Full-range liquidity position created. The position NFT belongs to your wallet.");
      if (mintedTokenId !== undefined) setPositionIdText(mintedTokenId.toString());
      setAmount0Text("");
      setAmount1Text("");
      await refreshMarket();
    } catch (error) {
      setPhase("error");
      setStatusText(friendlyError(error));
    }
  }

  async function removeLiquidity() {
    if (!canRemove || !address || !publicClient || !positionManager || positionId === undefined || !liquidityToRemove) return;
    try {
      setLastHash(undefined);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
      const previewParams = { tokenId: positionId, liquidity: liquidityToRemove, amount0Min: 0n, amount1Min: 0n, deadline };
      setPhase("simulating");
      setStatusText("Simulating liquidity removal and fee collection.");
      const preview = await publicClient.simulateContract({
        address: positionManager,
        abi: positionManagerAbi,
        functionName: "decreaseLiquidity",
        args: [previewParams],
        account: address,
      });
      const [expectedAmount0, expectedAmount1] = preview.result;
      const amount0Min = expectedAmount0 * BigInt(10_000 - slippageBps) / 10_000n;
      const amount1Min = expectedAmount1 * BigInt(10_000 - slippageBps) / 10_000n;
      const decreaseCall = encodeFunctionData({
        abi: positionManagerAbi,
        functionName: "decreaseLiquidity",
        args: [{ ...previewParams, amount0Min, amount1Min }],
      });
      const collectCall = encodeFunctionData({
        abi: positionManagerAbi,
        functionName: "collect",
        args: [{ tokenId: positionId, recipient: address, amount0Max: MAX_UINT128, amount1Max: MAX_UINT128 }],
      });
      await publicClient.simulateContract({
        address: positionManager,
        abi: positionManagerAbi,
        functionName: "multicall",
        args: [[decreaseCall, collectCall]],
        account: address,
      });
      setPhase("signing");
      setStatusText("Simulation passed. Confirm removal and collection in your wallet.");
      const hash = await writeContractAsync({
        address: positionManager,
        abi: positionManagerAbi,
        functionName: "multicall",
        args: [[decreaseCall, collectCall]],
        chainId: robinhoodChainTestnet.id,
      });
      await waitFor(hash);
      setPhase("confirmed");
      setStatusText("Liquidity removed and all currently owed tokens collected to your wallet.");
      await refreshMarket();
    } catch (error) {
      setPhase("error");
      setStatusText(friendlyError(error));
    }
  }

  function navigate(tab: string) {
    if (tab === "RWAs") window.location.assign("/rwas");
    else if (tab === "Liquidity") window.location.assign("/liquidity");
    else window.location.assign("/otfs");
  }

  const statusTone = phase === "confirmed" ? "success" : phase === "error" ? "danger" : busy ? "working" : "neutral";
  const positionProblem = positionIdText && (positionOwnerError || positionError)
    ? "That position NFT could not be read from Synthra."
    : positionIdText && positionOwner && !positionOwned
      ? "The connected wallet does not own this position NFT."
      : positionIdText && position && !positionMatchesMarket
        ? "This NFT is not a full-range position for the selected market."
        : undefined;

  return (
    <div className="otfAppShell">
      <TopNav
        activeTab="Liquidity"
        depositsActive={false}
        onHome={() => window.location.assign("/")}
        onTabChange={navigate}
        onOpenDeposits={() => window.location.assign("/wallet")}
      />
      <main className="dashboardMain liquidityPage">
        <div className="liquidityBreadcrumb">
          <Link href="/otfs"><ArrowLeft size={13} /> OTFs</Link>
          <span>/</span>
          <strong>Liquidity</strong>
        </div>

        <section className="liquidityIntro">
          <div>
            <h1>Testnet liquidity</h1>
            <p>Add or remove wallet-owned, full-range Synthra V3 positions on Robinhood Chain Testnet. Testnet assets have no real-world value.</p>
          </div>
          <div className="liquidityBadges" aria-label="Liquidity constraints">
            <span>Synthra V3</span>
            <span>Full range only</span>
            <span>Testnet</span>
          </div>
        </section>

        <div className="liquidityLayout">
          <aside className="liquidityMarketPanel">
            <div className="liquidityPanelHeading">
              <Droplets size={17} />
              <div><strong>Market</strong><span>Select the pool your position will use.</span></div>
            </div>
            <label className="liquidityField">
              <span>Pool</span>
              <select value={marketChoice} onChange={(event) => setMarketChoice(event.target.value)}>
                {configuredMarkets.map((market) => (
                  <option key={market.asset} value={market.asset}>
                    {assetNames[market.asset.toLowerCase()] ?? "RWA"}/USDG · 0.30%
                  </option>
                ))}
                <option value="otf">Official OTF/USDG · 0.05%</option>
              </select>
            </label>
            {isOtfMarket ? (
              <label className="liquidityField">
                <span>OTF address</span>
                <input value={otfAddress} onChange={(event) => setOtfAddress(event.target.value.trim())} placeholder="0x…" spellCheck={false} />
                <small>The official pool is resolved from the protocol’s immutable market registry.</small>
              </label>
            ) : null}

            <div className="liquidityPoolRecord">
              <div><span>Selected market</span><strong>{marketLabel}</strong></div>
              <div><span>Pool</span><strong>{officialPoolLoading ? "Resolving…" : shortAddress(poolAddress)}</strong></div>
              <div><span>Fee tier</span><strong>{fee !== undefined ? `${(fee / 10_000).toFixed(2)}%` : "—"}</strong></div>
              <div><span>Active liquidity</span><strong className={poolLiquidity && poolLiquidity > 0n ? "successText" : "warningText"}>{poolLiquidity && poolLiquidity > 0n ? "Active" : "Empty"}</strong></div>
            </div>

            {poolAddress ? (
              <a className="liquidityExplorerLink" href={`${robinhoodChainTestnet.blockExplorers.default.url}/address/${poolAddress}`} target="_blank" rel="noreferrer">
                Inspect pool contract <ExternalLink size={12} />
              </a>
            ) : null}
            {!poolVerified && poolAddress ? (
              <div className="validationSummary danger"><AlertTriangle size={15} /><div><strong>Pool verification failed</strong><span>The recorded pool does not match Synthra’s canonical factory result or is not initialized.</span></div></div>
            ) : null}
            {isOtfMarket && validOtfAddress && !officialPoolLoading && !poolAddress ? (
              <div className="validationSummary"><AlertTriangle size={15} /><div><strong>No official pool found</strong><span>This address is not a deployed OTF from the current factory, or its market was not created.</span></div></div>
            ) : null}
          </aside>

          <section className="liquidityActionPanel">
            <div className="liquidityOperationTabs" role="tablist" aria-label="Liquidity operation">
              <button className={operation === "add" ? "active" : ""} type="button" role="tab" aria-selected={operation === "add"} onClick={() => changeOperation("add")}><PlusCircle size={15} /> Add liquidity</button>
              <button className={operation === "remove" ? "active" : ""} type="button" role="tab" aria-selected={operation === "remove"} onClick={() => changeOperation("remove")}><MinusCircle size={15} /> Remove liquidity</button>
            </div>

            <div className="liquidityActionBody">
              <div className="fullRangeNotice"><ShieldCheck size={16} /><div><strong>Full-range position</strong><span>Ticks are fixed to {range ? `${range[0].toLocaleString()} → ${range[1].toLocaleString()}` : "the widest valid range"}. You cannot configure a concentrated range here.</span></div></div>

              {operation === "add" ? (
                <>
                  <div className="liquidityTokenInputs">
                    <label className="liquidityTokenInput">
                      <span><strong>{token0Symbol ?? "Token 0"}</strong><small>Balance {formatAmount(token0Balance, token0Decimals)}</small></span>
                      <input inputMode="decimal" value={amount0Text} onChange={(event) => setAmount0Text(event.target.value)} placeholder="0.0" />
                      <button type="button" onClick={() => setAmount0Text(token0Balance !== undefined && token0Decimals !== undefined ? formatUnits(token0Balance, token0Decimals) : "")}>Max</button>
                    </label>
                    <label className="liquidityTokenInput">
                      <span><strong>{token1Symbol ?? "Token 1"}</strong><small>Balance {formatAmount(token1Balance, token1Decimals)}</small></span>
                      <input inputMode="decimal" value={amount1Text} onChange={(event) => setAmount1Text(event.target.value)} placeholder="0.0" />
                      <button type="button" onClick={() => setAmount1Text(token1Balance !== undefined && token1Decimals !== undefined ? formatUnits(token1Balance, token1Decimals) : "")}>Max</button>
                    </label>
                  </div>
                  <p className="liquidityHelper">Synthra uses the pool’s current price to determine the deposited ratio. Any unused token amount remains in your wallet. The position manager receives approvals capped at the entered amounts.</p>
                </>
              ) : (
                <>
                  <label className="liquidityField">
                    <span>Position NFT ID</span>
                    <input inputMode="numeric" value={positionIdText} onChange={(event) => setPositionIdText(event.target.value.replace(/[^0-9]/g, ""))} placeholder="Enter the Synthra position ID" />
                    <small>Use the NFT ID returned when the position was created. The page verifies ownership, pair, fee, and full-range ticks on-chain.</small>
                  </label>
                  {position && positionMatchesMarket ? (
                    <div className="positionReadout">
                      <div><span>Position liquidity</span><strong>{positionLiquidity?.toLocaleString()}</strong></div>
                      <div><span>Uncollected {token0Symbol ?? "token 0"}</span><strong>{formatAmount(position[10], token0Decimals)}</strong></div>
                      <div><span>Uncollected {token1Symbol ?? "token 1"}</span><strong>{formatAmount(position[11], token1Decimals)}</strong></div>
                    </div>
                  ) : null}
                  <div className="liquidityPercentages" aria-label="Percentage of liquidity to remove">
                    {[25, 50, 75, 100].map((percent) => <button className={removePercent === percent ? "active" : ""} type="button" key={percent} onClick={() => setRemovePercent(percent)}>{percent}%</button>)}
                  </div>
                  <p className="liquidityHelper">Removal and fee collection execute atomically. A fully emptied position NFT remains in your wallet and can still be inspected on-chain.</p>
                  {positionProblem ? <div className="validationSummary danger"><AlertTriangle size={15} /><div><strong>Position unavailable</strong><span>{positionProblem}</span></div></div> : null}
                </>
              )}

              <label className="liquiditySlippage">
                <span>Slippage tolerance</span>
                <div><input inputMode="decimal" value={slippageText} onChange={(event) => setSlippageText(event.target.value)} /><span>%</span></div>
              </label>
              {!slippageValid ? <div className="validationSummary danger"><AlertTriangle size={15} /><div><strong>Invalid slippage</strong><span>Choose a value from 0.01% to 20%.</span></div></div> : null}

              <div className={`liquidityTxStatus ${statusTone}`} role="status" aria-live="polite">
                {phase === "confirmed" ? <CheckCircle size={16} /> : phase === "error" ? <AlertTriangle size={16} /> : busy ? <Loader2 className="spin" size={16} /> : <Droplets size={16} />}
                <div><strong>{phase === "idle" ? "Ready when you are" : phase === "confirmed" ? "Confirmed" : phase === "error" ? "Action stopped" : "In progress"}</strong><span>{statusText}</span></div>
              </div>
              {lastHash ? <a className="liquidityExplorerLink" href={`${robinhoodChainTestnet.blockExplorers.default.url}/tx/${lastHash}`} target="_blank" rel="noreferrer">View transaction <ExternalLink size={12} /></a> : null}

              <div className="liquiditySubmitRow">
                {!address ? <WalletConnectionAction /> : chainId !== robinhoodChainTestnet.id ? (
                  <button className="primaryAction" type="button" disabled={switchingNetwork} onClick={() => switchChainAsync({ chainId: robinhoodChainTestnet.id })}>{switchingNetwork ? <Loader2 className="spin" size={14} /> : null}Switch to Robinhood Testnet</button>
                ) : (
                  <button className="primaryAction" type="button" disabled={operation === "add" ? !canAdd : !canRemove} onClick={operation === "add" ? addLiquidity : removeLiquidity}>
                    {busy ? <Loader2 className="spin" size={14} /> : operation === "add" ? <ArrowDownToLine size={14} /> : <MinusCircle size={14} />}
                    {operation === "add" ? "Add full-range liquidity" : `Remove ${removePercent}% and collect`}
                  </button>
                )}
              </div>
            </div>
          </section>
        </div>

        <footer className="dashboardFooter">
          <span>Wallet-funded liquidity · portfolio assets are never used</span>
          <Link href="/docs">Docs</Link>
        </footer>
      </main>
    </div>
  );
}

export function LiquidityManager() {
  return <Providers><LiquidityWorkspace /></Providers>;
}
