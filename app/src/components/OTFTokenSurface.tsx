"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { OtfBrandMark } from "@onchaintradedfunds/brand";
import {
  fakeEthUsdOracleAbi,
  merkleRewardsDistributorAbi,
  otfLaunchManagerAbi,
  otfTokenAbi,
  teamMarketCapVestingAbi,
} from "@onchaintradedfunds/generated";
import {
  ArrowDownUp,
  CheckCircle,
  ChevronDown,
  CircleAlert,
  ExternalLink,
  Flame,
  LoaderCircle,
  LockKeyhole,
  ReceiptText,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  encodeAbiParameters,
  formatUnits,
  parseUnits,
  zeroAddress,
  type Hex,
} from "viem";
import {
  useAccount,
  useBalance,
  useChainId,
  usePublicClient,
  useReadContract,
  useWalletClient,
} from "wagmi";
import { robinhoodChainTestnet } from "@/lib/chains";
import { robinhoodTestnetAddresses, robinhoodTestnetV4 } from "@/lib/deployment";
import { burnedSupply, feeBenefitRows, quoteCanonicalOtfSwap, type OtfSwapSide } from "@/lib/otf-market";

const DOCS_URL = "https://docs.onchaintradedfunds.com/token-and-fee-incentives";
const MAX_SUPPLY = 1_000_000_000n * 10n ** 18n;
const FULL_RANGE_LOWER_SQRT = 4_295_128_739n;
const FULL_RANGE_UPPER_SQRT = 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342n;
const ERC20_APPROVE_ABI = [{
  type: "function",
  name: "approve",
  stateMutability: "nonpayable",
  inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
  outputs: [{ name: "", type: "bool" }],
}] as const;
const PERMIT2_ABI = [{
  type: "function",
  name: "approve",
  stateMutability: "nonpayable",
  inputs: [
    { name: "token", type: "address" },
    { name: "spender", type: "address" },
    { name: "amount", type: "uint160" },
    { name: "expiration", type: "uint48" },
  ],
  outputs: [],
}] as const;
const UNIVERSAL_ROUTER_ABI = [{
  type: "function",
  name: "execute",
  stateMutability: "payable",
  inputs: [
    { name: "commands", type: "bytes" },
    { name: "inputs", type: "bytes[]" },
    { name: "deadline", type: "uint256" },
  ],
  outputs: [],
}] as const;
const EXACT_INPUT_PARAM = [{
  type: "tuple",
  components: [
    { name: "currencyIn", type: "address" },
    {
      name: "path",
      type: "tuple[]",
      components: [
        { name: "intermediateCurrency", type: "address" },
        { name: "fee", type: "uint24" },
        { name: "tickSpacing", type: "int24" },
        { name: "hooks", type: "address" },
        { name: "hookData", type: "bytes" },
      ],
    },
    { name: "maxHopSlippage", type: "uint256[]" },
    { name: "amountIn", type: "uint128" },
    { name: "amountOutMinimum", type: "uint128" },
  ],
}] as const;

type TransactionState = "idle" | "approving" | "wallet" | "pending" | "success" | "rejected" | "reverted";
type RewardsArtifact = {
  root: Hex;
  distributor: string;
  entries: Array<{
    address: string;
    cumulativeEntitlementRaw: string;
    proof: Hex[];
  }>;
};

function decimalInput(value: string) {
  return /^\d*(?:\.\d{0,18})?$/u.test(value.replace(/,/gu, ""))
    ? value.replace(/,/gu, "")
    : undefined;
}

function number(value: bigint | undefined, maximumFractionDigits = 2) {
  if (value === undefined) return "—";
  return Number(formatUnits(value, 18)).toLocaleString(undefined, { maximumFractionDigits });
}

function usd(value: bigint | undefined, maximumFractionDigits = 2) {
  if (value === undefined) return "—";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits }).format(Number(formatUnits(value, 18)));
}

function age(seconds: bigint | undefined) {
  if (seconds === undefined) return "—";
  const value = Number(seconds);
  if (value < 60) return `${value}s`;
  if (value < 3_600) return `${Math.floor(value / 60)}m`;
  return `${Math.floor(value / 3_600)}h`;
}

function transactionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/rejected|denied|cancelled/iu.test(message)) return { state: "rejected" as const, message: "The wallet request was rejected. No swap was submitted." };
  if (/allowance|approval/iu.test(message)) return { state: "reverted" as const, message: "Token authorization failed. Check the allowance and retry." };
  if (/liquidity|price limit|slippage/iu.test(message)) return { state: "reverted" as const, message: "The pool could not satisfy the minimum output. Refresh the quote or increase slippage within the safe bounds." };
  return { state: "reverted" as const, message: "The transaction reverted. Refresh onchain data and try again." };
}

