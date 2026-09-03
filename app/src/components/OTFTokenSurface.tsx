"use client";

import circularOtfIcon from "@onchaintradedfunds/brand/assets/otf-circular-icon.svg";
import { fakeEthUsdOracleAbi, merkleRewardsDistributorAbi, otfLaunchManagerAbi, otfTokenAbi } from "@onchaintradedfunds/generated";
import { CheckCircle, CircleAlert, ExternalLink, Flame, LoaderCircle, LockKeyhole, ReceiptText } from "lucide-react";
import Image from "next/image";
import { useEffect, useState, type ReactNode } from "react";
import { formatUnits, zeroAddress, type Address, type Hex } from "viem";
import { useAccount, useChainId, usePublicClient, useReadContract, useWalletClient } from "wagmi";
import { robinhoodChain, robinhoodChainTestnet } from "@/lib/chains";
import { robinhoodMainnetLiquidity, robinhoodTestnetAddresses } from "@/lib/deployment";
import { burnedSupply, feeBenefitRows } from "@/lib/otf-market";

const DOCS_URL = "https://docs.onchaintradedfunds.com/token-and-fee-incentives";
const MAX_SUPPLY = 1_000_000_000n * 10n ** 18n;
type TransactionState = "idle" | "wallet" | "pending" | "success" | "rejected" | "reverted";
type RewardsArtifact = { root: Hex; distributor: string; entries: Array<{ address: string; cumulativeEntitlementRaw: string; proof: Hex[] }> };

function tokenNumber(value: bigint | undefined, maximumFractionDigits = 2) {
  if (value === undefined) return "Unavailable";
  return Number(formatUnits(value, 18)).toLocaleString(undefined, { maximumFractionDigits });
}

function usd(value: bigint | undefined, maximumFractionDigits = 2) {
  if (value === undefined) return "Unavailable";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits }).format(Number(formatUnits(value, 18)));
}

function transactionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /rejected|denied|cancelled/iu.test(message)
    ? { state: "rejected" as const, message: "The wallet request was rejected. Nothing was submitted." }
    : { state: "reverted" as const, message: "The transaction reverted. Refresh onchain data and try again." };
}

