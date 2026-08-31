"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeft,
  CheckCircle,
  ChevronDown,
  Droplets,
  ExternalLink,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
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
import liquidityConfig from "@/config/legacy-liquidity-testnet.json";
import { robinhoodChainTestnet } from "@/lib/chains";

const MIN_TICK = -887272;
const MAX_TICK = 887272;

const factory = getAddress(liquidityConfig.factory);
const positionManager = getAddress(liquidityConfig.positionManager);
const usdg = getAddress(liquidityConfig.usdg);
const markets = liquidityConfig.testMarkets.map((market) => ({
  ...market,
  token: getAddress(market.token),
}));

const erc20Abi = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address", name: "spender" }, { type: "uint256", name: "amount" }], outputs: [{ type: "bool" }] },
] as const;

const factoryAbi = [
  { type: "function", name: "getPool", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }, { type: "uint24" }], outputs: [{ type: "address" }] },
  { type: "function", name: "feeAmountTickSpacing", stateMutability: "view", inputs: [{ type: "uint24" }], outputs: [{ type: "int24" }] },
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

const positionManagerAbi = [{
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
}] as const;

const transferEventAbi = [{
  type: "event",
  name: "Transfer",
  inputs: [
    { indexed: true, type: "address", name: "from" },
    { indexed: true, type: "address", name: "to" },
    { indexed: true, type: "uint256", name: "tokenId" },
  ],
}] as const;

type TransactionPhase = "idle" | "approving" | "simulating" | "signing" | "confirming" | "confirmed" | "error";

function fullRangeTicks(tickSpacing: number | undefined): readonly [number, number] | undefined {
  if (!tickSpacing || tickSpacing <= 0) return undefined;
  return [Math.ceil(MIN_TICK / tickSpacing) * tickSpacing, Math.floor(MAX_TICK / tickSpacing) * tickSpacing];
}

function parseAmount(value: string, decimals: number | undefined): bigint | undefined {
  if (decimals === undefined || !value.trim()) return undefined;
  try {
    const amount = parseUnits(value, decimals);
    return amount > 0n ? amount : undefined;
  } catch {
    return undefined;
  }
}

