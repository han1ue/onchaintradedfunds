"use client";

import circularOtfIcon from "@onchaintradedfunds/brand/assets/otf-circular-icon.png";
import { fakeEthUsdOracleAbi, merkleRewardsDistributorAbi, otfLaunchManagerAbi, otfTokenAbi } from "@onchaintradedfunds/generated";
import { CheckCircle, CircleAlert, ExternalLink, Flame, LoaderCircle, LockKeyhole, ReceiptText, Wallet } from "lucide-react";
import Image from "next/image";
import { useEffect, useState, type ReactNode } from "react";
import { formatUnits, zeroAddress, type Address, type Hex } from "viem";
import { useAccount, useChainId, usePublicClient, useReadContract, useWalletClient } from "wagmi";
import { robinhoodChainTestnet } from "@/lib/chains";
import { robinhoodTestnetAddresses } from "@/lib/deployment";
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

  const emptyTitle = artifactState === "stale" ? "Proof artifact is updating" : artifactState === "failure" ? "Rewards data unavailable" : rewardEntry ? "Zero entitlement" : "Wallet not included";
  const emptyCopy = artifactState === "stale" ? "A newer root is active onchain; wait for its proof artifact before claiming." : artifactState === "failure" ? "The market and swap remain available. Retry when the rewards artifact is published." : rewardEntry ? "This wallet has a zero cumulative entitlement in the current root." : "This wallet is not included in the current root.";
  const status = claimState === "wallet" ? "Confirm the claim in your wallet." : claimState === "pending" ? "Claim submitted. Waiting for confirmation." : claimState === "success" ? "Rewards claimed successfully." : claimState === "rejected" ? "The wallet request was rejected. Nothing was submitted." : claimState === "reverted" ? "The claim reverted. Refresh and try again." : undefined;

  return <section className="tokenClaimPanel" aria-labelledby="claim-title">
    <div className="tokenClaimHeading"><div><h2 id="claim-title">Claim OTF rewards</h2><p>Cumulative published allocations for the connected wallet.</p></div><span className="stateBadge muted">Root v{rootVersionRead.data?.toString() ?? "—"}</span></div>
    {!address ? <div className="tokenClaimState"><Wallet size={16} /><span><strong>Connect a wallet to check rewards</strong><small>The published tree will be matched to the connected address.</small></span></div>
      : artifactState === "loading" ? <div className="tokenClaimState"><LoaderCircle className="spin" size={16} /><span><strong>Checking rewards</strong><small>Reading the current proof artifact.</small></span></div>
        : rewardEntry && entitlement > 0n && artifactState === "ready" ? <div className="tokenClaimReady"><span><small>Claimable now</small><strong>{tokenNumber(claimable, 4)} OTF</strong></span><button className="primaryAction" type="button" disabled={claimable === 0n || busy} onClick={() => void claimRewards()}>{busy ? <LoaderCircle className="spin" size={14} /> : <CheckCircle size={14} />}{claimable === 0n ? "Fully claimed" : "Claim OTF"}</button></div>
          : <div className="tokenClaimState"><CircleAlert size={16} /><span><strong>{emptyTitle}</strong><small>{emptyCopy}</small></span></div>}
    <div className="tokenClaimLive" aria-live="polite">{status}{claimHash ? <a href={`${explorer}/tx/${claimHash}`} target="_blank" rel="noreferrer">View transaction <ExternalLink size={11} /></a> : null}</div>
  </section>;
}