function ClaimPanel({ distributor, explorer }: { distributor?: Address; explorer: string }) {
  const chainId = useChainId();
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId });
  const { data: walletClient } = useWalletClient({ chainId });
  const configured = Boolean(distributor);
  const contract = distributor ?? zeroAddress;
  const query = { enabled: configured, refetchInterval: 12_000 } as const;
  const rootRead = useReadContract({ address: contract, abi: merkleRewardsDistributorAbi, functionName: "merkleRoot", query });
  const rootVersionRead = useReadContract({ address: contract, abi: merkleRewardsDistributorAbi, functionName: "rootVersion", query });
  const claimedRead = useReadContract({ address: contract, abi: merkleRewardsDistributorAbi, functionName: "claimed", args: [address ?? zeroAddress], query: { ...query, enabled: configured && Boolean(address) } });
  const [artifact, setArtifact] = useState<RewardsArtifact>();
  const [artifactState, setArtifactState] = useState<"loading" | "ready" | "empty" | "stale" | "failure">("loading");
  const [claimState, setClaimState] = useState<TransactionState>("idle");
  const [claimHash, setClaimHash] = useState<Hex>();

  useEffect(() => {
    if (!address) { setArtifactState("empty"); setArtifact(undefined); return; }
    if (!configured) { setArtifactState("failure"); setArtifact(undefined); return; }
    if (rootRead.isPending) { setArtifactState("loading"); return; }
    const controller = new AbortController();
    setArtifactState("loading");
    void fetch(`/rewards/${chainId}.json`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 404) return undefined;
        if (!response.ok) throw new Error("REWARDS_ARTIFACT_UNAVAILABLE");
        return response.json() as Promise<RewardsArtifact>;
      })
      .then((next) => {
        if (!next) { setArtifactState("empty"); return; }
        setArtifact(next);
        const rootMatches = rootRead.data?.toLowerCase() === next.root.toLowerCase();
        const distributorMatches = next.distributor.toLowerCase() === distributor?.toLowerCase();
        setArtifactState(rootMatches && distributorMatches ? "ready" : "stale");
      })
      .catch((error) => { if (!(error instanceof Error && error.name === "AbortError")) setArtifactState("failure"); });
    return () => controller.abort();
  }, [address, chainId, configured, distributor, rootRead.data, rootRead.isPending, rootVersionRead.data]);

  const rewardEntry = artifact?.entries.find((entry) => entry.address.toLowerCase() === address?.toLowerCase());
  const entitlement = rewardEntry ? BigInt(rewardEntry.cumulativeEntitlementRaw) : 0n;
  const claimed = claimedRead.data ?? 0n;
  const claimable = entitlement > claimed ? entitlement - claimed : 0n;
  const busy = claimState === "wallet" || claimState === "pending";

  async function claimRewards() {
    if (!walletClient || !publicClient || !address || !distributor || !rewardEntry || claimable === 0n) return;
    try {
      setClaimState("wallet");
      const hash = await walletClient.writeContract({ address: distributor, abi: merkleRewardsDistributorAbi, functionName: "claim", args: [address, entitlement, rewardEntry.proof] });
      setClaimHash(hash);
      setClaimState("pending");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("claim reverted");
      setClaimState("success");
      await claimedRead.refetch();
    } catch (error) { setClaimState(transactionError(error).state); }
  }

  const status = claimState === "wallet" ? "Confirm the claim in your wallet." : claimState === "pending" ? "Claim submitted. Waiting for confirmation." : claimState === "success" ? "Rewards claimed successfully." : claimState === "rejected" ? "The wallet request was rejected. Nothing was submitted." : claimState === "reverted" ? "The claim reverted. Refresh and try again." : undefined;
  const available = !address ? "— $OTF" : artifactState === "loading" ? "Loading…" : artifactState === "empty" ? "0 $OTF" : artifactState === "ready" ? `${tokenNumber(claimable, 4)} $OTF` : "Unavailable";

  return <section className="tokenClaimPanel" aria-labelledby="claim-title">
    <h2 id="claim-title">Available to claim</h2>
    <div className="tokenClaimAmountRow"><strong>{available}</strong><button className="primaryAction" type="button" disabled={artifactState !== "ready" || claimable === 0n || busy} onClick={() => void claimRewards()}>{busy ? <LoaderCircle className="spin" size={14} /> : <CheckCircle size={14} />}Claim</button></div>
    <div className="tokenClaimLive" aria-live="polite">{status}{claimHash ? <a href={`${explorer}/tx/${claimHash}`} target="_blank" rel="noreferrer">View transaction <ExternalLink size={11} /></a> : null}</div>
  </section>;
}