function formatAmount(value: bigint | undefined, decimals: number | undefined): string {
  if (value === undefined || decimals === undefined) return "—";
  return Number(formatUnits(value, decimals)).toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function shortAddress(value: string | undefined): string {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "Not resolved";
}

function friendlyError(error: unknown): string {
  if (error && typeof error === "object" && "shortMessage" in error) return String((error as { shortMessage?: unknown }).shortMessage);
  return error instanceof Error ? error.message : "The wallet request could not be completed.";
}

const Q192 = 1n << 192n;

function pairedAmount(
  value: string,
  fromDecimals: number | undefined,
  toDecimals: number | undefined,
  sqrtPriceX96: bigint | undefined,
  token0ToToken1: boolean,
): string {
  if (fromDecimals === undefined || toDecimals === undefined || !sqrtPriceX96 || !value.trim()) return "";
  try {
    const amountIn = parseUnits(value, fromDecimals);
    const priceX192 = sqrtPriceX96 * sqrtPriceX96;
    const amountOut = token0ToToken1 ? amountIn * priceX192 / Q192 : amountIn * Q192 / priceX192;
    const [whole, fraction = ""] = formatUnits(amountOut, toDecimals).split(".");
    const trimmed = fraction.slice(0, Math.min(toDecimals, 8)).replace(/0+$/, "");
    return trimmed ? `${whole}.${trimmed}` : whole;
  } catch {
    return "";
  }
}

function ConnectLiquidityWallet() {
  return (
    <ConnectButton.Custom>
      {({ openConnectModal }) => <button className="primaryAction" type="button" onClick={openConnectModal}>Connect wallet</button>}
    </ConnectButton.Custom>
  );
}

export function TestnetLiquiditySurface() {
  const { address } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId: robinhoodChainTestnet.id });
  const { switchChainAsync, isPending: switchingNetwork } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const initialVault = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("vault") ?? "";
  const [marketChoice, setMarketChoice] = useState(initialVault && isAddress(initialVault) ? "otf" : markets[0].token);
  const [otfAddress, setOtfAddress] = useState(initialVault);
  const [amount0Text, setAmount0Text] = useState("");
  const [amount1Text, setAmount1Text] = useState("");
  const [slippageText, setSlippageText] = useState("1.0");
  const [phase, setPhase] = useState<TransactionPhase>("idle");
  const [statusText, setStatusText] = useState("Choose a market and enter token amounts.");
  const [lastHash, setLastHash] = useState<Hash>();

  const selectedMarket = markets.find((market) => market.token.toLowerCase() === marketChoice.toLowerCase());
  const isOtfMarket = marketChoice === "otf";
  const validOtfAddress = isAddress(otfAddress) ? getAddress(otfAddress) : undefined;
  const assetAddress = isOtfMarket ? validOtfAddress : selectedMarket?.token;
  const fee = isOtfMarket ? liquidityConfig.otfFee : selectedMarket?.fee;
  const token0 = assetAddress ? (BigInt(assetAddress) < BigInt(usdg) ? assetAddress : usdg) : undefined;
  const token1 = assetAddress ? (token0 && isAddressEqual(token0, assetAddress) ? usdg : assetAddress) : undefined;

  const { data: factoryPool, isLoading: poolLoading, isError: poolReadError } = useReadContract({
    address: factory,
    abi: factoryAbi,
    functionName: "getPool",
    args: assetAddress && fee !== undefined ? [assetAddress, usdg, fee] : undefined,
    chainId: robinhoodChainTestnet.id,
    query: { enabled: Boolean(assetAddress && fee !== undefined) },
  });
  const poolAddress = factoryPool && !isAddressEqual(factoryPool, zeroAddress) ? factoryPool : undefined;
  const { data: tickSpacing } = useReadContract({ address: factory, abi: factoryAbi, functionName: "feeAmountTickSpacing", args: fee !== undefined ? [fee] : undefined, chainId: robinhoodChainTestnet.id, query: { enabled: fee !== undefined } });
  const { data: actualToken0 } = useReadContract({ address: poolAddress, abi: poolAbi, functionName: "token0", chainId: robinhoodChainTestnet.id, query: { enabled: Boolean(poolAddress) } });
  const { data: actualToken1 } = useReadContract({ address: poolAddress, abi: poolAbi, functionName: "token1", chainId: robinhoodChainTestnet.id, query: { enabled: Boolean(poolAddress) } });
  const { data: actualFee } = useReadContract({ address: poolAddress, abi: poolAbi, functionName: "fee", chainId: robinhoodChainTestnet.id, query: { enabled: Boolean(poolAddress) } });
  const { data: poolLiquidity, refetch: refetchPoolLiquidity } = useReadContract({ address: poolAddress, abi: poolAbi, functionName: "liquidity", chainId: robinhoodChainTestnet.id, query: { enabled: Boolean(poolAddress), refetchInterval: 12_000 } });
  const { data: slot0 } = useReadContract({ address: poolAddress, abi: poolAbi, functionName: "slot0", chainId: robinhoodChainTestnet.id, query: { enabled: Boolean(poolAddress), refetchInterval: 12_000 } });
  const { data: token0Symbol } = useReadContract({ address: token0, abi: erc20Abi, functionName: "symbol", chainId: robinhoodChainTestnet.id, query: { enabled: Boolean(token0) } });
  const { data: token1Symbol } = useReadContract({ address: token1, abi: erc20Abi, functionName: "symbol", chainId: robinhoodChainTestnet.id, query: { enabled: Boolean(token1) } });
  const { data: token0Decimals } = useReadContract({ address: token0, abi: erc20Abi, functionName: "decimals", chainId: robinhoodChainTestnet.id, query: { enabled: Boolean(token0) } });
  const { data: token1Decimals } = useReadContract({ address: token1, abi: erc20Abi, functionName: "decimals", chainId: robinhoodChainTestnet.id, query: { enabled: Boolean(token1) } });
  const { data: token0Balance, refetch: refetchToken0Balance } = useReadContract({ address: token0, abi: erc20Abi, functionName: "balanceOf", args: [address ?? zeroAddress], chainId: robinhoodChainTestnet.id, query: { enabled: Boolean(token0 && address), refetchInterval: 12_000 } });
  const { data: token1Balance, refetch: refetchToken1Balance } = useReadContract({ address: token1, abi: erc20Abi, functionName: "balanceOf", args: [address ?? zeroAddress], chainId: robinhoodChainTestnet.id, query: { enabled: Boolean(token1 && address), refetchInterval: 12_000 } });
  const { data: token0Allowance, refetch: refetchToken0Allowance } = useReadContract({ address: token0, abi: erc20Abi, functionName: "allowance", args: [address ?? zeroAddress, positionManager], chainId: robinhoodChainTestnet.id, query: { enabled: Boolean(token0 && address) } });
  const { data: token1Allowance, refetch: refetchToken1Allowance } = useReadContract({ address: token1, abi: erc20Abi, functionName: "allowance", args: [address ?? zeroAddress, positionManager], chainId: robinhoodChainTestnet.id, query: { enabled: Boolean(token1 && address) } });

  const range = fullRangeTicks(tickSpacing);
  const amount0Desired = parseAmount(amount0Text, token0Decimals);
  const amount1Desired = parseAmount(amount1Text, token1Decimals);
  const slippageBps = Math.round(Number(slippageText) * 100);
  const slippageValid = Number.isFinite(slippageBps) && slippageBps >= 1 && slippageBps <= 2_000;
  const poolVerified = Boolean(
    poolAddress && token0 && token1 && actualToken0 && actualToken1
      && isAddressEqual(token0, actualToken0) && isAddressEqual(token1, actualToken1)
      && actualFee === fee && slot0?.[0] && slot0[0] > 0n && range,
  );
  const busy = phase === "approving" || phase === "simulating" || phase === "signing" || phase === "confirming";
  const canAdd = Boolean(
    address && chainId === robinhoodChainTestnet.id && publicClient && poolVerified && token0 && token1 && range
      && amount0Desired && amount1Desired && amount0Desired <= (token0Balance ?? 0n) && amount1Desired <= (token1Balance ?? 0n)
      && slippageValid && !busy,
  );
  const marketLabel = isOtfMarket ? `${token0Symbol === "USDG" ? token1Symbol ?? "OTF" : token0Symbol ?? "OTF"}/USDG` : `${selectedMarket?.symbol ?? "Test asset"}/USDG`;
  const statusTone = phase === "confirmed" ? "success" : phase === "error" ? "danger" : busy ? "working" : "neutral";

  useEffect(() => {
    setAmount0Text("");
    setAmount1Text("");
    setPhase("idle");
    setStatusText("Choose a market and enter token amounts.");
    setLastHash(undefined);
  }, [marketChoice, otfAddress]);

  function changeAmount0(value: string) {
    setAmount0Text(value);
    setAmount1Text(pairedAmount(value, token0Decimals, token1Decimals, slot0?.[0], true));
  }

  function changeAmount1(value: string) {
    setAmount1Text(value);
    setAmount0Text(pairedAmount(value, token1Decimals, token0Decimals, slot0?.[0], false));
  }

  async function approveIfNeeded(token: Address, allowance: bigint | undefined, required: bigint, symbol: string) {
    if (!publicClient || allowance !== undefined && allowance >= required) return;
    setPhase("approving");
    setStatusText(`Approve the exact ${symbol} amount in your wallet.`);
    if ((allowance ?? 0n) > 0n) {
      const resetHash = await writeContractAsync({ address: token, abi: erc20Abi, functionName: "approve", args: [positionManager, 0n], chainId: robinhoodChainTestnet.id });
      const resetReceipt = await publicClient.waitForTransactionReceipt({ hash: resetHash });
      if (resetReceipt.status !== "success") throw new Error(`${symbol} approval reset reverted.`);
    }
    const approvalHash = await writeContractAsync({ address: token, abi: erc20Abi, functionName: "approve", args: [positionManager, required], chainId: robinhoodChainTestnet.id });
    const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash });
    if (approvalReceipt.status !== "success") throw new Error(`${symbol} approval reverted.`);
  }

  async function addLiquidity() {
    if (!canAdd || !address || !publicClient || !token0 || !token1 || !range || !amount0Desired || !amount1Desired || fee === undefined) return;
    try {
      setLastHash(undefined);
      await approveIfNeeded(token0, token0Allowance, amount0Desired, token0Symbol ?? "token 0");
      await approveIfNeeded(token1, token1Allowance, amount1Desired, token1Symbol ?? "token 1");
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
        deadline: BigInt(Math.floor(Date.now() / 1000) + 20 * 60),
      };
      setPhase("simulating");
      setStatusText("Simulating the full-range position at the current pool price.");
      const preview = await publicClient.simulateContract({ address: positionManager, abi: positionManagerAbi, functionName: "mint", args: [baseParams], account: address });
      const [, , expected0, expected1] = preview.result;
      const guardedParams = {
        ...baseParams,
        amount0Min: expected0 * BigInt(10_000 - slippageBps) / 10_000n,
        amount1Min: expected1 * BigInt(10_000 - slippageBps) / 10_000n,
      };
      await publicClient.simulateContract({ address: positionManager, abi: positionManagerAbi, functionName: "mint", args: [guardedParams], account: address });
      setPhase("signing");
      setStatusText("Simulation passed. Confirm the position mint in your wallet.");
      const hash = await writeContractAsync({ address: positionManager, abi: positionManagerAbi, functionName: "mint", args: [guardedParams], chainId: robinhoodChainTestnet.id });
      setLastHash(hash);
      setPhase("confirming");
      setStatusText("Transaction submitted. Waiting for confirmation.");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The transaction reverted onchain.");
      const minted = parseEventLogs({ abi: transferEventAbi, logs: receipt.logs, eventName: "Transfer", strict: false }).find((event) => isAddressEqual(event.address, positionManager) && event.args.from && event.args.to && isAddressEqual(event.args.from, zeroAddress) && isAddressEqual(event.args.to, address));
      setPhase("confirmed");
      setStatusText(minted?.args.tokenId !== undefined ? `Full-range position #${minted.args.tokenId} created in your wallet.` : "Full-range liquidity position created in your wallet.");
      setAmount0Text("");
      setAmount1Text("");
      await Promise.all([refetchPoolLiquidity(), refetchToken0Balance(), refetchToken1Balance(), refetchToken0Allowance(), refetchToken1Allowance()]);
    } catch (error) {
      setPhase("error");
      setStatusText(friendlyError(error));
    }
  }

  return (
    <>
      <div className="liquidityBreadcrumb"><Link href="/funds"><ArrowLeft size={13} />Funds</Link><span>/</span><strong>Testnet liquidity</strong></div>
      <section className="liquidityIntro">
        <div><h1>Testnet pools liquidity</h1><p>Add wallet-owned, full-range Synthra V3 liquidity to the configured test-asset and OTF pools. Every market is paired only with USDG.</p></div>
        <div className="liquidityBadges" aria-label="Liquidity constraints"><span>Synthra V3</span><span>USDG only</span><span>Testnet</span></div>
      </section>

      <div className="liquidityLayout">
        <aside className="liquidityMarketPanel">
          <div className="liquidityPanelHeading"><Droplets size={17} /><div><strong>Market</strong><span>Select the test pool your position will use.</span></div></div>
          <label className="liquidityField">
            <span>Pool</span>
            <div className="selectControl">
              <select value={marketChoice} onChange={(event) => setMarketChoice(event.target.value)} aria-label="Liquidity pool">
                {markets.map((market) => <option key={market.token} value={market.token}>{market.symbol}/USDG · {(market.fee / 10_000).toFixed(2)}%</option>)}
                <option value="otf">OTF/USDG · {(liquidityConfig.otfFee / 10_000).toFixed(2)}%</option>
              </select>
              <ChevronDown size={14} aria-hidden="true" />
            </div>
          </label>
          {isOtfMarket ? (
            <label className="liquidityField">
              <span>OTF address</span>
              <input value={otfAddress} onChange={(event) => setOtfAddress(event.target.value.trim())} placeholder="0x…" spellCheck={false} autoComplete="off" />
              <small>The canonical OTF/USDG pool is resolved directly from the legacy testnet factory.</small>
            </label>
          ) : null}
          <div className="liquidityPoolRecord">
            <div><span>Selected market</span><strong>{marketLabel}</strong></div>
            <div><span>Pool</span><strong>{poolLoading ? "Resolving…" : shortAddress(poolAddress)}</strong></div>
            <div><span>Fee tier</span><strong>{fee !== undefined ? `${(fee / 10_000).toFixed(2)}%` : "—"}</strong></div>
            <div><span>Active liquidity</span><strong className={poolLiquidity && poolLiquidity > 0n ? "successText" : "warningText"}>{poolLiquidity && poolLiquidity > 0n ? "Active" : "Empty"}</strong></div>
          </div>
          {poolAddress ? <a className="liquidityExplorerLink" href={`${robinhoodChainTestnet.blockExplorers.default.url}/address/${poolAddress}`} target="_blank" rel="noreferrer">Inspect pool contract <ExternalLink size={12} /></a> : null}
          {isOtfMarket && otfAddress && !validOtfAddress ? <div className="validationSummary danger"><AlertTriangle size={15} /><div><strong>Invalid OTF address</strong><span>Enter a valid EVM contract address.</span></div></div> : null}
          {assetAddress && !poolLoading && !poolReadError && !poolAddress ? <div className="validationSummary"><AlertTriangle size={15} /><div><strong>Pool not found</strong><span>No initialized USDG pool exists for this address and fee tier.</span></div></div> : null}
          {poolReadError ? <div className="validationSummary danger"><AlertTriangle size={15} /><div><strong>Pool lookup unavailable</strong><span>Check the Robinhood Testnet connection and try again.</span></div></div> : null}
          {!poolVerified && poolAddress && !poolLoading ? <div className="validationSummary danger"><AlertTriangle size={15} /><div><strong>Pool verification failed</strong><span>The pool does not match the canonical factory pair, fee, or initialized state.</span></div></div> : null}
        </aside>

        <section className="liquidityActionPanel">
          <div className="liquidityActionHeading"><strong>Add liquidity</strong><span>Mint a wallet-owned full-range position.</span></div>
          <div className="liquidityActionBody">
            <div className="fullRangeNotice"><ShieldCheck size={16} /><div><strong>Full-range position</strong><span>Ticks are fixed to {range ? `${range[0].toLocaleString()} → ${range[1].toLocaleString()}` : "the widest valid range"}. Concentrated ranges stay outside this testnet utility.</span></div></div>
            <div className="liquidityTokenInputs">
              <label className="liquidityTokenInput"><span><strong>{token0Symbol ?? "Token 0"}</strong><small>Balance {formatAmount(token0Balance, token0Decimals)}</small></span><input inputMode="decimal" value={amount0Text} onChange={(event) => changeAmount0(event.target.value)} placeholder="0.0" /><button type="button" onClick={() => changeAmount0(token0Balance !== undefined && token0Decimals !== undefined ? formatUnits(token0Balance, token0Decimals) : "")}>Max</button></label>
              <label className="liquidityTokenInput"><span><strong>{token1Symbol ?? "Token 1"}</strong><small>Balance {formatAmount(token1Balance, token1Decimals)}</small></span><input inputMode="decimal" value={amount1Text} onChange={(event) => changeAmount1(event.target.value)} placeholder="0.0" /><button type="button" onClick={() => changeAmount1(token1Balance !== undefined && token1Decimals !== undefined ? formatUnits(token1Balance, token1Decimals) : "")}>Max</button></label>
            </div>
            <p className="liquidityHelper">The matching amount follows the live pool price. Final amounts are checked by transaction simulation; unused dust remains in your wallet.</p>
            <label className="liquiditySlippage"><span>Slippage tolerance</span><div><input inputMode="decimal" value={slippageText} onChange={(event) => setSlippageText(event.target.value)} /><span>%</span></div></label>
            {!slippageValid ? <div className="validationSummary danger"><AlertTriangle size={15} /><div><strong>Invalid slippage</strong><span>Choose a value from 0.01% to 20%.</span></div></div> : null}
            <div className={`liquidityTxStatus ${statusTone}`} role="status" aria-live="polite">
              {phase === "confirmed" ? <CheckCircle size={16} /> : phase === "error" ? <AlertTriangle size={16} /> : busy ? <LoaderCircle className="spin" size={16} /> : <Droplets size={16} />}
              <div><strong>{phase === "idle" ? "Ready when you are" : phase === "confirmed" ? "Confirmed" : phase === "error" ? "Action stopped" : "In progress"}</strong><span>{statusText}</span></div>
            </div>
            {lastHash ? <a className="liquidityExplorerLink" href={`${robinhoodChainTestnet.blockExplorers.default.url}/tx/${lastHash}`} target="_blank" rel="noreferrer">View transaction <ExternalLink size={12} /></a> : null}
            <div className="liquiditySubmitRow">
              {!address ? <ConnectLiquidityWallet /> : chainId !== robinhoodChainTestnet.id ? <button className="primaryAction" type="button" disabled={switchingNetwork} onClick={() => switchChainAsync({ chainId: robinhoodChainTestnet.id })}>{switchingNetwork ? <LoaderCircle className="spin" size={14} /> : null}Switch to Robinhood Testnet</button> : <button className="primaryAction" type="button" disabled={!canAdd} onClick={addLiquidity}>{busy ? <LoaderCircle className="spin" size={14} /> : <ArrowDownToLine size={14} />}Add full-range liquidity</button>}
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