function ConnectWalletAction() {
  return (
    <ConnectButton.Custom>
      {({ mounted, account, openConnectModal }) => mounted && account
        ? <span className="stateBadge success"><Wallet size={12} />{account.displayName}</span>
        : <button className="secondaryAction" type="button" onClick={openConnectModal}><Wallet size={14} />Connect wallet</button>}
    </ConnectButton.Custom>
  );
}

export function OTFTokenSurface() {
  const chainId = useChainId();
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient({ chainId });
  const testnet = chainId === robinhoodChainTestnet.id;
  const token = robinhoodTestnetAddresses.otfToken ?? zeroAddress;
  const launch = robinhoodTestnetAddresses.launchManager ?? zeroAddress;
  const vesting = robinhoodTestnetAddresses.teamVesting ?? zeroAddress;
  const distributor = robinhoodTestnetAddresses.merkleRewardsDistributor ?? zeroAddress;
  const oracle = robinhoodTestnetAddresses.ethUsdOracle ?? zeroAddress;
  const weth = robinhoodTestnetAddresses.weth ?? zeroAddress;
  const configured = testnet && token !== zeroAddress && launch !== zeroAddress
    && vesting !== zeroAddress && distributor !== zeroAddress && oracle !== zeroAddress && weth !== zeroAddress;
  const query = { enabled: configured, refetchInterval: 12_000 } as const;

  const totalSupplyRead = useReadContract({ address: token, abi: otfTokenAbi, functionName: "totalSupply", query });
  const phaseRead = useReadContract({ address: launch, abi: otfLaunchManagerAbi, functionName: "phase", query });
  const priceRead = useReadContract({ address: launch, abi: otfLaunchManagerAbi, functionName: "currentOtfPriceWethWad", query });
  const poolStateRead = useReadContract({ address: launch, abi: otfLaunchManagerAbi, functionName: "currentPoolState", query });
  const progressRead = useReadContract({ address: launch, abi: otfLaunchManagerAbi, functionName: "bootstrapProgress", query });
  const launchFdvRead = useReadContract({ address: launch, abi: otfLaunchManagerAbi, functionName: "currentLaunchReferenceFdvWeth", query });
  const initialPriceRead = useReadContract({ address: launch, abi: otfLaunchManagerAbi, functionName: "initialOtfPriceWethWad", query });
  const finalPriceRead = useReadContract({ address: launch, abi: otfLaunchManagerAbi, functionName: "finalOtfPriceWethWad", query });
  const initialSqrtRead = useReadContract({ address: launch, abi: otfLaunchManagerAbi, functionName: "initialSqrtPriceX96", query });
  const finalSqrtRead = useReadContract({ address: launch, abi: otfLaunchManagerAbi, functionName: "finalSqrtPriceX96", query });
  const finalTickRead = useReadContract({ address: launch, abi: otfLaunchManagerAbi, functionName: "finalTick", query });
  const orderingRead = useReadContract({ address: launch, abi: otfLaunchManagerAbi, functionName: "otfIsCurrency0", query });
  const bootstrapLiquidityRead = useReadContract({ address: launch, abi: otfLaunchManagerAbi, functionName: "bootstrapLiquidity", query });
  const permanentLiquidityRead = useReadContract({ address: launch, abi: otfLaunchManagerAbi, functionName: "permanentLiquidity", query });
  const graduationBlockRead = useReadContract({ address: launch, abi: otfLaunchManagerAbi, functionName: "graduationBlock", query });
  const graduationTimeRead = useReadContract({ address: launch, abi: otfLaunchManagerAbi, functionName: "graduationTimestamp", query });
  const permanentOtfRead = useReadContract({ address: launch, abi: otfLaunchManagerAbi, functionName: "permanentOtfLiquidity", query });
  const permanentWethRead = useReadContract({ address: launch, abi: otfLaunchManagerAbi, functionName: "permanentWethLiquidity", query });
  const liveFdvRead = useReadContract({ address: vesting, abi: teamMarketCapVestingAbi, functionName: "liveFdvUsdWad", query });
  const unlockedRead = useReadContract({ address: vesting, abi: teamMarketCapVestingAbi, functionName: "unlockedAmount", query });
  const claimedTeamRead = useReadContract({ address: vesting, abi: teamMarketCapVestingAbi, functionName: "claimedAmount", query });
  const nextMilestoneRead = useReadContract({ address: vesting, abi: teamMarketCapVestingAbi, functionName: "nextMilestone", query });
  const oracleRead = useReadContract({ address: vesting, abi: teamMarketCapVestingAbi, functionName: "oracleStatus", query });
  const rootRead = useReadContract({ address: distributor, abi: merkleRewardsDistributorAbi, functionName: "merkleRoot", query });
  const rootVersionRead = useReadContract({ address: distributor, abi: merkleRewardsDistributorAbi, functionName: "rootVersion", query });
  const rootTimeRead = useReadContract({ address: distributor, abi: merkleRewardsDistributorAbi, functionName: "rootPublishedAt", query });
  const claimedRewardsRead = useReadContract({ address: distributor, abi: merkleRewardsDistributorAbi, functionName: "claimed", args: [address ?? zeroAddress], query: { ...query, enabled: configured && Boolean(address) } });
  const fakeOracleRead = useReadContract({ address: oracle, abi: fakeEthUsdOracleAbi, functionName: "ANSWER", query });
  const { data: otfBalance, refetch: refetchOtfBalance } = useBalance({ address, token, chainId, query: { enabled: configured && Boolean(address) } });
  const { data: wethBalance, refetch: refetchWethBalance } = useBalance({ address, token: weth, chainId, query: { enabled: configured && Boolean(address) } });

  const totalSupply = totalSupplyRead.data;
  const supply = totalSupply === undefined ? undefined : burnedSupply(MAX_SUPPLY, totalSupply);
  const phase = Number(phaseRead.data ?? 0);
  const phaseLabel = ["Pool not initialized", "Bootstrap active", "Graduation ready", "Graduated"][phase] ?? "Unavailable";
  const priceWeth = priceRead.data;
  const ethUsd = oracleRead.data?.[0];
  const priceUsd = priceWeth !== undefined && ethUsd !== undefined ? priceWeth * ethUsd / 10n ** 18n : undefined;
  const progress = progressRead.data;
  const poolState = poolStateRead.data;
  const teamUnlocked = unlockedRead.data;
  const teamClaimed = claimedTeamRead.data;
  const teamLocked = teamUnlocked !== undefined && teamClaimed !== undefined
    ? 100_000_000n * 10n ** 18n - teamUnlocked
    : undefined;
  const displayedPoolOtf = phase === 3 ? permanentOtfRead.data : progress?.[2];
  const displayedPoolWeth = phase === 3 ? permanentWethRead.data : progress?.[3];
  const remainingPriceMovementBps = priceWeth && finalPriceRead.data && finalPriceRead.data > priceWeth
    ? Number((finalPriceRead.data - priceWeth) * 10_000n / priceWeth)
    : 0;

  const [side, setSide] = useState<OtfSwapSide>("buy");
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);
  const [deadlineMinutes, setDeadlineMinutes] = useState(10);
  const [swapState, setSwapState] = useState<TransactionState>("idle");
  const [swapMessage, setSwapMessage] = useState<string>();
  const [swapHash, setSwapHash] = useState<Hex>();
  const amountRaw = useMemo(() => {
    try { return amount && Number(amount) > 0 ? parseUnits(amount, 18) : undefined; } catch { return undefined; }
  }, [amount]);
  const quote = useMemo(() => {
    if (
      !amountRaw || !poolState || priceWeth === undefined || orderingRead.data === undefined
      || initialSqrtRead.data === undefined || finalSqrtRead.data === undefined
    ) return undefined;
    const liquidity = phase === 3 ? permanentLiquidityRead.data : bootstrapLiquidityRead.data;
    if (!liquidity) return undefined;
    const bootstrapLower = initialSqrtRead.data < finalSqrtRead.data ? initialSqrtRead.data : finalSqrtRead.data;
    const bootstrapUpper = initialSqrtRead.data > finalSqrtRead.data ? initialSqrtRead.data : finalSqrtRead.data;
    try {
      return quoteCanonicalOtfSwap({
        side,
        amountIn: amountRaw,
        slippageBps,
        sqrtPriceX96: poolState[0],
        liquidity,
        lowerSqrtPriceX96: phase === 3 ? FULL_RANGE_LOWER_SQRT : bootstrapLower,
        upperSqrtPriceX96: phase === 3 ? FULL_RANGE_UPPER_SQRT : bootstrapUpper,
        otfIsCurrency0: orderingRead.data,
        otfPriceWethWad: priceWeth,
      });
    } catch { return undefined; }
  }, [amountRaw, bootstrapLiquidityRead.data, finalSqrtRead.data, initialSqrtRead.data, orderingRead.data, permanentLiquidityRead.data, phase, poolState, priceWeth, side, slippageBps]);
  const inputBalance = side === "buy" ? wethBalance?.value : otfBalance?.value;
  const insufficientBalance = amountRaw !== undefined && inputBalance !== undefined && amountRaw > inputBalance;
  const canTrade = configured && (phase === 1 || phase === 3) && Boolean(address && amountRaw && quote?.fullyFilled)
    && !insufficientBalance && swapState !== "approving" && swapState !== "wallet" && swapState !== "pending";

  async function executeSwap() {
    if (!canTrade || !walletClient || !publicClient || !address || !amountRaw || !quote || launch === zeroAddress) return;
    const universalRouter = robinhoodTestnetV4.universalRouter;
    const permit2 = robinhoodTestnetV4.permit2;
    if (!universalRouter || !permit2) {
      setSwapState("reverted");
      setSwapMessage("The canonical V4 router or Permit2 address is not configured.");
      return;
    }
    const tokenIn = side === "buy" ? weth : token;
    const tokenOut = side === "buy" ? token : weth;
    const deadline = BigInt(Math.floor(Date.now() / 1_000) + deadlineMinutes * 60);
    setSwapHash(undefined);
    try {
      setSwapState("approving");
      setSwapMessage(`Authorize ${side === "buy" ? "WETH" : "OTF"} for Permit2.`);
      const approvalHash = await walletClient.writeContract({ address: tokenIn, abi: ERC20_APPROVE_ABI, functionName: "approve", args: [permit2, amountRaw] });
      const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash });
      if (approvalReceipt.status !== "success") throw new Error("approval reverted");
      const permitHash = await walletClient.writeContract({ address: permit2, abi: PERMIT2_ABI, functionName: "approve", args: [tokenIn, universalRouter, amountRaw, Number(deadline)] });
      const permitReceipt = await publicClient.waitForTransactionReceipt({ hash: permitHash });
      if (permitReceipt.status !== "success") throw new Error("Permit2 approval reverted");

      setSwapState("wallet");
      setSwapMessage("Confirm the canonical 0% V4 pool swap.");
      const swapParams = encodeAbiParameters(EXACT_INPUT_PARAM, [{
        currencyIn: tokenIn,
        path: [{ intermediateCurrency: tokenOut, fee: 0, tickSpacing: 1, hooks: launch, hookData: "0x" }],
        maxHopSlippage: [],
        amountIn: amountRaw,
        amountOutMinimum: quote.minimumReceived,
      }]);
      const actionParams = [
        swapParams,
        encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [tokenIn, amountRaw]),
        encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [tokenOut, quote.minimumReceived]),
      ];
      const routerInput = encodeAbiParameters(
        [{ type: "bytes" }, { type: "bytes[]" }],
        ["0x070c0f", actionParams],
      );
      const hash = await walletClient.writeContract({
        address: universalRouter,
        abi: UNIVERSAL_ROUTER_ABI,
        functionName: "execute",
        args: ["0x10", [routerInput], deadline],
      });
      setSwapHash(hash);
      setSwapState("pending");
      setSwapMessage("Swap submitted. Waiting for onchain confirmation.");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("swap reverted");
      setSwapState("success");
      setSwapMessage(`${side === "buy" ? "Buy" : "Sell"} confirmed.`);
      await Promise.all([refetchOtfBalance(), refetchWethBalance(), totalSupplyRead.refetch(), progressRead.refetch(), priceRead.refetch()]);
    } catch (error) {
      const result = transactionError(error);
      setSwapState(result.state);
      setSwapMessage(result.message);
    }
  }

  const [rewardsArtifact, setRewardsArtifact] = useState<RewardsArtifact>();
  const [rewardsState, setRewardsState] = useState<"loading" | "ready" | "empty" | "stale" | "failure">("loading");
  useEffect(() => {
    if (!configured || !address) { setRewardsState("empty"); setRewardsArtifact(undefined); return; }
    const controller = new AbortController();
    setRewardsState("loading");
    void fetch(`/rewards/${chainId}.json`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 404) return undefined;
        if (!response.ok) throw new Error("REWARDS_ARTIFACT_UNAVAILABLE");
        return response.json() as Promise<RewardsArtifact>;
      })
      .then((artifact) => {
        if (!artifact) { setRewardsState("empty"); return; }
        setRewardsArtifact(artifact);
        const rootMatches = rootRead.data?.toLowerCase() === artifact.root.toLowerCase();
        setRewardsState(rootMatches ? "ready" : "stale");
      })
      .catch((error) => { if (error instanceof Error && error.name === "AbortError") return; setRewardsState("failure"); });
    return () => controller.abort();
  }, [address, chainId, configured, rootRead.data, rootVersionRead.data]);
  const rewardEntry = rewardsArtifact?.entries.find((entry) => entry.address.toLowerCase() === address?.toLowerCase());
  const cumulativeEntitlement = rewardEntry ? BigInt(rewardEntry.cumulativeEntitlementRaw) : 0n;
  const previouslyClaimed = claimedRewardsRead.data ?? 0n;
  const claimable = cumulativeEntitlement > previouslyClaimed ? cumulativeEntitlement - previouslyClaimed : 0n;
  const [claimState, setClaimState] = useState<TransactionState>("idle");
  const [claimHash, setClaimHash] = useState<Hex>();

  async function claimRewards() {
    if (!walletClient || !publicClient || !address || !rewardEntry || claimable === 0n) return;
    try {
      setClaimState("wallet");
      const hash = await walletClient.writeContract({
        address: distributor,
        abi: merkleRewardsDistributorAbi,
        functionName: "claim",
        args: [address, cumulativeEntitlement, rewardEntry.proof],
      });
      setClaimHash(hash);
      setClaimState("pending");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("claim reverted");
      setClaimState("success");
      await Promise.all([claimedRewardsRead.refetch(), refetchOtfBalance()]);
    } catch (error) { setClaimState(transactionError(error).state); }
  }

  const [finalizeState, setFinalizeState] = useState<TransactionState>("idle");
  async function finalizeGraduation() {
    if (!walletClient || !publicClient || launch === zeroAddress) return;
    try {
      setFinalizeState("wallet");
      const hash = await walletClient.writeContract({ address: launch, abi: otfLaunchManagerAbi, functionName: "finalizeGraduation" });
      setFinalizeState("pending");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("finalization reverted");
      setFinalizeState("success");
      await phaseRead.refetch();
    } catch (error) { setFinalizeState(transactionError(error).state); }
  }

  if (!configured) {
    return (
      <div className="appView tokenView tokenMarketView">
        <header className="tokenMarketHeader"><div className="tokenMarketIdentity"><span className="appPageIcon"><OtfBrandMark /></span><div><h1>$OTF</h1><p>The OTF market, live token supply, launch status, vesting, burns, and rewards.</p></div></div><a className="secondaryAction" href={DOCS_URL} target="_blank" rel="noreferrer"><ReceiptText size={14} />Specification<ExternalLink size={12} /></a></header>
        <section className="sectionCard tokenUnavailable"><CircleAlert size={20} /><div><h2>{testnet ? "Fresh testnet deployment required" : "No mainnet deployment configured"}</h2><p>The breaking token-economics v2 contracts have not been configured on this network. Trading remains disabled and no stale testnet address is shown.</p></div></section>
      </div>
    );
  }

  const explorer = robinhoodChainTestnet.blockExplorers.default.url;
  const swapBusy = swapState === "approving" || swapState === "wallet" || swapState === "pending";
  const inputSymbol = side === "buy" ? "WETH" : "OTF";
  const outputSymbol = side === "buy" ? "OTF" : "WETH";
  const outputAmount = quote ? number(quote.amountOut, 8) : "—";
  const nextMilestone = nextMilestoneRead.data;

  return (
    <div className="appView tokenView tokenMarketView">
      <header className="tokenMarketHeader">
        <div className="tokenMarketIdentity"><span className="appPageIcon"><OtfBrandMark /></span><div><h1>$OTF</h1><p>Trade the canonical pool and inspect supply, launch, burns, vesting, and rewards.</p></div></div>
        <div className="tokenMarketHeaderActions"><ConnectWalletAction /><a className="secondaryAction" href={DOCS_URL} target="_blank" rel="noreferrer"><ReceiptText size={14} />Specification<ExternalLink size={12} /></a></div>
      </header>

      <section className="tokenSupplyLedger" aria-label="OTF token statistics">
        <div><span>Original supply</span><strong>1,000,000,000 OTF</strong><small>Fixed MAX_SUPPLY</small></div>
        <div><span>Current supply</span><strong>{number(totalSupply, 2)} OTF</strong><small>Live after burns</small></div>
        <div><span>Total burned</span><strong>{number(supply?.burned, 2)} OTF</strong><small>{supply ? `${(supply.burnedBps / 100).toFixed(2)}% of original` : "—"}</small></div>
        <div><span>OTF price</span><strong>{number(priceWeth, 10)} WETH</strong><small>{usd(priceUsd, 8)}</small></div>
        <div><span>Live USD FDV</span><strong>{usd(liveFdvRead.data, 0)}</strong><small>Current supply × spot price</small></div>
        <div><span>Pool liquidity</span><strong>{number(displayedPoolOtf, 2)} OTF</strong><small>{number(displayedPoolWeth, 6)} WETH · 0% fee</small></div>
        <div><span>Wallet balance</span><strong>{otfBalance ? number(otfBalance.value, 4) : address ? "0 OTF" : "Connect wallet"}</strong><small>{wethBalance ? `${number(wethBalance.value, 4)} WETH` : "WETH unavailable"}</small></div>
      </section>

      <div className="tokenMarketGrid">
        <section className="tokenTradePanel" aria-labelledby="otf-trade-title">
          <div className="tokenSectionHeading"><div><h2 id="otf-trade-title">Buy and sell OTF</h2><p>Canonical OTF/WETH V4 pool · static 0% LP fee</p></div><span className={`stateBadge ${phase === 3 ? "success" : phase === 1 ? "" : "muted"}`}>{phaseLabel}</span></div>
          <div className="tokenTradeTabs" role="tablist" aria-label="Trade direction"><button type="button" role="tab" aria-selected={side === "buy"} className={side === "buy" ? "active" : ""} onClick={() => { setSide("buy"); setAmount(""); setSwapState("idle"); }}>Buy OTF</button><button type="button" role="tab" aria-selected={side === "sell"} className={side === "sell" ? "active" : ""} onClick={() => { setSide("sell"); setAmount(""); setSwapState("idle"); }}>Sell OTF</button></div>
          <label className="tokenAmountField"><span>You pay <small>Balance {inputBalance === undefined ? "—" : `${number(inputBalance, 6)} ${inputSymbol}`}</small></span><div><input inputMode="decimal" value={amount} placeholder="0.0" onChange={(event) => { const next = decimalInput(event.target.value); if (next !== undefined) { setAmount(next); setSwapState("idle"); } }} aria-invalid={Boolean(amount && (!amountRaw || insufficientBalance))} /><button type="button" onClick={() => inputBalance !== undefined && setAmount(formatUnits(inputBalance, 18))}>Max</button><strong>{inputSymbol}</strong></div></label>
          <div className="tokenTradeDirection" aria-hidden="true"><ArrowDownUp size={15} /></div>
          <div className="tokenReceiveField"><span>You receive</span><div><strong>{outputAmount}</strong><b>{outputSymbol}</b></div></div>
          <dl className="tokenQuoteDetails"><div><dt>Price impact</dt><dd>{quote ? `${(quote.priceImpactBps / 100).toFixed(2)}%` : "—"}</dd></div><div><dt>Minimum received</dt><dd>{quote ? `${number(quote.minimumReceived, 8)} ${outputSymbol}` : "—"}</dd></div><div><dt>Pool fee</dt><dd>0%</dd></div><div><dt>Deadline</dt><dd>{deadlineMinutes} minutes</dd></div></dl>
          <div className="tokenTradeSettings"><label><span>Maximum slippage</span><span className="selectControl"><select value={slippageBps} onChange={(event) => setSlippageBps(Number(event.target.value))}><option value={50}>0.5%</option><option value={100}>1.0%</option><option value={300}>3.0%</option></select><ChevronDown size={13} /></span></label><label><span>Deadline</span><span className="selectControl"><select value={deadlineMinutes} onChange={(event) => setDeadlineMinutes(Number(event.target.value))}><option value={5}>5 min</option><option value={10}>10 min</option><option value={20}>20 min</option></select><ChevronDown size={13} /></span></label></div>
          {insufficientBalance ? <p className="tokenInlineError" role="alert">Insufficient {inputSymbol} balance.</p> : quote && !quote.fullyFilled ? <p className="tokenInlineError" role="alert">This amount exceeds liquidity available before the launch boundary. Enter a smaller amount.</p> : null}
          {!address ? <ConnectButton.Custom>{({ openConnectModal }) => <button className="primaryAction" type="button" onClick={openConnectModal}>Connect wallet to trade</button>}</ConnectButton.Custom> : <button className="primaryAction" type="button" disabled={!canTrade} onClick={() => void executeSwap()}>{swapBusy ? <LoaderCircle className="spin" size={14} /> : <ArrowDownUp size={14} />}{phase === 0 ? "Trading starts after initialization" : phase === 2 ? "Graduation finalization required" : insufficientBalance ? `Insufficient ${inputSymbol}` : !amountRaw ? "Enter an amount" : !quote?.fullyFilled ? "Amount exceeds pool liquidity" : side === "buy" ? "Buy OTF" : "Sell OTF"}</button>}
          {swapMessage ? <div className={`tokenTransactionState ${swapState}`} role="status" aria-live="polite">{swapState === "success" ? <CheckCircle size={14} /> : swapBusy ? <LoaderCircle className="spin" size={14} /> : <CircleAlert size={14} />}<span>{swapMessage}{swapHash ? <a href={`${explorer}/tx/${swapHash}`} target="_blank" rel="noreferrer">View transaction <ExternalLink size={11} /></a> : null}</span></div> : null}
          <p className="tokenTradeDisclosure">The LP fee is 0%; price impact and slippage still apply. Permit2 receives only the exact input authorization used for this swap.</p>
        </section>

        <aside className="tokenLaunchPanel" aria-labelledby="launch-status-title">
          <div className="tokenSectionHeading"><div><h2 id="launch-status-title">Launch status</h2><p>Price-driven, with no fixed graduation date.</p></div></div>
          <div className="launchPhaseBanner"><span className={`launchPhaseDot phase-${phase}`} /><div><strong>{phaseLabel}</strong><small>{phase === 0 ? "Trading is unavailable until pool initialization." : phase === 1 ? "Graduation occurs only when the final tick is reached." : phase === 2 ? "The final tick has been reached; anyone may finalize." : "Permanent full-range liquidity is locked."}</small></div></div>
          {phase === 0 ? <dl className="launchFacts"><div><dt>Launch reference FDV</dt><dd>10 ETH</dd></div><div><dt>Selected launch price</dt><dd>{number(initialPriceRead.data, 10)} WETH</dd></div></dl> : phase < 3 ? <><div className="launchProgress"><div><span>Progress to final tick</span><strong>{progress ? `${(Number(progress[0]) / 100).toFixed(2)}%` : "—"}</strong></div><progress max="10000" value={progress ? Number(progress[0]) : 0} /></div><dl className="launchFacts"><div><dt>Bootstrap OTF sold</dt><dd>{progress ? number(progress[1], 2) : "—"}</dd></div><div><dt>OTF remaining</dt><dd>{progress ? number(progress[2], 2) : "—"}</dd></div><div><dt>WETH raised</dt><dd>{progress ? number(progress[3], 6) : "—"}</dd></div><div><dt>Current reference FDV</dt><dd>{launchFdvRead.data === undefined ? "—" : `${number(launchFdvRead.data, 4)} ETH`}</dd></div><div><dt>Current live FDV</dt><dd>{usd(liveFdvRead.data, 0)}</dd></div><div><dt>Final tick</dt><dd>{finalTickRead.data?.toString() ?? "—"}</dd></div><div><dt>Final selected price</dt><dd>{number(finalPriceRead.data, 10)} WETH</dd></div><div><dt>Remaining price movement</dt><dd>{(remainingPriceMovementBps / 100).toFixed(2)}%</dd></div><div><dt>OTF to graduation</dt><dd>{progress ? number(progress[2], 2) : "—"}</dd></div></dl>{phase === 2 ? <button className="primaryAction" type="button" disabled={finalizeState === "wallet" || finalizeState === "pending"} onClick={() => void finalizeGraduation()}>{finalizeState === "wallet" || finalizeState === "pending" ? <LoaderCircle className="spin" size={14} /> : <LockKeyhole size={14} />}Finalize graduation</button> : null}</> : <dl className="launchFacts"><div><dt>Graduation block</dt><dd>{graduationBlockRead.data?.toString() ?? "—"}</dd></div><div><dt>Graduation time</dt><dd>{graduationTimeRead.data ? new Date(Number(graduationTimeRead.data) * 1_000).toLocaleString() : "—"}</dd></div><div><dt>Permanent OTF</dt><dd>{number(permanentOtfRead.data, 2)}</dd></div><div><dt>Permanent WETH</dt><dd>{number(permanentWethRead.data, 6)}</dd></div><div><dt>Liquidity status</dt><dd>Principal permanently locked</dd></div><div><dt>Pool fee</dt><dd>0%</dd></div></dl>}
        </aside>
      </div>

      <section className="tokenDetailSection" aria-labelledby="burn-title"><div className="tokenSectionHeading"><div><h2 id="burn-title"><Flame size={16} />Buyback and burn</h2><p>Protocol fee shares are redeemed, constituents are routed to WETH, OTF is bought from this pool, and the purchased OTF is burned.</p></div><div className="tokenSectionMetric"><strong>{number(supply?.burned, 2)} OTF</strong><span>{supply ? `${(supply.burnedBps / 100).toFixed(2)}% burned` : "—"}</span></div></div><p className="tokenPlainNote">Burning reduces current total supply to {number(totalSupply, 2)} OTF. It does not guarantee price appreciation. Fund-owned constituent OTF is never burned directly.</p></section>

      <div className="tokenStatusColumns">
        <section className="tokenDetailSection" aria-labelledby="vesting-title"><div className="tokenSectionHeading"><div><h2 id="vesting-title">Team market-cap vesting</h2><p>Permanent $1m live-FDV checkpoints, read from the current V4 spot price, ETH/USD, and current supply.</p></div></div><dl className="tokenStatusList"><div><dt>Total allocation</dt><dd>100,000,000 OTF</dd></div><div><dt>Unlocked</dt><dd>{number(teamUnlocked, 2)} OTF</dd></div><div><dt>Claimed</dt><dd>{number(teamClaimed, 2)} OTF</dd></div><div><dt>Still locked</dt><dd>{number(teamLocked, 2)} OTF</dd></div><div><dt>Live USD FDV</dt><dd>{usd(liveFdvRead.data, 0)}</dd></div><div><dt>ETH/USD oracle</dt><dd>{ethUsd ? `${usd(ethUsd)} · ${age(oracleRead.data?.[2])} old` : fakeOracleRead.data ? "$2,000 testnet fixed" : "—"}</dd></div><div><dt>Next milestone</dt><dd>{nextMilestone?.[0] ? usd(nextMilestone[0], 0) : "All milestones reached"}</dd></div><div><dt>Additional unlock</dt><dd>{nextMilestone?.[1] ? `${number(nextMilestone[1], 0)} OTF` : "—"}</dd></div></dl>{nextMilestone?.[0] ? <div className="launchProgress compact"><div><span>Progress to next milestone</span><strong>{(Number(nextMilestone[2]) / 1e16).toFixed(2)}%</strong></div><progress max="1000000000000000000" value={Number(nextMilestone[2])} /></div> : null}</section>

        <section className="tokenDetailSection" aria-labelledby="rewards-title"><div className="tokenSectionHeading"><div><h2 id="rewards-title">Merkle rewards</h2><p>Cumulative operator-published allocations become claimable immediately.</p></div><span className="stateBadge muted">Root v{rootVersionRead.data?.toString() ?? "—"}</span></div>{!address ? <div className="tokenEmptyState"><Wallet size={18} /><div><strong>Connect a wallet to check rewards</strong><span>The current cumulative tree will be matched to the connected address.</span></div></div> : rewardsState === "loading" ? <div className="tokenEmptyState"><LoaderCircle className="spin" size={18} /><div><strong>Checking the current tree</strong><span>Reading the published proof artifact.</span></div></div> : rewardEntry && rewardsState === "ready" ? <><dl className="tokenStatusList"><div><dt>Cumulative entitlement</dt><dd>{number(cumulativeEntitlement, 4)} OTF</dd></div><div><dt>Previously claimed</dt><dd>{number(previouslyClaimed, 4)} OTF</dd></div><div><dt>Claimable now</dt><dd>{number(claimable, 4)} OTF</dd></div><div><dt>Published</dt><dd>{rootTimeRead.data ? new Date(Number(rootTimeRead.data) * 1_000).toLocaleString() : "—"}</dd></div></dl><button className="primaryAction" type="button" disabled={claimable === 0n || claimState === "wallet" || claimState === "pending"} onClick={() => void claimRewards()}>{claimState === "wallet" || claimState === "pending" ? <LoaderCircle className="spin" size={14} /> : <CheckCircle size={14} />}{claimable === 0n ? "Fully claimed" : "Claim OTF"}</button>{claimHash ? <a className="tokenExplorerLink" href={`${explorer}/tx/${claimHash}`} target="_blank" rel="noreferrer">View claim transaction <ExternalLink size={11} /></a> : null}</> : <div className="tokenEmptyState"><CircleAlert size={18} /><div><strong>{rewardsState === "stale" ? "Proof artifact is updating" : rewardsState === "failure" ? "Rewards data unavailable" : "Wallet not included"}</strong><span>{rewardsState === "stale" ? "A newer root is active onchain; wait for its proof artifact before claiming." : rewardsState === "failure" ? "Retry after the published rewards file is available." : "This wallet has no cumulative entitlement in the current root."}</span></div></div>}</section>
      </div>

      <section className="tokenDetailSection tokenFeeUtility" aria-labelledby="fee-utility-title"><div className="tokenSectionHeading"><div><h2 id="fee-utility-title">OTF fee utility</h2><p>OTF must be an accounted fund constituent. There is no staking or cooldown, and investor fee rates remain immutable.</p></div><span className="stateBadge success">Caps at 10m OTF per fund</span></div><div className="feeUtilityTableWrap"><table><thead><tr><th>Accounted OTF</th><th>Creator share</th><th>Buyback + burn</th></tr></thead><tbody>{feeBenefitRows().map((row) => <tr key={row.otf}><td>{row.otf} OTF</td><td>{row.creator}</td><td>{row.buyback}</td></tr>)}</tbody></table></div><p className="tokenPlainNote">Raw OTF donated to a vault does not count. The holding changes only how annual expense, mint, and redeem fees are split—not the fee paid by the investor.</p></section>
    </div>
  );
}