export function OTFTokenSurface({ swap }: { swap: ReactNode }) {
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId });
  const { data: walletClient } = useWalletClient({ chainId });
  const testnet = chainId === robinhoodChainTestnet.id;
  const mainnet = chainId === robinhoodChain.id;
  const token = robinhoodTestnetAddresses.otfToken ?? zeroAddress;
  const launch = robinhoodTestnetAddresses.launchManager ?? zeroAddress;
  const weth = robinhoodTestnetAddresses.weth ?? zeroAddress;
  const oracle = robinhoodTestnetAddresses.ethUsdOracle ?? zeroAddress;
  const distributor = robinhoodTestnetAddresses.merkleRewardsDistributor;
  const configured = testnet && token !== zeroAddress && launch !== zeroAddress && weth !== zeroAddress;
  const query = { enabled: configured, refetchInterval: 12_000 } as const;
  const totalSupplyRead = useReadContract({ address: token, abi: otfTokenAbi, functionName: "totalSupply", query });
  const phaseRead = useReadContract({ address: launch, abi: otfLaunchManagerAbi, functionName: "phase", query });
  const priceRead = useReadContract({ address: launch, abi: otfLaunchManagerAbi, functionName: "currentOtfPriceWethWad", query });
  const progressRead = useReadContract({ address: launch, abi: otfLaunchManagerAbi, functionName: "bootstrapProgress", query });
  const oracleRead = useReadContract({ address: oracle, abi: fakeEthUsdOracleAbi, functionName: "latestRoundData", query: { ...query, enabled: configured && oracle !== zeroAddress } });
  const totalSupply = totalSupplyRead.data;
  const supply = totalSupply === undefined ? undefined : burnedSupply(MAX_SUPPLY, totalSupply);
  const phase = phaseRead.data === undefined ? undefined : Math.min(3, Math.max(0, Number(phaseRead.data)));
  const ethUsd = oracleRead.data && oracleRead.data[1] > 0n ? BigInt(oracleRead.data[1]) * 10n ** 10n : undefined;
  const priceUsd = priceRead.data !== undefined && ethUsd !== undefined ? priceRead.data * ethUsd / 10n ** 18n : undefined;
  const marketCap = totalSupply !== undefined && priceUsd !== undefined ? totalSupply * priceUsd / 10n ** 18n : undefined;
  const marketCapWeth = totalSupply !== undefined && priceRead.data !== undefined ? totalSupply * priceRead.data / 10n ** 18n : undefined;
  const [finalizeState, setFinalizeState] = useState<TransactionState>("idle");
  const [finalizeHash, setFinalizeHash] = useState<Hex>();
  const explorer = testnet ? robinhoodChainTestnet.blockExplorers.default.url : robinhoodChain.blockExplorers.default.url;
  const poolHref = testnet ? "/liquidity" : mainnet ? robinhoodMainnetLiquidity.baseUrl : undefined;
  const poolVenue = testnet ? "Testnet liquidity" : mainnet ? "Uniswap" : "Unavailable";
  const tokenStats = <section className="tokenSupplyLedger" aria-label="OTF token statistics">
    <div><span>Price</span><strong>{!configured ? "Unavailable" : priceRead.isPending || oracleRead.isPending ? "Loading…" : usd(priceUsd, 8)}</strong><small>{!configured ? "WETH price unavailable" : priceRead.isPending ? "WETH price loading…" : `${tokenNumber(priceRead.data, 10)} WETH`}</small></div>
    <div><span>Market cap</span><strong>{!configured ? "Unavailable" : totalSupplyRead.isPending || priceRead.isPending || oracleRead.isPending ? "Loading…" : usd(marketCap, 0)}</strong><small>{!configured ? "WETH market cap unavailable" : totalSupplyRead.isPending || priceRead.isPending ? "WETH market cap loading…" : `${tokenNumber(marketCapWeth)} WETH`}</small></div>
    <div><span>Pool</span><strong>{poolHref ? <a className="metricExternalLink" href={poolHref} target={mainnet ? "_blank" : undefined} rel={mainnet ? "noreferrer" : undefined}>{poolVenue}<ExternalLink size={11} /></a> : poolVenue}</strong><small>{testnet ? "OTF / USDG" : mainnet ? "Open on Uniswap" : "No supported venue"}</small></div>
  </section>;

  async function finalizeGraduation() {
    if (!walletClient || !publicClient || launch === zeroAddress) return;
    try {
      setFinalizeState("wallet");
      const hash = await walletClient.writeContract({ address: launch, abi: otfLaunchManagerAbi, functionName: "finalizeGraduation" });
      setFinalizeHash(hash);
      setFinalizeState("pending");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("finalization reverted");
      setFinalizeState("success");
      await phaseRead.refetch();
    } catch (error) { setFinalizeState(transactionError(error).state); }
  }

  if (!configured) return <div className="appView tokenView tokenMarketView"><header className="tokenMarketHeader"><div className="tokenMarketIdentity"><Image className="tokenMarketTokenIcon" src={circularOtfIcon} alt="" width={44} height={44} priority /><div><h1>$OTF</h1><p>Canonical market, launch lifecycle, buybacks, and fee split.</p></div></div><a className="secondaryAction" href={DOCS_URL} target="_blank" rel="noreferrer"><ReceiptText size={14} />Docs<ExternalLink size={12} /></a></header><div className="tokenTopRow solo">{tokenStats}</div><section className="sectionCard tokenUnavailable"><CircleAlert size={20} /><div><h2>{testnet ? "$OTF launch not deployed" : "Switch to Robinhood Testnet"}</h2><p>{testnet ? "The 20→180 ETH launch contracts have not been deployed on Robinhood Testnet." : "$OTF market and launch data are available on Robinhood Testnet."}</p></div></section></div>;

  const phases = [
    { title: "Not initialized", copy: ["20 ETH launch reference valuation.", "Pool inactive; initialization creates the one-sided 150 million OTF bootstrap position."] },
    { title: "Bootstrap active", copy: ["20 ETH → approximately 180 ETH reference valuation.", "OTF is sold from the one-sided range, WETH accumulates, and trading is active."] },
    { title: "Graduation ready", copy: ["Final tick reached at approximately 180 ETH reference valuation.", "Anyone may finalize; the completed bootstrap position is settled."] },
    { title: "Graduated", copy: ["Bootstrap WETH proceeds and the complete 50 million OTF reserve become effectively full-range liquidity.", "Principal remains permanently locked and the LP fee remains 0%."] },
  ] as const;

  return <div className="appView tokenView tokenMarketView">
    <header className="tokenMarketHeader"><div className="tokenMarketIdentity"><Image className="tokenMarketTokenIcon" src={circularOtfIcon} alt="" width={44} height={44} priority /><div><h1>$OTF</h1><p>Trade the canonical pool and inspect price, market cap, launch lifecycle, buybacks, and fee allocation.</p></div></div><a className="secondaryAction" href={DOCS_URL} target="_blank" rel="noreferrer"><ReceiptText size={14} />Docs<ExternalLink size={12} /></a></header>
    <div className="tokenTopRow">{tokenStats}<ClaimPanel distributor={distributor} explorer={explorer} /></div>
    <div className="tokenMarketGrid tokenSwapLifecycleGrid"><div className="tokenSharedSwap">{swap}</div><aside className="tokenLaunchPanel" aria-labelledby="launch-lifecycle-title"><div className="tokenSectionHeading"><div><h2 id="launch-lifecycle-title">Launch lifecycle</h2></div></div><ol className="launchLifecycle">{phases.map((item, index) => <li key={item.title} aria-current={phase === index ? "step" : undefined} data-state={phase === index ? "current" : phase !== undefined && index < phase ? "complete" : "upcoming"}><div className="launchLifecycleNode"><span aria-hidden="true" /><div><strong>{item.title}{phase === index ? <em>Current phase</em> : null}</strong>{item.copy.map((line) => <p key={line}>{line}</p>)}{phase === 1 && index === 1 ? <p className="launchLiveProgress" aria-live="polite">Live progress: {progressRead.data ? `${(Number(progressRead.data[0]) / 100).toFixed(2)}%` : "unavailable"}</p> : null}{phase === 2 && index === 2 ? <div className="launchFinalize"><button className="primaryAction" type="button" disabled={finalizeState === "wallet" || finalizeState === "pending"} onClick={() => void finalizeGraduation()}>{finalizeState === "wallet" || finalizeState === "pending" ? <LoaderCircle className="spin" size={14} /> : <LockKeyhole size={14} />}Finalize graduation</button><span aria-live="polite">{finalizeState === "wallet" ? "Confirm finalization in your wallet." : finalizeState === "pending" ? "Finalization submitted." : finalizeState === "success" ? "Graduation finalized." : finalizeState === "rejected" ? "The wallet request was rejected." : finalizeState === "reverted" ? "Finalization reverted. Refresh and retry." : ""}{finalizeHash ? <a href={`${explorer}/tx/${finalizeHash}`} target="_blank" rel="noreferrer">View transaction <ExternalLink size={11} /></a> : null}</span></div> : null}</div></div></li>)}</ol></aside></div>
    <section className="tokenDetailSection" aria-labelledby="burn-title"><div className="tokenSectionHeading"><div><h2 id="burn-title"><Flame size={16} />Buyback and burn</h2><p>The protocol buys back $OTF using proceeds from swap and NAV fees.</p></div><div className="tokenSectionMetric"><strong>{tokenNumber(supply?.burned)} OTF</strong><span>{supply ? `${(supply.burnedBps / 100).toFixed(2)}% of supply` : "Unavailable"}</span></div></div></section>
    <section className="tokenDetailSection tokenFeeUtility" aria-labelledby="fee-split-title"><div className="tokenSectionHeading"><div><h2 id="fee-split-title">$OTF fee split</h2><p>Accounted OTF changes how annual expense, mint, and redeem fee shares are divided between the creator and buyback-and-burn. The configured investor fee remains unchanged.</p></div></div><div className="feeUtilityTableWrap"><table><thead><tr><th>Accounted OTF</th><th>Creator share</th><th>Buyback + burn</th></tr></thead><tbody>{feeBenefitRows().map((row) => <tr key={row.otf}><td>{row.otf} OTF</td><td>{row.creator}</td><td>{row.buyback}</td></tr>)}</tbody></table></div></section>
  </div>;
}