export function OTFTokenSurface({ swap }: { swap: ReactNode }) {
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId });
  const { data: walletClient } = useWalletClient({ chainId });
  const testnet = chainId === robinhoodChainTestnet.id;
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
  const [finalizeState, setFinalizeState] = useState<TransactionState>("idle");
  const [finalizeHash, setFinalizeHash] = useState<Hex>();
  const explorer = robinhoodChainTestnet.blockExplorers.default.url;

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

  if (!configured) return <div className="appView tokenView tokenMarketView"><header className="tokenMarketHeader"><div className="tokenMarketIdentity"><Image className="tokenMarketTokenIcon" src={circularOtfIcon} alt="" width={44} height={44} priority /><div><h1>$OTF</h1><p>Canonical market, launch lifecycle, buybacks, and fee split.</p></div></div><a className="secondaryAction" href={DOCS_URL} target="_blank" rel="noreferrer"><ReceiptText size={14} />Docs<ExternalLink size={12} /></a></header><section className="sectionCard tokenUnavailable"><CircleAlert size={20} /><div><h2>{testnet ? "OTF market unavailable" : "Switch to Robinhood Testnet"}</h2><p>{testnet ? "The configured market contracts could not be loaded." : "$OTF market and launch data are available on Robinhood Testnet."}</p></div></section></div>;

  const phases = [
    { title: "Not initialized", copy: ["10 ETH launch reference valuation.", "Pool inactive; initialization creates the one-sided 150m OTF bootstrap position."] },
    { title: "Bootstrap active", copy: ["10 ETH → approximately 90 ETH reference valuation.", "OTF is sold from the one-sided range, WETH accumulates, and trading is active."] },
    { title: "Graduation ready", copy: ["Final tick reached at approximately 90 ETH reference valuation.", "Anyone may finalize; the completed bootstrap position is settled."] },
    { title: "Graduated", copy: ["Bootstrap WETH proceeds and up to 50m reserved OTF become effectively full-range liquidity.", "Principal remains permanently locked and the LP fee remains 0%."] },
  ] as const;

  return <div className="appView tokenView tokenMarketView">
    <header className="tokenMarketHeader"><div className="tokenMarketIdentity"><Image className="tokenMarketTokenIcon" src={circularOtfIcon} alt="" width={44} height={44} priority /><div><h1>$OTF</h1><p>Trade the canonical pool and inspect live supply, launch lifecycle, buybacks, and fee allocation.</p></div></div><a className="secondaryAction" href={DOCS_URL} target="_blank" rel="noreferrer"><ReceiptText size={14} />Docs<ExternalLink size={12} /></a></header>
    <section className="tokenSupplyLedger" aria-label="OTF token statistics"><div><span>Supply</span><strong>{totalSupplyRead.isPending ? "Loading…" : totalSupply === undefined ? "Unavailable" : `${tokenNumber(totalSupply)} OTF`}</strong><small>Current total supply after burns</small></div><div><span>Price</span><strong>{priceRead.isPending ? "Loading…" : priceRead.data === undefined ? "Unavailable" : `${tokenNumber(priceRead.data, 10)} WETH`}</strong><small>{oracleRead.isPending ? "USD price loading…" : usd(priceUsd, 8)}</small></div><div><span>Market cap</span><strong>{totalSupplyRead.isPending || priceRead.isPending || oracleRead.isPending ? "Loading…" : usd(marketCap, 0)}</strong><small>Current supply × USD spot price</small></div></section>
    <ClaimPanel distributor={distributor} explorer={explorer} />
    <div className="tokenMarketGrid tokenSwapLifecycleGrid"><div className="tokenSharedSwap">{swap}</div><aside className="tokenLaunchPanel" aria-labelledby="launch-lifecycle-title"><div className="tokenSectionHeading"><div><h2 id="launch-lifecycle-title">Launch lifecycle</h2><p>Original one-billion-token reference supply; no countdown or estimated date.</p></div></div><ol className="launchLifecycle">{phases.map((item, index) => <li key={item.title} aria-current={phase === index ? "step" : undefined}><div className="launchLifecycleNode"><span aria-hidden="true" /><div><strong>{item.title}{phase === index ? <em>Current phase</em> : null}</strong>{item.copy.map((line) => <p key={line}>{line}</p>)}{phase === 1 && index === 1 ? <p className="launchLiveProgress" aria-live="polite">Live progress: {progressRead.data ? `${(Number(progressRead.data[0]) / 100).toFixed(2)}%` : "unavailable"}</p> : null}{phase === 2 && index === 2 ? <div className="launchFinalize"><button className="primaryAction" type="button" disabled={finalizeState === "wallet" || finalizeState === "pending"} onClick={() => void finalizeGraduation()}>{finalizeState === "wallet" || finalizeState === "pending" ? <LoaderCircle className="spin" size={14} /> : <LockKeyhole size={14} />}Finalize graduation</button><span aria-live="polite">{finalizeState === "wallet" ? "Confirm finalization in your wallet." : finalizeState === "pending" ? "Finalization submitted." : finalizeState === "success" ? "Graduation finalized." : finalizeState === "rejected" ? "The wallet request was rejected." : finalizeState === "reverted" ? "Finalization reverted. Refresh and retry." : ""}{finalizeHash ? <a href={`${explorer}/tx/${finalizeHash}`} target="_blank" rel="noreferrer">View transaction <ExternalLink size={11} /></a> : null}</span></div> : null}</div></div>{index < phases.length - 1 ? <span className="launchLifecycleArrow" aria-hidden="true">↓</span> : null}</li>)}</ol></aside></div>
    <section className="tokenDetailSection" aria-labelledby="burn-title"><div className="tokenSectionHeading"><div><h2 id="burn-title"><Flame size={16} />Buyback and burn</h2><p>Each fund&apos;s non-creator annual expense, mint, and normal redeem fee shares are sent to the Buyback Collector. When a buyback executes, those fund shares are redeemed, constituents are routed to WETH, OTF is bought through the canonical pool, and all purchased OTF is burned.</p></div><div className="tokenSectionMetric"><strong>{tokenNumber(supply?.burned)} OTF</strong><span>{supply ? `${(supply.burnedBps / 100).toFixed(2)}% burned` : "Unavailable"}</span></div></div><p className="tokenPlainNote">Shutdown redemptions are fee-free. Creator fee shares and fund-owned constituent OTF are not burned. Burning does not guarantee price appreciation.</p></section>
    <section className="tokenDetailSection tokenFeeUtility" aria-labelledby="fee-split-title"><div className="tokenSectionHeading"><div><h2 id="fee-split-title">$OTF fee split</h2><p>Accounted OTF changes how annual expense, mint, and redeem fee shares are divided between the creator and buyback-and-burn. The configured investor fee remains unchanged.</p></div><span className="stateBadge success">10m accounted-OTF cap</span></div><div className="feeUtilityTableWrap"><table><thead><tr><th>Accounted OTF</th><th>Creator share</th><th>Buyback + burn</th></tr></thead><tbody>{feeBenefitRows().map((row) => <tr key={row.otf}><td>{row.otf} OTF</td><td>{row.creator}</td><td>{row.buyback}</td></tr>)}</tbody></table></div><p className="tokenPlainNote">Raw OTF donated to a vault does not count toward the split.</p></section>
  </div>;
}
