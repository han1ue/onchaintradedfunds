"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ConnectButton, useConnectModal } from "@rainbow-me/rainbowkit";
import { OtfCoinIcon, OtfTokenIcon } from "@onchaintradedfunds/brand";
import {
  ArrowDown,
  CircleAlert,
  ArrowLeft,
  ArrowUpRight,
  ArrowRight,
  BookOpenText,
  BadgeCheck,
  Check,
  CheckCircle,
  ChevronDown,
  CircleDollarSign,
  Copy,
  ExternalLink,
  FilePlus2,
  History,
  Info,
  LayoutGrid,
  List,
  LoaderCircle,
  Network,
  ReceiptText,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  UserCog,
  Wallet,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { decodeFunctionResult, encodeFunctionData, erc20Abi, formatUnits, getAddress, isAddress, parseEventLogs, zeroAddress, type Address, type Hex, type TransactionReceipt } from "viem";
import { useAccount, useBalance, useChainId, usePublicClient, useReadContracts, useSwitchChain, useWalletClient } from "wagmi";
import { buybackCollectorAbi, managedOtfVaultAbi, otfEntryExitRouterAbi, otfFactoryAbi, otfLaunchManagerAbi, otfLaunchRouterAbi } from "@onchaintradedfunds/generated";
import { robinhoodChain, robinhoodChainTestnet } from "@/lib/chains";
import {
  robinhoodMainnetAddresses,
  robinhoodMainnetBasketDeployment,
  protocolDeploymentForChain,
} from "@/lib/deployment";
import { fundAssetsVerified, type AssetRegistry } from "@/lib/asset-catalog";
import { useAssetRegistry } from "@/lib/use-asset-registry";
import { chartHistory, type FundHistoryResponse } from "@/lib/fund-history";
import { usePageVisible } from "@/lib/use-page-visible";
import { accountedRewardWeightOtf, estimatedRewardsApy } from "@/lib/incentive-apy";
import { swapErrorMessage } from "@/lib/swap-error";
import { FundRewardsDialog } from "./FundRewardsDialog";
import {
  bestQueriedQuote,
  assetHasExecutableMetadata,
  classifySwapDirection,
  decimalAmount,
  decimalInputValue,
  ERC20_APPROVE_ABI,
  QUOTE_MAX_AGE_MS,
  enforceFirstPurchaseMinimum,
  executionPlanForQuote,
  isNativeWrapPair,
  isPositiveDecimalAmount,
  nativeMaxAmount,
  pastedAsset,
  quoteIsFresh,
  quoteServiceForChain,
  requestConcurrentQuotes,
  routerArgsForExecution,
  swapIncludesOtf,
  supportedSwapDirection,
  unavailableQuote,
  validSwapPair,
  type SwapAsset,
  type SwapAssetKind,
  type SwapQuote,
} from "@/lib/swap-model";
import { formatSwapDisplay, quoteRefreshDelay } from "@/lib/swap-display";
import { sortFunds, type FundSort, type FundSortKey } from "@/lib/fund-sort";
import { ensureExactErc20Approval } from "@/lib/erc20-approval";
import { quoteCanonicalOtfSwap } from "@/lib/otf-market";
import { canonicalV4Execution } from "@/lib/canonical-v4-execution";
import {
  SWAP_CELEBRATION_DURATION_MS,
  claimSwapCelebration,
  confirmedSwapReceipt,
  receiptRefundDisclosure,
  type SwapReceipt,
} from "@/lib/swap-receipt";
import {
  feeClaimReadState,
  feeSettlementCall,
  pendingFeeShares,
  proportionalWethSplit,
  redemptionFeeSettlementRouteFromQuote,
  selectFeeSettlementRoute,
  shareSaleFeeSettlementRouteFromQuote,
  type FeeSettlementRoutePreference,
  type FeeSettlementRoutes,
} from "@/lib/fee-settlement";
import { readVaultSummary, useFactoryVaults, type FactoryVaultDirectoryState, type FactoryVaultSummary } from "@/lib/use-factory-vaults";
import { formatAnnualExpenseRatioPercentage, type CreationAssetData } from "@/lib/creation-model";
import {
  formatStoredPercentage,
  loadCreationMetadata,
  weightingMethodLabel,
  type OtfCreationMetadata,
} from "@/lib/creation-metadata";
import { formatAllocationQuantity, fundAllocationRows, fundAllocationWeights, type FundAllocationRow, type FundAllocationWeights } from "@/lib/fund-composition";
import { SplashPage } from "./SplashPage";
import { TestnetLiquiditySurface } from "./TestnetLiquiditySurface";
import { CreateOTFForm } from "./CreateOTFForm";
import { OTFTokenSurface } from "./OTFTokenSurface";

export type OperateView = "landing" | "swap" | "detail" | "vaults" | "launch" | "verified" | "wallet" | "liquidity" | "token";

const DOCS_URL = "https://docs.onchaintradedfunds.com";
const X_URL = "https://x.com/OTFProtocol";
const MAX_SWAP_FRACTION_DIGITS = 8;
const FULL_RANGE_LOWER_SQRT = 4_295_128_739n;
const FULL_RANGE_UPPER_SQRT = 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342n;
const PERMIT2_APPROVE_ABI = [{
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
const PERMIT2_ALLOWANCE_ABI = [{
  type: "function", name: "allowance", stateMutability: "view",
  inputs: [{name:"owner",type:"address"},{name:"token",type:"address"},{name:"spender",type:"address"}],
  outputs: [{name:"amount",type:"uint160"},{name:"expiration",type:"uint48"},{name:"nonce",type:"uint48"}],
}] as const;
const ERC20_BALANCE_ABI = [{
  type: "function",
  name: "balanceOf",
  stateMutability: "view",
  inputs: [{ name: "account", type: "address" }],
  outputs: [{ name: "", type: "uint256" }],
}] as const;
const WETH_ABI = [{
  type: "function",
  name: "deposit",
  stateMutability: "payable",
  inputs: [],
  outputs: [],
}, {
  type: "function",
  name: "withdraw",
  stateMutability: "nonpayable",
  inputs: [{ name: "amount", type: "uint256" }],
  outputs: [],
}] as const;
const EMPTY_ERC20: SwapAsset = {
  address: zeroAddress,
  symbol: "Select token",
  name: "No network asset configured",
  kind: "erc20",
  decimals: 18,
  metadataResolved: false,
};

const EMPTY_OTF: SwapAsset = {
  address: zeroAddress,
  symbol: "Select OTF",
  name: "No factory OTF selected",
  kind: "otf",
  decimals: 18,
  metadataResolved: false,
  isFactoryVault: false,
};

function configuredAssetsFor(registry: AssetRegistry, chainId: number): SwapAsset[] {
  const assets = registry.assets.filter(asset => asset.chainId === chainId && asset.enabled && asset.featured);
  const configured = assets.map((asset): SwapAsset => ({
    address: asset.address,
    symbol: asset.symbol,
    name: asset.name,
    kind: "erc20",
    decimals: asset.decimals,
    metadataResolved: true,
    verified: asset.verified,
    isProtocolToken: asset.assetType === "protocol_token" && asset.address.toLowerCase() === protocolDeploymentForChain(chainId)?.addresses.otfToken?.toLowerCase(),
  }));
  const canonicalWeth = chainId === robinhoodChainTestnet.id
    ? protocolDeploymentForChain(chainId)?.addresses.weth
    : chainId === robinhoodChain.id
      ? robinhoodMainnetAddresses.weth
      : undefined;
  if (canonicalWeth) configured.unshift({
    address: canonicalWeth,
    symbol: "ETH",
    name: "Native Ether",
    kind: "native",
    decimals: 18,
    metadataResolved: true,
    verified: false,
  });
  return configured;
}

function configuredUsdgFor(registry: AssetRegistry, chainId: number): SwapAsset | undefined {
  return configuredAssetsFor(registry, chainId).find((asset) => asset.address.toLowerCase() === protocolDeploymentForChain(chainId)?.addresses.usdg?.toLowerCase());
}

function configuredNativeFor(registry: AssetRegistry, chainId: number): SwapAsset | undefined {
  return configuredAssetsFor(registry, chainId).find((asset) => asset.kind === "native");
}

function configuredWethFor(registry: AssetRegistry, chainId: number): SwapAsset | undefined {
  return configuredAssetsFor(registry, chainId).find((asset) => asset.kind === "erc20" && asset.address.toLowerCase() === protocolDeploymentForChain(chainId)?.addresses.weth?.toLowerCase());
}

function configuredDefaultInputFor(registry: AssetRegistry, chainId: number): SwapAsset | undefined {
  return configuredNativeFor(registry, chainId) ?? configuredWethFor(registry, chainId);
}

function configuredProtocolTokenFor(registry: AssetRegistry, chainId: number): SwapAsset | undefined {
  return configuredAssetsFor(registry, chainId).find((asset) => asset.isProtocolToken === true);
}

function addressFromLocation(): Address | undefined {
  if (typeof window === "undefined") return undefined;
  const segments = window.location.pathname.split("/").filter(Boolean);
  const candidate = segments[0] === "funds" ? segments[1] : undefined;
  return candidate && isAddress(candidate) ? getAddress(candidate) : undefined;
}

function sameAsset(left: SwapAsset | undefined, right: SwapAsset | undefined): boolean {
  return Boolean(left && right && left.kind === right.kind && left.address.toLowerCase() === right.address.toLowerCase());
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function transactionHashFromLocation(): Hex | undefined {
  if (typeof window === "undefined") return undefined;
  const value = new URLSearchParams(window.location.search).get("tx");
  return value && /^0x[0-9a-f]{64}$/iu.test(value) ? value as Hex : undefined;
}

function AssetLogo({ symbol }: { symbol: string }) {
  return <OtfTokenIcon className="assetLogoFallback" size={32} ticker={symbol} />;
}

function AssetMark({ asset }: { asset: SwapAsset }) {
  let mark: ReactNode = undefined;
  if (asset.kind === "otf") mark = <OtfTokenIcon className="swapAssetBrandMark" size={30} ticker={isUnselectedOtf(asset) ? "OTF" : asset.symbol} />;
  if (asset.isProtocolToken) mark = <OtfCoinIcon className="swapAssetImage" size={30} />;
  const tokenIcon = asset.kind === "native"
    ? "/assets/tokens/eth.png"
    : asset.symbol.toUpperCase() === "WETH"
      ? "/assets/tokens/weth.png"
    : asset.symbol.toUpperCase() === "USDG"
      ? "/assets/tokens/usdg.png"
      : undefined;
  if (!mark && tokenIcon) mark = <Image className="swapAssetImage" src={tokenIcon} alt="" width={30} height={30} />;
  if (!mark) mark = <span className="swapAssetMark">{asset.symbol.slice(0, 1)}</span>;
  return <span className="swapAssetIconFrame" aria-hidden="true">{mark}</span>;
}

function ActivitySpinner({ size = 16 }: { size?: number }) {
  return <LoaderCircle className="createAssetSpinner" size={size} role="img" aria-label="Please wait" />;
}

function SwapBalance({ active, loading, balance, symbol, onUse }: {
  active: boolean;
  loading: boolean;
  balance?: { formatted: string; value: bigint };
  symbol: string;
  onUse?: () => void;
}) {
  if (!active) return null;
  if (loading) return <ActivitySpinner size={12} />;
  if (!balance) return null;
  const label = `${formatSwapDisplay(balance.formatted)} ${symbol}`;
  if (!onUse || balance.value === 0n) return <>{label}</>;
  return <button type="button" className="swapBalanceButton" title={`Use the full ${label} balance`} aria-label={`Use full balance: ${label}`} onClick={onUse}>{label}</button>;
}

function isUnselectedOtf(asset: SwapAsset): boolean {
  return asset.kind === "otf" && asset.address === zeroAddress;
}

function TokenPicker({
  title,
  onClose,
  onSelect,
  selected,
  exclude,
  routeFund,
  configuredAssets,
  otfAssets,
  otfDirectoryState,
  fixedKind,
}: {
  title: string;
  onClose: () => void;
  onSelect: (asset: SwapAsset) => void;
  selected?: SwapAsset;
  exclude?: SwapAsset;
  routeFund?: SwapAsset;
  configuredAssets: readonly SwapAsset[];
  otfAssets: readonly SwapAsset[];
  otfDirectoryState: "unavailable" | "loading" | "ready" | "failure";
  fixedKind?: SwapAssetKind;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"token" | "otf">((fixedKind ?? selected?.kind) === "otf" ? "otf" : "token");
  const searchRef = useRef<HTMLInputElement>(null);
  const addressAsset = pastedAsset(query);
  const options: SwapAsset[] = [...configuredAssets, ...otfAssets];
  if (routeFund && !options.some((asset) => sameAsset(asset, routeFund))) options.push(routeFund);
  const searchable = options
    .filter((asset) => (kind === "otf" ? asset.kind === "otf" : asset.kind !== "otf") && !sameAsset(asset, exclude))
    .filter((asset) => !query || asset.symbol.toLowerCase().includes(query.trim().toLowerCase()) || asset.address.toLowerCase() === query.trim().toLowerCase());
  const canSelectAddress = Boolean(addressAsset && !sameAsset(addressAsset, exclude));

  useEffect(() => {
    searchRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="swapDialogBackdrop" role="presentation" onMouseDown={onClose}>
      <section className="swapTokenDialog" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <strong>{title}</strong>
          <button type="button" className="swapIconButton" aria-label="Close token selector" onClick={onClose}><X size={17} /></button>
        </header>
        <label className="swapTokenSearch">
          <Search size={16} />
          <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search or paste a token address" />
        </label>
        {!fixedKind ? (
          <div className="swapKindToggle" aria-label="Asset kind">
            <button type="button" aria-pressed={kind === "token"} className={kind === "token" ? "selected" : ""} onClick={() => setKind("token")}>Token</button>
            <button type="button" aria-pressed={kind === "otf"} className={kind === "otf" ? "selected" : ""} onClick={() => setKind("otf")}>OTF share</button>
          </div>
        ) : null}
        <div className="swapTokenList">
          {searchable.map((asset) => (
            <button type="button" key={`${asset.kind}-${asset.address}`} className="swapTokenOption" onClick={() => onSelect(asset)}>
              <AssetMark asset={asset} />
              <span><strong>{asset.symbol}</strong><small>{asset.name}{asset.verified === false && asset.kind !== "native" ? " · Unverified" : ""}</small></span>
              {sameAsset(asset, selected) ? <Check size={15} aria-label="Selected" /> : <small>{shortAddress(asset.address)}</small>}
            </button>
          ))}
          {canSelectAddress ? (
            <button type="button" className="swapTokenOption addressOption" onClick={() => onSelect({ ...addressAsset!, kind: kind === "otf" ? "otf" : "erc20" })}>
              <AssetMark asset={{ ...addressAsset!, kind: kind === "otf" ? "otf" : "erc20" }} />
              <span><strong>{kind === "otf" ? "OTF share address" : "Token address"}</strong><small>{shortAddress(addressAsset!.address)}</small></span>
              <small>Unresolved</small>
            </button>
          ) : null}
          {!searchable.length && !canSelectAddress ? <p className="swapPickerEmpty">{kind === "otf" && otfDirectoryState === "loading" ? <ActivitySpinner size={18} /> : kind === "otf" && otfDirectoryState === "failure" ? "The factory OTF directory could not be loaded." : `No configured ${kind === "otf" ? "OTF shares" : "tokens"} match this search.`}</p> : null}
        </div>
        <p className="swapTokenFootnote">Pasting an address only selects it. It does not resolve metadata, establish verification, or enable a route.</p>
      </section>
    </div>
  );
}

function OperateFooter() {
  const chainId = useChainId();
  const showTestnetLinks = chainId === robinhoodChainTestnet.id;

  return (
    <footer className="dashboardFooter">
      <span>Onchain Traded Funds</span>
      <div className="footerLinks">
        {showTestnetLinks ? <a href="https://faucet.testnet.chain.robinhood.com/" target="_blank" rel="noreferrer">ETH Faucet</a> : null}
        {showTestnetLinks ? <a href="https://faucet.paxos.com/" target="_blank" rel="noreferrer">USDG Faucet</a> : null}
        {showTestnetLinks ? <Link href="/liquidity">Liquidity</Link> : null}
        <a href={X_URL} target="_blank" rel="noreferrer" aria-label="OTF Protocol on X">@OTFProtocol</a>
        <a href={DOCS_URL} target="_blank" rel="noreferrer">Docs<ExternalLink size={12} /></a>
      </div>
    </footer>
  );
}

function AppPageHeader({ title, description, icon, titleActions, actions }: { title: React.ReactNode; description: React.ReactNode; icon: React.ReactNode; titleActions?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="appPageHeader">
      <div><span className="appPageIcon">{icon}</span><div><div className="appPageTitleLine"><h1>{title}</h1>{titleActions ? <div className="appPageTitleActions">{titleActions}</div> : null}</div><p>{description}</p></div></div>
      {actions ? <div className="appPageActions">{actions}</div> : null}
    </header>
  );
}

function QuoteReview({
  quotes,
  activeQuote,
  onChoose,
  onRefresh,
  outputSymbol,
  now,
  quoteStartedAt,
  executionBusy,
}: {
  quotes: SwapQuote[];
  activeQuote?: SwapQuote;
  onChoose: (quote: SwapQuote) => void;
  onRefresh: () => void;
  outputSymbol: string;
  now: number;
  quoteStartedAt?: number;
  executionBusy: boolean;
}) {
  const selectedValid = Boolean(activeQuote && quoteIsFresh(activeQuote, now));
  const loading = quotes.some((quote) => quote.state === "loading");
  const remainingMs = quoteRefreshDelay(quoteStartedAt, now) ?? 0;
  const remainingPercent = Math.min(100, remainingMs / QUOTE_MAX_AGE_MS * 100);
  const executionTarget = activeQuote?.execution?.kind === "direct-api"
    ? activeQuote.execution.universalRouter
    : activeQuote?.execution?.kind === "direct-registered"
      ? activeQuote.execution.universalRouter
      : activeQuote?.execution?.router;
  return (
    <details className="swapReview">
      <summary><span>Quote details</span><small>{selectedValid ? activeQuote?.routeLabel : loading ? "Refreshing quote…" : quotes.length ? "Quotes unavailable" : ""}</small><ChevronDown size={15} /></summary>
      <div className="swapReviewBody">
        <div className="swapReviewHeader"><strong>{selectedValid || loading ? "Compared routes" : ""}</strong><button type="button" onClick={onRefresh} disabled={loading || executionBusy} aria-label={loading ? "Refreshing quote" : "Refresh quote"} title={loading ? "Refreshing quote" : executionBusy ? "Refresh paused during the swap" : `Refresh quote · automatic refresh in ${Math.ceil(remainingMs / 1_000)}s`}>
          {loading ? <LoaderCircle className="createAssetSpinner" size={16} aria-hidden="true" /> : <svg className="swapRefreshCountdown" width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
            <circle className="swapRefreshTrack" cx="10" cy="10" r="7" />
            <circle className="swapRefreshRemaining" cx="10" cy="10" r="7" pathLength="100" strokeDasharray={`${remainingPercent} 100`} transform="rotate(-90 10 10)" />
          </svg>}<span>Refresh</span>
        </button></div>
        {quotes.length ? <div className="swapRoutes">
          {quotes.map((quote) => {
            const valid = quoteIsFresh(quote, now);
            return (
              <button key={quote.id} type="button" className={`swapRoute ${activeQuote?.id === quote.id ? "selected" : ""}`} disabled={!valid} onClick={() => onChoose(quote)}>
                <span><strong>{quote.routeLabel}</strong><small>{quote.reason || (quote.state === "loading" ? "Fetching quote…" : valid ? "Quoted route" : "Unavailable")}</small>{quote.requestId ? <small>Reference: {quote.requestId}</small> : null}</span>
                <span className={`swapRouteState ${valid ? "ready" : ""}`}>{valid ? activeQuote?.id === quote.id ? "Selected" : "Use route" : quote.state === "loading" ? <ActivitySpinner size={13} /> : quote.state}</span>
              </button>
            );
          })}
        </div> : null}
        {selectedValid ? <dl className="swapQuoteMetrics">
          <div><dt>Expected output</dt><dd>{selectedValid ? `${formatSwapDisplay(activeQuote?.expectedOutput ?? activeQuote?.outputAmount)} ${outputSymbol}` : "—"}</dd></div>
          <div><dt>Minimum received</dt><dd>{selectedValid ? `${formatSwapDisplay(activeQuote?.minimumReceived)} ${outputSymbol}` : "—"}</dd></div>
          <div><dt>Venue fees</dt><dd>{selectedValid && activeQuote?.venueFeeBps !== undefined ? `${formatSwapDisplay(String(activeQuote.venueFeeBps / 100), 2)}%` : "—"}</dd></div>
          <div><dt>Price impact</dt><dd>{selectedValid && activeQuote?.priceImpactBps !== undefined ? `${formatSwapDisplay(String(activeQuote.priceImpactBps / 100), 2)}%` : "—"}</dd></div>
          <div><dt>Route</dt><dd>{selectedValid ? activeQuote?.routeLabel : "No valid route selected"}</dd></div>
          <div><dt>Network gas</dt><dd>{selectedValid ? formatSwapDisplay(activeQuote?.gasEstimate) : "—"}</dd></div>
          <div><dt>Execution target</dt><dd>{selectedValid && executionTarget ? shortAddress(executionTarget) : "—"}</dd></div>
        </dl> : null}
        <div className="swapRouteInspection">
          {selectedValid ? <strong>Route inspection</strong> : null}
          {selectedValid && activeQuote?.hops?.length ? (
            <ol>
              {activeQuote.hops.map((hop, index) => (
                <li key={`${hop.venue}-${hop.tokenIn}-${hop.tokenOut}-${index}`}>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{hop.venue}</strong>
                    <small>{shortAddress(hop.tokenIn)} → {shortAddress(hop.tokenOut)}</small>
                    <small>{hop.venue === "Uniswap V3" && hop.feeTier !== undefined
                      ? `V3 fee tier ${hop.feeTier / 10_000}% · pool authenticated by the adapter during execution`
                      : "Uniswap Classic single-chain route"}</small>
                  </div>
                </li>
              ))}
            </ol>
          ) : loading ? <p role="status"><ActivitySpinner size={13} /> Refreshing quote…</p> : <p>No executable hop details are available for inspection.</p>}
        </div>
        {selectedValid && activeQuote?.residualRefunds?.length ? (
          <div className="swapRouteRefunds">
            <strong>Expected residual refunds</strong>
            <ul>{activeQuote.residualRefunds.map((refund) => <li key={refund.token}>{formatSwapDisplay(refund.displayAmount ?? refund.amount.toString())} · {shortAddress(refund.token)}</li>)}</ul>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function SwapCelebration({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <svg className="swapCelebration" viewBox="0 0 320 160" aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => {
        const left = index < 4;
        const y = 38 + index % 4 * 28;
        const path = `M ${left ? 8 : 312} ${y} C ${left ? 80 : 240} ${y}, ${left ? 104 : 216} 80, 160 80`;
        return <g key={index} style={{ "--stream-delay": `${index % 4 * 180}ms` } as CSSProperties}>
          <path className="swapCelebrationRail" d={path} />
          <path className="swapCelebrationStream" d={path} pathLength="100" />
        </g>;
      })}
      <g className="swapCelebrationOrbits">
        <ellipse cx="160" cy="80" rx="72" ry="24" transform="rotate(-18 160 80)" />
        <ellipse cx="160" cy="80" rx="94" ry="34" transform="rotate(18 160 80)" />
      </g>
    </svg>
  );
}

function SwapReceiptPanel({ receipt, onBack, celebrating, showFundLink }: { receipt: SwapReceipt; onBack: () => void; celebrating: boolean; showFundLink: boolean }) {
  const chain = receipt.chainId === robinhoodChainTestnet.id ? robinhoodChainTestnet : robinhoodChain;
  const [refundsExpanded, setRefundsExpanded] = useState(false);
  const refundDisclosure = receiptRefundDisclosure(receipt.refunds, refundsExpanded);
  return (
    <div className="swapReceipt" aria-labelledby="swap-receipt-title">
      <button type="button" className="swapReceiptBack" onClick={onBack}><ArrowLeft size={14} />Back to swap</button>
      <div className="swapReceiptHeading">
        <div className={`swapReceiptMark${celebrating ? " celebrating" : ""}`}>
          <SwapCelebration active={celebrating} />
          <span className="swapReceiptConfirmedIcon"><Check size={25} strokeWidth={2.2} /></span>
        </div>
        <h2 id="swap-receipt-title">Swap complete</h2>
      </div>
      <div className="swapReceiptResult" aria-live="polite">
        {receipt.sold ? <p><span>You paid</span><strong>{formatSwapDisplay(receipt.sold.displayAmount)} {receipt.sold.symbol}</strong></p> : null}
        <p><span>You received</span><strong>{formatSwapDisplay(receipt.received.displayAmount)} {receipt.received.symbol}</strong></p>
      </div>
      {receipt.refunds.length ? (
        <section className="swapReceiptRefunds" aria-labelledby="swap-refunds-title">
          <div><h3 id="swap-refunds-title">Also returned</h3><p>Surplus from basket execution</p></div>
          <ul className={refundsExpanded ? "expanded" : undefined}>
            {refundDisclosure.visible.map((refund) => <li key={refund.address}><span>{formatSwapDisplay(refund.displayAmount)}</span><strong>{refund.symbol}</strong></li>)}
          </ul>
          {refundDisclosure.hiddenCount ? <button type="button" onClick={() => setRefundsExpanded(true)}>Show {refundDisclosure.hiddenCount} more</button> : refundsExpanded && receipt.refunds.length > 4 ? <button type="button" onClick={() => setRefundsExpanded(false)}>Show less</button> : null}
        </section>
      ) : null}
      <dl className="swapReceiptDetails">
        <div><dt>Transaction</dt><dd><a href={`${chain.blockExplorers.default.url}/tx/${receipt.hash}`} target="_blank" rel="noreferrer" title={receipt.hash}>{shortAddress(receipt.hash)}<ExternalLink size={12} /></a></dd></div>
        <div><dt>Network</dt><dd>{chain.name}</dd></div>
        <div><dt>Gas fee</dt><dd title={`${formatUnits(receipt.gasFee, chain.nativeCurrency.decimals)} ${chain.nativeCurrency.symbol}`}>{formatSwapDisplay(formatUnits(receipt.gasFee, chain.nativeCurrency.decimals))} {chain.nativeCurrency.symbol}</dd></div>
        <div><dt>Gas used</dt><dd>{receipt.gasUsed.toLocaleString()}</dd></div>
      </dl>
      {showFundLink && !receipt.fund.isProtocolToken ? <Link className="swapPrimary swapReceiptPrimary" href={receipt.fundHref}>View {receipt.fund.symbol}<ArrowRight size={14} /></Link> : null}
    </div>
  );
}

export function SwapSurface({ embeddedFund, embedded = false, protocolTokenMode = false }: { embeddedFund?: SwapAsset; embedded?: boolean; protocolTokenMode?: boolean } = {}) {
  const chainId = useChainId();
  const { address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChain } = useSwitchChain();
  const publicClient = usePublicClient({ chainId });
  const { data: walletClient } = useWalletClient({ chainId });
  const { registry } = useAssetRegistry();
  const pageVisible = usePageVisible();
  const configuredAssets = useMemo(() => configuredAssetsFor(registry, chainId), [registry, chainId]);
  const { state: otfDirectoryState, vaults: factoryVaults } = useFactoryVaults();
  const otfAssets = useMemo<SwapAsset[]>(() => factoryVaults.map((vault) => ({
    address: vault.address,
    symbol: vault.symbol,
    name: vault.name,
    kind: "otf",
    decimals: 18,
    metadataResolved: true,
    isFactoryVault: true,
  })), [factoryVaults]);
  const routeFundAddress = addressFromLocation();
  const routeFund = embeddedFund ?? (routeFundAddress ? { address: routeFundAddress, symbol: "OTF", name: "Unresolved fund route address", kind: "otf" as const, decimals: 18, metadataResolved: false } : undefined);
  const pinnedAsset = protocolTokenMode ? configuredProtocolTokenFor(registry, chainId) : embeddedFund;
  const [input, setInput] = useState<SwapAsset>(() => configuredDefaultInputFor(registry, chainId) ?? EMPTY_ERC20);
  const [output, setOutput] = useState<SwapAsset>(() => embeddedFund ?? (protocolTokenMode ? configuredProtocolTokenFor(registry, chainId) ?? EMPTY_OTF : EMPTY_OTF));
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);
  const [swapSettingsOpen, setSwapSettingsOpen] = useState(false);
  const [picker, setPicker] = useState<"input" | "output">();
  const [quotes, setQuotes] = useState<SwapQuote[]>([]);
  const [activeQuote, setActiveQuote] = useState<SwapQuote>();
  const [quoteRequest, setQuoteRequest] = useState(0);
  const [quoteStartedAt, setQuoteStartedAt] = useState<number>();
  const [now, setNow] = useState(Date.now());
  const [execution, setExecution] = useState<"idle" | "approval" | "simulation" | "submission" | "success" | "failure">("idle");
  const [executionMessage, setExecutionMessage] = useState<string>();
  const [executionHash, setExecutionHash] = useState<Hex>();
  const [swapReceipt, setSwapReceipt] = useState<SwapReceipt>();
  const [receiptStageHeight, setReceiptStageHeight] = useState<number>();
  const [celebrationActive, setCelebrationActive] = useState(false);
  const swapSettingsRef = useRef<HTMLDivElement>(null);
  const swapStageRef = useRef<HTMLDivElement>(null);
  const celebratedSwapsRef = useRef(new Set<string>());
  const celebrationTimerRef = useRef<number | undefined>(undefined);
  const amountInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (celebrationTimerRef.current !== undefined) window.clearTimeout(celebrationTimerRef.current);
  }, []);

  useEffect(() => {
    if (swapReceipt) return;
    const frame = window.requestAnimationFrame(() => amountInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [swapReceipt]);

  useEffect(() => {
    if (embedded || protocolTokenMode || !isUnselectedOtf(output) || !otfAssets.length) return;
    const randomOtf = otfAssets[Math.floor(Math.random() * otfAssets.length)];
    if (randomOtf) setOutput(randomOtf);
  }, [embedded, otfAssets, output, protocolTokenMode]);

  const pairValid = validSwapPair(input, output);
  const sameAssetSelected = sameAsset(input, output);
  const pairExecutable = assetHasExecutableMetadata(input) && assetHasExecutableMetadata(output);
  const hasOtfSide = swapIncludesOtf(input, output);
  useEffect(() => {
    if (protocolTokenMode && !output.metadataResolved) { const token = configuredProtocolTokenFor(registry, chainId); if (token) setOutput(token); }
  }, [registry, chainId, protocolTokenMode, output.metadataResolved]);
  const configuredWeth = configuredWethFor(registry, chainId);
  const nativeWrapPair = isNativeWrapPair(input, output, configuredWeth?.address);
  const missingOtfAsset = pairValid && !hasOtfSide && !nativeWrapPair;
  const protocolToken = protocolDeploymentForChain(chainId)?.addresses.otfToken;
  const canonicalWeth = protocolDeploymentForChain(chainId)?.addresses.weth;
  const launchManager = protocolDeploymentForChain(chainId)?.addresses.launchManager;
  const launchRouter = protocolDeploymentForChain(chainId)?.addresses.launchRouter;
  const canonicalOtfPair = Boolean(
    protocolDeploymentForChain(chainId)?.canonicalReady
    && protocolToken
    && canonicalWeth
    && ((input.address.toLowerCase() === protocolToken.toLowerCase() && output.address.toLowerCase() === canonicalWeth.toLowerCase())
      || (output.address.toLowerCase() === protocolToken.toLowerCase() && input.address.toLowerCase() === canonicalWeth.toLowerCase())),
  );
  const directionSupported = nativeWrapPair || canonicalOtfPair || supportedSwapDirection(input, output, chainId);
  const amountValid = isPositiveDecimalAmount(amount, input.decimals);
  const supportedNetwork = chainId === robinhoodChainTestnet.id || chainId === robinhoodChain.id;
  const canonicalReadAddress = launchManager ?? zeroAddress;
  const canonicalReadContracts = [
    { address: canonicalReadAddress, abi: otfLaunchManagerAbi, functionName: "phase" },
    { address: canonicalReadAddress, abi: otfLaunchManagerAbi, functionName: "currentPoolState" },
    { address: canonicalReadAddress, abi: otfLaunchManagerAbi, functionName: "currentOtfPriceWethWad" },
    { address: canonicalReadAddress, abi: otfLaunchManagerAbi, functionName: "initialSqrtPriceX96" },
    { address: canonicalReadAddress, abi: otfLaunchManagerAbi, functionName: "finalSqrtPriceX96" },
    { address: canonicalReadAddress, abi: otfLaunchManagerAbi, functionName: "otfIsCurrency0" },
    { address: canonicalReadAddress, abi: otfLaunchManagerAbi, functionName: "bootstrapLiquidity" },
    { address: canonicalReadAddress, abi: otfLaunchManagerAbi, functionName: "permanentLiquidity" },
    { address: canonicalReadAddress, abi: otfLaunchManagerAbi, functionName: "bootstrapSqrtPriceBounds" },
  ] as const;
  const { data: canonicalPoolReads, isFetching: canonicalPoolFetching, refetch: refetchCanonicalPool } = useReadContracts({
    contracts: canonicalReadContracts,
    query: { enabled: canonicalOtfPair && Boolean(launchManager), refetchInterval: 12_000 },
  });
  const canonicalPhase = Number(canonicalPoolReads?.[0]?.result ?? 0);
  const canonicalAmountRaw = amountValid ? decimalAmount(amount, input.decimals) : undefined;
  const canonicalQuote = useMemo(() => {
    const poolState = canonicalPoolReads?.[1]?.result;
    const otfPriceWethWad = canonicalPoolReads?.[2]?.result;
    const finalSqrtPriceX96 = canonicalPoolReads?.[4]?.result;
    const otfIsCurrency0 = canonicalPoolReads?.[5]?.result;
    const bootstrapLiquidity = canonicalPoolReads?.[6]?.result;
    const permanentLiquidity = canonicalPoolReads?.[7]?.result;
    const bootstrapBounds = canonicalPoolReads?.[8]?.result;
    if (!canonicalOtfPair || !canonicalAmountRaw || !poolState || otfPriceWethWad === undefined
      || finalSqrtPriceX96 === undefined || otfIsCurrency0 === undefined) return undefined;
    const liquidity = canonicalPhase === 3 ? permanentLiquidity : bootstrapLiquidity;
    if (!liquidity) return undefined;
    if (canonicalPhase !== 3 && !bootstrapBounds) return undefined;
    try {
      return quoteCanonicalOtfSwap({
        side: input.isProtocolToken ? "sell" : "buy",
        amountIn: canonicalAmountRaw,
        slippageBps,
        sqrtPriceX96: poolState[0],
        liquidity,
        lowerSqrtPriceX96: canonicalPhase === 3 ? FULL_RANGE_LOWER_SQRT : bootstrapBounds![0],
        upperSqrtPriceX96: canonicalPhase === 3 ? FULL_RANGE_UPPER_SQRT : bootstrapBounds![1],
        otfIsCurrency0,
        otfPriceWethWad,
      });
    } catch {
      return undefined;
    }
  }, [canonicalAmountRaw, canonicalOtfPair, canonicalPhase, canonicalPoolReads, input.isProtocolToken, slippageBps]);
  const canonicalQuoteUsable = Boolean(
    canonicalQuote
      && canonicalQuote.amountOut > 0n
      && (canonicalPhase === 1 || (canonicalPhase === 3 && canonicalQuote.fullyFilled)),
  );
  const usableQuote = nativeWrapPair ? amountValid : canonicalOtfPair ? canonicalQuoteUsable : Boolean(activeQuote && quoteIsFresh(activeQuote, now));
  const quoteService = useMemo(() => quoteServiceForChain(chainId), [chainId]);
  const executionPlan = useMemo(() => executionPlanForQuote(activeQuote, chainId, now), [activeQuote, chainId, now]);
  const executionConfigured = executionPlan?.kind === "basket-router"
    ? Boolean(input.kind === "native" || output.kind === "native"
      ? protocolDeploymentForChain(chainId)?.nativeEntryReady : protocolDeploymentForChain(chainId)?.routingReady)
    : Boolean(executionPlan && protocolDeploymentForChain(chainId)?.routingReady
      && protocolDeploymentForChain(chainId)?.v4.universalRouter?.toLowerCase() === executionPlan.universalRouter.toLowerCase());
  const quoteNetworkConfigured = nativeWrapPair ? Boolean(configuredWeth) : canonicalOtfPair ? Boolean(protocolDeploymentForChain(chainId)?.canonicalReady) : Boolean(protocolDeploymentForChain(chainId)?.routingReady);
  const routingLabel = nativeWrapPair ? "Native wrap · 1:1"
    : canonicalOtfPair ? canonicalPhase === 1 ? "Launch boundary router" : "Canonical V4"
      : activeQuote?.routeLabel ?? "Uniswap pools";
  const inputSelected = input.address !== zeroAddress;
  const outputSelected = output.address !== zeroAddress;
  const outputOtfLoading = isUnselectedOtf(output) && otfDirectoryState === "loading";
  const inputBalanceEnabled = Boolean(address && inputSelected && assetHasExecutableMetadata(input));
  const outputBalanceEnabled = Boolean(address && outputSelected && assetHasExecutableMetadata(output));
  const { data: inputBalance, isLoading: inputBalanceLoading, refetch: refetchInputBalance } = useBalance({
    address,
    token: inputSelected && input.kind !== "native" ? input.address : undefined,
    chainId,
    query: { enabled: inputBalanceEnabled },
  });
  const { data: outputBalance, isLoading: outputBalanceLoading, refetch: refetchOutputBalance } = useBalance({
    address,
    token: outputSelected && output.kind !== "native" ? output.address : undefined,
    chainId,
    query: { enabled: outputBalanceEnabled },
  });
  const [nativeGasReserve, setNativeGasReserve] = useState(0n);
  useEffect(() => {
    let cancelled = false;
    if (!publicClient || input.kind !== "native") {
      setNativeGasReserve(0n);
      return;
    }
    void publicClient.estimateFeesPerGas().then((fees) => {
      if (!cancelled) setNativeGasReserve(500_000n * (fees.maxFeePerGas ?? fees.gasPrice ?? 0n));
    }).catch(() => {
      if (!cancelled) setNativeGasReserve(0n);
    });
    return () => { cancelled = true; };
  }, [input.kind, publicClient]);
  const inputAmountRaw = amountValid ? decimalAmount(amount, input.decimals) : undefined;
  const insufficientBalance = Boolean(inputAmountRaw !== undefined && inputBalance && (
    input.kind === "native" ? inputAmountRaw + nativeGasReserve > inputBalance.value : inputAmountRaw > inputBalance.value
  ));

  useEffect(() => {
    const interval = window.setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 1_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!swapSettingsOpen) return;
    const closeSettings = (event: PointerEvent) => {
      if (!swapSettingsRef.current?.contains(event.target as Node)) setSwapSettingsOpen(false);
    };
    const closeSettingsOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSwapSettingsOpen(false);
    };
    document.addEventListener("pointerdown", closeSettings);
    document.addEventListener("keydown", closeSettingsOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeSettings);
      document.removeEventListener("keydown", closeSettingsOnEscape);
    };
  }, [swapSettingsOpen]);

  useEffect(() => {
    setQuotes((current) => {
      let changed = false;
      const next = current.map((quote) => {
        if (quote.state !== "available" || quoteIsFresh(quote, now)) return quote;
        changed = true;
        return { ...quote, state: "stale" as const };
      });
      return changed ? next : current;
    });
    setActiveQuote((current) => (
      current?.state === "available" && !quoteIsFresh(current, now) ? { ...current, state: "stale" } : current
    ));
  }, [now]);

  const selectionNetwork = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!registry.assets.length || selectionNetwork.current === chainId) return;
    selectionNetwork.current = chainId;
    if (protocolTokenMode) {
      setInput(configuredDefaultInputFor(registry, chainId) ?? EMPTY_ERC20);
      setOutput(configuredProtocolTokenFor(registry, chainId) ?? EMPTY_OTF);
      return;
    }
    if (embedded) {
      const networkUsdg = configuredUsdgFor(registry, chainId);
      setInput((current) => current.verified ? networkUsdg ?? EMPTY_ERC20 : current);
      setOutput((current) => current.verified ? EMPTY_ERC20 : current);
      return;
    }
    setInput(configuredDefaultInputFor(registry, chainId) ?? EMPTY_ERC20);
    setOutput(EMPTY_OTF);
  }, [chainId, embedded, protocolTokenMode, registry]);

  useEffect(() => {
    if (!pageVisible) return;
    if (nativeWrapPair) {
      setQuotes([]);
      setActiveQuote(undefined);
      return;
    }
    if (canonicalOtfPair) {
      setQuotes([]);
      setActiveQuote(undefined);
      return;
    }
    if (!pairValid || !pairExecutable || !directionSupported || !amountValid || !supportedNetwork) {
      setQuotes([]);
      setActiveQuote(undefined);
      return;
    }
    const requestedAt = Date.now();
    setQuoteStartedAt(requestedAt);
    setNow(requestedAt);
    const controller = new AbortController();
    const request = { chainId, input, output, inputAmount: amount, slippageBps, requestedAt, caller: address, signal: controller.signal };
    const direction = classifySwapDirection(input, output);
    const loadingQuotes: SwapQuote[] = [
      { id: `direct-loading-${requestedAt}`, route: "direct", state: "loading", queriedAt: requestedAt, inputAmount: amount, routeLabel: "Direct pool" },
    ];
    if (direction !== "erc20-to-erc20") {
      const basketLabel = direction === "erc20-to-otf" ? "Mint basket" : direction === "otf-to-erc20" ? "Burn basket" : "Burn + mint";
      loadingQuotes.push({ id: `basket-loading-${requestedAt}`, route: "basket", state: "loading", queriedAt: requestedAt, inputAmount: amount, routeLabel: basketLabel });
    }
    setQuotes(loadingQuotes);
    setActiveQuote(undefined);
    let cancelled = false;
    const requestQuotes = async () => {
      let outputTotalSupply: bigint | undefined;
      if (output.kind === "otf") {
        const rejectUnconfirmedSupply = () => {
          const reason = "The output OTF supply could not be confirmed, so this quote cannot be used safely.";
          setQuotes(direction === "erc20-to-erc20"
            ? [unavailableQuote("direct", request, reason)]
            : [unavailableQuote("direct", request, reason), unavailableQuote("basket", request, reason)]);
        };
        if (!publicClient) {
          rejectUnconfirmedSupply();
          return;
        }
        try {
          outputTotalSupply = await publicClient.readContract({
            address: output.address,
            abi: managedOtfVaultAbi,
            functionName: "totalSupply",
          });
        } catch {
          if (cancelled) return;
          rejectUnconfirmedSupply();
          return;
        }
      }
      if (cancelled) return;
      const nextQuotes = enforceFirstPurchaseMinimum(
        await requestConcurrentQuotes(quoteService, request),
        output,
        outputTotalSupply,
      );
      if (cancelled) return;
      const receivedAt = Date.now();
      setNow(receivedAt);
      setQuotes(nextQuotes);
      setActiveQuote(bestQueriedQuote(nextQuotes, receivedAt));
    };
    const quoteTimer = window.setTimeout(() => {
      void requestQuotes().catch(() => {
        if (!cancelled) setQuotes([unavailableQuote("direct", request, "Quote request failed.")]);
      });
    }, 400);
    return () => { cancelled = true; controller.abort(); window.clearTimeout(quoteTimer); };
  }, [pageVisible, address, amount, amountValid, canonicalOtfPair, chainId, directionSupported, input, nativeWrapPair, output, pairExecutable, pairValid, publicClient, quoteRequest, quoteService, slippageBps, supportedNetwork]);

  function selectAsset(which: "input" | "output", asset: SwapAsset) {
    if (pinnedAsset && ((which === "input" && sameAsset(input, pinnedAsset)) || (which === "output" && sameAsset(output, pinnedAsset)))) return;
    if ((which === "input" && sameAsset(asset, output)) || (which === "output" && sameAsset(asset, input))) return;
    if (which === "input") setInput(asset);
    else setOutput(asset);
    setPicker(undefined);
  }

  function reverse() {
    setInput(output);
    setOutput(input);
    setActiveQuote(undefined);
    setExecution("idle");
    setExecutionMessage(undefined);
  }

  async function readOutputBalance(blockNumber?: bigint): Promise<bigint | undefined> {
    if (!address || !publicClient) return undefined;
    try {
      if (output.kind === "native") return await publicClient.getBalance({ address, blockNumber });
      return await publicClient.readContract({
        address: output.address,
        abi: ERC20_BALANCE_ABI,
        functionName: "balanceOf",
        args: [address],
        blockNumber,
      });
    } catch {
      return undefined;
    }
  }

  async function finishConfirmedSwap(
    hash: Hex,
    transactionReceipt: TransactionReceipt,
    outputBalanceBefore: bigint | undefined,
    transactionValue: bigint,
    refundSender?: Address,
  ) {
    const outputBalanceAfter = outputBalanceBefore === undefined
      ? undefined
      : await readOutputBalance(transactionReceipt.blockNumber);
    const confirmedOutputAmount = outputBalanceBefore !== undefined && outputBalanceAfter !== undefined
      ? output.kind === "native"
        ? outputBalanceAfter + transactionReceipt.gasUsed * transactionReceipt.effectiveGasPrice + transactionValue > outputBalanceBefore
          ? outputBalanceAfter + transactionReceipt.gasUsed * transactionReceipt.effectiveGasPrice + transactionValue - outputBalanceBefore
          : undefined
        : outputBalanceAfter > outputBalanceBefore
          ? outputBalanceAfter - outputBalanceBefore
          : undefined
      : undefined;
    const nextReceipt = confirmedSwapReceipt({
      status: transactionReceipt.status,
      chainId,
      gasUsed: transactionReceipt.gasUsed,
      effectiveGasPrice: transactionReceipt.effectiveGasPrice,
      hash,
      owner: address!,
      pair: { input, output },
      logs: transactionReceipt.logs,
      knownAssets: [...configuredAssets, ...otfAssets, input, output],
      refundSender,
      confirmedOutputAmount,
      transactionValue,
      transactionTarget: transactionReceipt.to ?? undefined,
    });

    setExecution("success");
    setExecutionMessage(`Swap submitted and confirmed: ${shortAddress(hash)}.`);
    if (!nextReceipt) return;

    setReceiptStageHeight(swapStageRef.current?.offsetHeight);
    setSwapReceipt(nextReceipt);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (claimSwapCelebration(hash, reducedMotion, celebratedSwapsRef.current, window.sessionStorage)) {
      setCelebrationActive(true);
      if (celebrationTimerRef.current !== undefined) window.clearTimeout(celebrationTimerRef.current);
      celebrationTimerRef.current = window.setTimeout(() => setCelebrationActive(false), SWAP_CELEBRATION_DURATION_MS);
    }
  }

  function backToSwap() {
    if (celebrationTimerRef.current !== undefined) window.clearTimeout(celebrationTimerRef.current);
    celebrationTimerRef.current = undefined;
    setCelebrationActive(false);
    setSwapReceipt(undefined);
    setExecutionHash(undefined);
    setReceiptStageHeight(undefined);
    setAmount("");
    setQuotes([]);
    setActiveQuote(undefined);
    setExecution("idle");
    setExecutionMessage(undefined);
    setPicker(undefined);
    setSwapSettingsOpen(false);
  }

  async function executeSwap() {
    if (!address || !publicClient || !walletClient) return;
    let submittedHash: Hex | undefined;
    setExecutionHash(undefined);
    if (nativeWrapPair) {
      if (!configuredWeth || !inputAmountRaw) return;
      const wrapping = input.kind === "native";
      const data = wrapping
        ? encodeFunctionData({ abi: WETH_ABI, functionName: "deposit" })
        : encodeFunctionData({ abi: WETH_ABI, functionName: "withdraw", args: [inputAmountRaw] });
      const value = wrapping ? inputAmountRaw : 0n;
      try {
        setExecutionMessage(undefined);
        setExecution("simulation");
        await publicClient.call({ account: address, to: configuredWeth.address, data, value });
        await publicClient.estimateGas({ account: address, to: configuredWeth.address, data, value });
        setExecution("submission");
        setExecutionMessage("Confirm the swap in your wallet.");
        const hash = await walletClient.sendTransaction({ account: address, to: configuredWeth.address, data, value });
        submittedHash = hash;
        setExecutionHash(hash);
        setExecutionMessage("Swap submitted. Waiting for confirmation…");
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error(`The WETH ${wrapping ? "wrap" : "unwrap"} reverted.`);
        setExecution("success");
        setExecutionMessage(`${wrapping ? "Wrapped ETH to WETH" : "Unwrapped WETH to ETH"}: ${shortAddress(hash)}.`);
        await Promise.all([refetchInputBalance(), refetchOutputBalance()]);
      } catch (error) {
        setExecution("failure");
        setExecutionMessage(swapErrorMessage(error, submittedHash));
      }
      return;
    }
    if (canonicalOtfPair) {
      if (!canonicalQuoteUsable || !canonicalQuote || !canonicalAmountRaw || !launchManager) return;
      const bootstrap = canonicalPhase === 1;
      const universalRouter = protocolDeploymentForChain(chainId)?.v4.universalRouter;
      const permit2 = protocolDeploymentForChain(chainId)?.v4.permit2;
      const target = bootstrap ? launchRouter : universalRouter;
      if (!target || (!bootstrap && input.kind !== "native" && !permit2)) {
        setExecution("failure");
        setExecutionMessage(bootstrap ? "The launch boundary router is not configured." : "The canonical V4 router or Permit2 address is not configured.");
        return;
      }
      try {
        setExecutionMessage(undefined);
        setExecution(input.kind === "native" ? "simulation" : "approval");
        const deadline = BigInt(Math.floor(Date.now() / 1_000) + 10 * 60);
        if (input.kind !== "native") {
          const approvalSpender = bootstrap ? target : permit2!;
          const allowance = await publicClient.readContract({
            address: input.address,
            abi: ERC20_APPROVE_ABI,
            functionName: "allowance",
            args: [address, approvalSpender],
          });
          await ensureExactErc20Approval(allowance, canonicalAmountRaw, async (approvalAmount) => {
            const approvalHash = await walletClient.writeContract({
              account: address,
              address: input.address,
              abi: ERC20_APPROVE_ABI,
              functionName: "approve",
              args: [approvalSpender, approvalAmount],
            });
            const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash });
            if (approvalReceipt.status !== "success") throw new Error(approvalAmount === 0n ? "The swap approval reset reverted." : "The exact swap approval reverted.");
          });
          if (!bootstrap) {
            const [permitted, expiration] = await publicClient.readContract({ address: permit2!, abi: PERMIT2_ALLOWANCE_ABI,
              functionName: "allowance", args: [address, input.address, universalRouter!] });
            if (permitted < canonicalAmountRaw || expiration < Number(deadline)) {
            const permitHash = await walletClient.writeContract({
              account: address,
              address: permit2!,
              abi: PERMIT2_APPROVE_ABI,
              functionName: "approve",
              args: [input.address, universalRouter!, canonicalAmountRaw, Number(deadline)],
            });
            const permitReceipt = await publicClient.waitForTransactionReceipt({ hash: permitHash });
            if (permitReceipt.status !== "success") throw new Error("The Universal Router Permit2 approval reverted.");
            }
          }
        }
        let data: Hex;
        let value = 0n;
        let launchFunction: "buyOtfWithEth" | "buyOtfWithWeth" | "sellOtfForWeth" | "sellOtfForEth" | undefined;
        if (bootstrap) {
          launchFunction = input.isProtocolToken
            ? output.kind === "native" ? "sellOtfForEth" : "sellOtfForWeth"
            : input.kind === "native" ? "buyOtfWithEth" : "buyOtfWithWeth";
          const args = launchFunction === "buyOtfWithEth"
            ? [canonicalQuote.minimumReceived, address, deadline]
            : [canonicalAmountRaw, canonicalQuote.minimumReceived, address, deadline];
          data = encodeFunctionData({ abi: otfLaunchRouterAbi, functionName: launchFunction, args } as never);
          value = launchFunction === "buyOtfWithEth" ? canonicalAmountRaw : 0n;
        } else {
          const canonicalExecution = canonicalV4Execution({
            tokenIn: input.address,
            tokenOut: output.address,
            amountIn: canonicalAmountRaw,
            amountOutMinimum: canonicalQuote.minimumReceived,
            launchManager,
            deadline,
            nativeInput: input.kind === "native",
            nativeOutput: output.kind === "native",
          });
          data = canonicalExecution.data;
          value = canonicalExecution.value;
        }
        setExecution("simulation");
        await publicClient.call({ account: address, to: target, data, value });
        await publicClient.estimateGas({ account: address, to: target, data, value });
        setExecution("submission");
        setExecutionMessage("Confirm the swap in your wallet.");
        const outputBalanceBefore = await readOutputBalance();
        const hash = await walletClient.sendTransaction({ account: address, to: target, data, value });
        submittedHash = hash;
        setExecutionHash(hash);
        setExecutionMessage("Swap submitted. Waiting for confirmation…");
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("The canonical OTF swap reverted.");
        await finishConfirmedSwap(hash, receipt, outputBalanceBefore, value);
        await Promise.all([refetchInputBalance(), refetchOutputBalance(), refetchCanonicalPool()]);
      } catch (error) {
        setExecution("failure");
        setExecutionMessage(swapErrorMessage(error, submittedHash));
      }
      return;
    }
    if (!executionPlan || !executionConfigured) return;
    if (activeQuote?.caller?.toLowerCase() !== address.toLowerCase()) {
      setExecution("failure");
      setExecutionMessage("Refresh the quote after changing the connected wallet.");
      return;
    }
    try {
      setExecutionMessage(undefined);
      setExecution(
        (executionPlan.kind === "direct-api" || executionPlan.kind === "direct-registered")
          ? executionPlan.nativeInput ? "simulation" : "approval"
          : executionPlan.kind === "basket-router" && !executionPlan.approval
            ? "simulation"
            : "approval",
      );
      let target: Address;
      let data: Hex;
      let value = 0n;
      if ((executionPlan.kind === "direct-api" || executionPlan.kind === "direct-registered")) {
        if (protocolDeploymentForChain(chainId)?.v4.universalRouter?.toLowerCase() !== executionPlan.universalRouter.toLowerCase()) throw new Error("The direct plan has an unsupported Universal Router target.");
        if (!executionPlan.nativeInput) {
          const permit2 = protocolDeploymentForChain(chainId)?.v4.permit2;
          if (!permit2) throw new Error("The direct plan has no configured Permit2 target.");
          const allowance = await publicClient.readContract({
            address: executionPlan.inputToken,
            abi: ERC20_APPROVE_ABI,
            functionName: "allowance",
            args: [address, permit2],
          });
          await ensureExactErc20Approval(allowance, executionPlan.amountIn, async (approvalAmount) => {
            const approvalHash = await walletClient.writeContract({
              account: address,
              address: executionPlan.inputToken,
              abi: ERC20_APPROVE_ABI,
              functionName: "approve",
              args: [permit2, approvalAmount],
            });
            const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash });
            if (approvalReceipt.status !== "success") throw new Error("The required Permit2 token authorization reverted.");
          });
          if (executionPlan.kind === "direct-registered") {
            const [permitted,expiration]=await publicClient.readContract({address:permit2,abi:PERMIT2_ALLOWANCE_ABI,functionName:"allowance",args:[address,executionPlan.inputToken,executionPlan.universalRouter]});
            const deadline=Math.floor(executionPlan.expiresAt/1000);
            if(permitted<executionPlan.amountIn || expiration<deadline) {
              const permitHash = await walletClient.writeContract({ account: address, address: permit2, abi: PERMIT2_APPROVE_ABI,
                functionName: "approve", args: [executionPlan.inputToken,executionPlan.universalRouter,executionPlan.amountIn,deadline] });
              if ((await publicClient.waitForTransactionReceipt({hash:permitHash})).status !== "success") throw new Error("The exact router authorization reverted.");
            }
          }
        }
        const signature = executionPlan.permitData
          ? await walletClient.signTypedData({
            account: address,
            domain: executionPlan.permitData.domain,
            types: executionPlan.permitData.types,
            primaryType: executionPlan.permitData.primaryType,
            message: executionPlan.permitData.message,
          } as never)
          : undefined;
        const finalized = executionPlan.kind === "direct-registered" ? executionPlan : await quoteService.finalizeDirect(executionPlan, signature);
        if (!finalized.transaction) throw new Error("Uniswap did not return a final transaction.");
        target = finalized.transaction.to;
        data = finalized.transaction.data;
        value = finalized.transaction.value;
        setExecution("simulation");
        await publicClient.call({ account: address, to: target, data, value });
        await publicClient.estimateGas({ account: address, to: target, data, value });
      } else {
        const basketDeployment = chainId === robinhoodChain.id ? robinhoodMainnetBasketDeployment : chainId === robinhoodChainTestnet.id ? protocolDeploymentForChain(chainId)?.addresses : undefined;
        if (basketDeployment?.entryRouter?.toLowerCase() !== executionPlan.router.toLowerCase()
          || basketDeployment?.uniswapUniversalRouterAdapter?.toLowerCase() !== executionPlan.adapter.toLowerCase()) throw new Error("The basket plan has an unsupported router or adapter target.");
        if (executionPlan.approval) {
          const allowance = await publicClient.readContract({
            address: executionPlan.approval.token,
            abi: ERC20_APPROVE_ABI,
            functionName: "allowance",
            args: [address, executionPlan.approval.spender],
          });
          await ensureExactErc20Approval(allowance, executionPlan.approval.amount, async (approvalAmount) => {
            const approvalHash = await walletClient.writeContract({
              account: address,
              address: executionPlan.approval!.token,
              abi: ERC20_APPROVE_ABI,
              functionName: "approve",
              args: [executionPlan.approval!.spender, approvalAmount],
            });
            const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash });
            if (approvalReceipt.status !== "success") throw new Error(approvalAmount === 0n ? "The token approval reset reverted." : "The exact token approval reverted.");
          });
        }
        target = executionPlan.router;
        data = encodeFunctionData({
          abi: otfEntryExitRouterAbi,
          functionName: executionPlan.call.method,
          args: routerArgsForExecution(executionPlan.call) as never,
        });
        setExecution("simulation");
        value = executionPlan.nativeValue;
        const result = await publicClient.call({ account: address, to: target, data, value });
        await publicClient.estimateGas({ account: address, to: target, data, value });
        if (!result.data) throw new Error("The basket preflight returned no result data.");
        decodeFunctionResult({
          abi: otfEntryExitRouterAbi,
          functionName: executionPlan.call.method,
          data: result.data,
        } as never);
      }
      setExecution("submission");
      setExecutionMessage("Confirm the swap in your wallet.");
      const outputBalanceBefore = await readOutputBalance();
      const hash = await walletClient.sendTransaction({ account: address, to: target, data, value });
      submittedHash = hash;
      setExecutionHash(hash);
      setExecutionMessage("Swap submitted. Waiting for confirmation…");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The swap transaction reverted.");
      await finishConfirmedSwap(
        hash,
        receipt,
        outputBalanceBefore,
        value,
        executionPlan.kind === "basket-router" ? executionPlan.router : undefined,
      );
      await Promise.all([refetchInputBalance(), refetchOutputBalance()]);
    } catch (error) {
      setExecution("failure");
      setExecutionMessage(swapErrorMessage(error, submittedHash));
    }
  }

  const executionBusy = execution === "approval" || execution === "simulation" || execution === "submission";
  useEffect(() => {
    if (!pageVisible || executionBusy || swapReceipt || !quotes.length || quotes.some((quote) => quote.state === "loading")) return;
    const delay = quoteRefreshDelay(quoteStartedAt, Date.now());
    if (delay === undefined) return;
    const timer = window.setTimeout(() => setQuoteRequest((current) => current + 1), delay);
    return () => window.clearTimeout(timer);
  }, [pageVisible, quotes, quoteStartedAt, executionBusy, swapReceipt]);
  const canonicalExecutionConfigured = Boolean(
    launchManager && (canonicalPhase === 1
      ? launchRouter
      : canonicalPhase === 3 && protocolDeploymentForChain(chainId)?.v4.universalRouter && (input.kind === "native" || protocolDeploymentForChain(chainId)?.v4.permit2)),
  );
  const canExecute = Boolean(address && publicClient && walletClient && pairExecutable && !insufficientBalance && !executionBusy && (
    nativeWrapPair
      ? amountValid && configuredWeth
      : canonicalOtfPair
      ? canonicalQuoteUsable && canonicalExecutionConfigured
      : executionPlan && executionConfigured
  ));
  const quoteLoading = !nativeWrapPair && (canonicalOtfPair
    ? !usableQuote && canonicalPoolFetching
    : !quotes.length || quotes.some((quote) => quote.state === "loading"));
  const primaryLabel = missingOtfAsset
    ? "Only for OTF assets"
    : !address
      ? "Connect wallet"
      : !supportedNetwork
        ? "Switch network"
        : insufficientBalance
          ? `Insufficient ${input.symbol}`
        : !amountValid
          ? "Enter a valid amount"
          : !pairValid
            ? sameAssetSelected ? "Choose different tokens" : "Select assets"
            : !pairExecutable
              ? "Resolve token metadata"
              : !directionSupported
                ? hasOtfSide ? "Unsupported OTF pair" : "Only for OTF assets"
                : !quoteNetworkConfigured
                  ? "Testnet routing unavailable"
                  : quoteLoading
                    ? "Finding quote…"
                  : !usableQuote
                    ? canonicalOtfPair ? "Canonical quote unavailable" : "Quotes unavailable"
                    : execution === "approval"
                      ? "Approving exact input"
                      : execution === "simulation"
                        ? "Simulating swap"
                        : execution === "submission"
                          ? "Submitting swap"
                          : nativeWrapPair
                            ? input.kind === "native" ? "Wrap ETH" : "Unwrap WETH"
                            : "Swap";
  const statusMessage = executionMessage
    ?? (!supportedNetwork
      ? "Switch to Robinhood Chain to continue."
      : insufficientBalance
        ? input.kind === "native" ? "Insufficient ETH for the swap value and reserved network gas." : `Insufficient ${input.symbol} balance.`
      : missingOtfAsset
        ? "Choose a fund share or the OTF token on either side."
        : !quoteNetworkConfigured
          ? "The configured testnet router and approved adapter could not be loaded."
          : amount && !amountValid
            ? "Enter a positive amount within the selected token's decimal precision."
            : !pairValid
              ? sameAssetSelected ? "Choose two different assets." : undefined
              : !pairExecutable
                ? "Resolve token decimals and OTF factory identity to request a quote."
                : !directionSupported
                  ? !hasOtfSide
                    ? "Choose a fund share or the OTF token on either side."
                    : chainId === robinhoodChainTestnet.id
                      ? "Choose a fund or $OTF and a token with an available route."
                      : "This OTF pair is unsupported."
                  : quoteLoading
                    ? undefined
                    : canonicalOtfPair && amountValid && !usableQuote
                      ? canonicalPhase === 2
                        ? "The canonical OTF pool is waiting for graduation finalization."
                        : "The canonical OTF pool could not quote this amount."
                    : undefined);

  function handlePrimaryAction() {
    if (!address) {
      openConnectModal?.();
      return;
    }
    if (!supportedNetwork) {
      switchChain({ chainId: robinhoodChainTestnet.id });
      return;
    }
    void executeSwap();
  }

  function assetControl(which: "input" | "output", asset: SwapAsset) {
    const lockedFund = Boolean(pinnedAsset && sameAsset(asset, pinnedAsset));
    if (lockedFund) {
      return <div className="swapAssetButton locked" aria-label={`${asset.symbol} fund token`}><AssetMark asset={asset} /><strong>{asset.symbol}</strong></div>;
    }
    return <button type="button" className="swapAssetButton" aria-label={`Select token to ${which === "input" ? "pay" : "receive"}`} onClick={() => setPicker(which)}><AssetMark asset={asset} /><strong className={isUnselectedOtf(asset) ? "swapAssetPlaceholder" : undefined}>{isUnselectedOtf(asset) ? otfDirectoryState === "loading" ? <ActivitySpinner size={16} /> : "—" : asset.symbol}</strong><ChevronDown size={15} /></button>;
  }

  function cappedSwapAmount(value: string, asset: SwapAsset) {
    return decimalInputValue(value, Math.min(asset.decimals, MAX_SWAP_FRACTION_DIGITS)) ?? "0";
  }

  const swapCard = (
        <section className={`swapCard${swapReceipt ? " showReceipt" : ""}`} aria-label={embeddedFund ? `Swap ${embeddedFund.symbol}` : "Swap tokens"}>
          <div className="swapCardStage" ref={swapStageRef} style={receiptStageHeight ? { minHeight: receiptStageHeight } : undefined}>
            <div className="swapCardPane swapFormPane" aria-hidden={swapReceipt ? true : undefined} inert={swapReceipt ? true : undefined}>
              <div className="swapCardHeader">
                <div className="swapCardTitle"><strong>Swap</strong><span className="swapRoutingBadge">{routingLabel}</span></div>
                <div className="swapSettingsControl" ref={swapSettingsRef}>
                  <button type="button" className={`swapIconButton ${swapSettingsOpen ? "active" : ""}`} title="Swap settings" aria-label="Open swap settings" aria-haspopup="dialog" aria-expanded={swapSettingsOpen} onClick={() => setSwapSettingsOpen((open) => !open)}><SlidersHorizontal size={16} /></button>
                  {swapSettingsOpen ? (
                    <div className="swapSettingsPopover" role="dialog" aria-label="Swap settings">
                      <label><span>Maximum slippage</span><div className="selectControl swapSlippageSelect"><select value={slippageBps} onChange={(event) => setSlippageBps(Number(event.target.value))} aria-label="Maximum slippage"><option value={50}>0.5%</option><option value={100}>1.0%</option><option value={300}>3.0%</option></select><ChevronDown size={14} aria-hidden="true" /></div></label>
                      <small>The quote&apos;s minimum received amount reflects this tolerance.</small>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="swapPair">
                <div className="swapAmountBox">
                  <div className="swapAmountTop"><span>You pay</span></div>
                  <div className="swapAmountEntry"><input ref={amountInputRef} inputMode="decimal" value={amount} onChange={(event) => { const next = decimalInputValue(event.target.value, Math.min(input.decimals, MAX_SWAP_FRACTION_DIGITS)); if (next !== undefined) setAmount(next); }} placeholder="0" aria-label={`Amount of ${input.symbol} to pay`} /><div className="swapAssetColumn">{assetControl("input", input)}<span className="swapBalanceSlot"><SwapBalance active={inputBalanceEnabled} loading={inputBalanceLoading} balance={inputBalance} symbol={input.symbol} onUse={() => inputBalance && setAmount(cappedSwapAmount(input.kind === "native" ? formatUnits(nativeMaxAmount(inputBalance.value, 1n, nativeGasReserve), input.decimals) : inputBalance.formatted, input))} /></span></div></div>
                </div>
                <button type="button" className="swapReverse" onClick={reverse} aria-label="Reverse swap direction"><ArrowDown size={20} /></button>
                <div className="swapAmountBox receive">
                  <div className="swapAmountTop"><span>You receive</span></div>
                  <div className="swapAmountEntry"><output aria-label={`Expected ${output.symbol} output`}>{cappedSwapAmount(usableQuote ? nativeWrapPair ? amount : canonicalOtfPair && canonicalQuote ? formatUnits(canonicalQuote.amountOut, output.decimals) : activeQuote?.outputAmount ?? "0" : "0", output)}</output><div className="swapAssetColumn">{assetControl("output", output)}<span className="swapBalanceSlot">{outputOtfLoading ? <ActivitySpinner size={12} /> : !outputSelected ? "—" : <SwapBalance active={outputBalanceEnabled} loading={outputBalanceLoading} balance={outputBalance} symbol={output.symbol} />}</span></div></div>
                </div>
              </div>
              <button type="button" className="swapPrimary" aria-busy={executionBusy || primaryLabel === "Finding quote…"} disabled={missingOtfAsset || (address && supportedNetwork ? !canExecute : false)} onClick={handlePrimaryAction}>{executionBusy || primaryLabel === "Finding quote…" ? <ActivitySpinner size={14} /> : null}{primaryLabel}</button>
              {canonicalPhase === 1 && canonicalQuote && !canonicalQuote.fullyFilled ? <p className="swapPreflight">This amount crosses a launch price limit. Only the input needed to reach that limit will be used; unused {input.symbol} {input.kind === "native" ? "is refunded" : "stays in your wallet"}.</p> : null}
              {statusMessage ? <p className={`swapStatusLine ${execution === "failure" ? "failure" : execution === "success" ? "success" : ""}`} aria-live="polite">{statusMessage}{executionMessage && executionHash ? <a href={`${(chainId === robinhoodChainTestnet.id ? robinhoodChainTestnet : robinhoodChain).blockExplorers.default.url}/tx/${executionHash}`} target="_blank" rel="noreferrer">View transaction<ExternalLink size={11} /></a> : null}</p> : null}
              {quotes.some(quote => quote.state === "unavailable" && quote.reason) ? <div className="quoteFailureNotice" role="status">{quotes.filter(quote => quote.state === "unavailable" && quote.reason).map(quote => <p key={quote.id}>{quote.routeLabel}: {quote.reason}{quote.requestId ? <small> Reference: {quote.requestId}</small> : null}</p>)}{quotes.some(quote => ["PROVIDER_UNAVAILABLE", "PROVIDER_RATE_LIMITED", "QUOTE_TIMEOUT", "QUOTE_EXPIRED"].includes(quote.failureCode ?? "")) ? <button type="button" className="secondaryAction" disabled={executionBusy} onClick={() => setQuoteRequest(current => current + 1)}>Refresh quote</button> : null}</div> : null}
              {quotes.length ? <QuoteReview quotes={quotes} activeQuote={activeQuote} onChoose={(quote) => { setActiveQuote(quote); setExecution("idle"); setExecutionMessage(undefined); }} onRefresh={() => setQuoteRequest((current) => current + 1)} outputSymbol={output.symbol} now={now} quoteStartedAt={quoteStartedAt} executionBusy={executionBusy} /> : null}
            </div>
            {swapReceipt ? <div className="swapCardPane swapReceiptPane"><SwapReceiptPanel receipt={swapReceipt} onBack={backToSwap} celebrating={celebrationActive} showFundLink={!embedded} /></div> : null}
          </div>
        </section>
  );
  const pickerAsset = picker === "input" ? input : output;
  const pickerCounterpart = picker === "input" ? output : input;
  const pickerDialog = picker && !(pinnedAsset && sameAsset(pickerAsset, pinnedAsset)) ? <TokenPicker title={picker === "input" ? "Select token to pay" : "Select token to receive"} onClose={() => setPicker(undefined)} onSelect={(asset) => selectAsset(picker, asset)} selected={pickerAsset} exclude={pickerCounterpart} routeFund={routeFund} configuredAssets={configuredAssets} otfAssets={otfAssets} otfDirectoryState={otfDirectoryState} fixedKind={embedded ? "erc20" : undefined} /> : null;

  if (embedded) return <div className="fundSwapWidget">{swapCard}{pickerDialog}</div>;

  return (
    <>
      <main className="swapMain">{swapCard}</main>
      <div className="swapFooterFrame"><OperateFooter /></div>
      {pickerDialog}
    </>
  );
}

function DashboardPage({ children, className }: { children: React.ReactNode; className?: string }) {
  return <main className={`dashboardMain${className ? ` ${className}` : ""}`}>{children}<OperateFooter /></main>;
}

function LiquiditySurface() {
  return (
    <DashboardPage className="liquidityPage">
      <TestnetLiquiditySurface />
    </DashboardPage>
  );
}

function LaunchSurface() {
  return (
    <DashboardPage className="createPage">
      <div className="appView">
        <AppPageHeader title="Launch OTF" description="Choose the identity, thesis, assets, weights, and creator fee for your new onchain fund." icon={<FilePlus2 size={18} />} />
        <CreateOTFForm />
      </div>
    </DashboardPage>
  );
}

function CreatedFundSurface() {
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId });
  const address = addressFromLocation();
  const transactionHash = transactionHashFromLocation();
  const [confirmation, setConfirmation] = useState<"checking" | "confirmed" | "failure">("checking");
  const [details, setDetails] = useState<FactoryVaultSummary>();
  const [creationMetadata, setCreationMetadata] = useState<OtfCreationMetadata | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCreationMetadata(address ? loadCreationMetadata(window.localStorage, chainId, address) ?? null : null);
  }, [address, chainId]);

  useEffect(() => {
    let cancelled = false;
    if (!address || !transactionHash || !protocolDeploymentForChain(chainId)?.creationReady || !publicClient) {
      setConfirmation("failure");
      return;
    }
    void publicClient.getTransactionReceipt({ hash: transactionHash }).then(async (receipt) => {
      const createdEvent = receipt.status === "success"
        ? parseEventLogs({ abi: otfFactoryAbi, eventName: "VaultCreated", logs: receipt.logs, strict: true })
          .find((event) => event.args.vault.toLowerCase() === address.toLowerCase())
        : undefined;
      if (cancelled) return;
      if (!createdEvent) {
        setConfirmation("failure");
        return;
      }
      setConfirmation("confirmed");
      try {
        const nextDetails = await readVaultSummary(publicClient, address);
        if (!cancelled) setDetails(nextDetails);
      } catch {
        // The confirmed address and transaction remain authoritative if detail reads are temporarily unavailable.
      }
    }).catch(() => {
      if (!cancelled) setConfirmation("failure");
    });
    return () => { cancelled = true; };
  }, [address, chainId, publicClient, transactionHash]);

  async function copyAddress() {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_600);
  }

  const destination = address ? `/funds/${address}` : "/funds";
  const revealBurst = [
    [-184, -92, -22], [-130, -144, 18], [-52, -164, -14], [45, -170, 26],
    [126, -142, -20], [184, -82, 16], [205, -4, -28], [166, 84, 24],
    [102, 142, -18], [24, 166, 28], [-62, 156, -26], [-142, 122, 20],
    [-205, 46, -16], [-216, -30, 24], [0, -198, -20], [0, 194, 18],
  ];

  if (confirmation === "checking") {
    return (
      <DashboardPage className="fundsPage">
        <div className="appView">
          <section className="createdConfirmation createdRevealChecking" aria-labelledby="created-otf-title" aria-busy="true">
            <div className="createdRevealMachine" aria-hidden="true">
              <span className="createdRevealOrbit createdRevealOrbitOuter" />
              <span className="createdRevealOrbit createdRevealOrbitInner" />
              <OtfTokenIcon className="createdRevealMark" size={64} ticker="OTF" />
            </div>
            <div className="createdRevealCheckingCopy">
              <h2 id="created-otf-title">Verifying your launch</h2>
              <p>Matching the confirmed transaction to its new onchain vault.</p>
              <span role="status" aria-live="polite"><LoaderCircle className="createAssetSpinner" size={14} />Reading the launch receipt</span>
            </div>
          </section>
        </div>
      </DashboardPage>
    );
  }

  if (confirmation === "failure") {
    return (
      <DashboardPage className="fundsPage">
        <div className="appView">
          <section className="createdConfirmation createdRevealFailure" aria-labelledby="created-otf-title">
            <div className="createdStatus">
              <span className="createdStatusIcon failure"><X size={22} /></span>
              <div>
                <h2 id="created-otf-title">Unable to verify launch</h2>
                <p>Inspect the transaction before trying again. The interface will not invent a successful launch when the factory event is unavailable.</p>
              </div>
            </div>
            {transactionHash ? <a className="createdTransactionLink" href={`${(chainId === robinhoodChainTestnet.id ? robinhoodChainTestnet : robinhoodChain).blockExplorers.default.url}/tx/${transactionHash}`} target="_blank" rel="noreferrer"><ReceiptText size={15} /><span>View launch transaction</span><code>{shortAddress(transactionHash)}</code><ExternalLink size={14} /></a> : null}
            <div className="createdActions"><Link className="secondaryAction" href="/launch"><ArrowLeft size={14} />Back to launch</Link></div>
          </section>
        </div>
      </DashboardPage>
    );
  }

  return (
    <DashboardPage className="fundsPage">
      <div className="appView">
        <section className="createdConfirmation createdRevealConfirmed" aria-labelledby="created-otf-title">
          <div className="createdRevealBurst" aria-hidden="true">
            {revealBurst.map(([x, y, rotation], index) => <span key={`${x}-${y}`} style={{ "--burst-x": `${x}px`, "--burst-y": `${y}px`, "--burst-rotation": `${rotation}deg`, "--burst-delay": `${index * 18}ms` } as CSSProperties} />)}
          </div>
          <div className="createdJackpotHeader">
            <span className="createdJackpotLights" aria-hidden="true" />
            <div className="createdRevealSeal" aria-hidden="true">
              <span />
              <OtfTokenIcon className="createdRevealMark" size={72} ticker={details?.symbol ?? "OTF"} />
            </div>
            <div className="createdJackpotCopy">
              <h2 id="created-otf-title">{details?.name ?? "Your OTF is live"}</h2>
              <p><strong>{details?.symbol ? `$${details.symbol}` : "OTF"}</strong> has landed onchain. Here is the allocation you launched.</p>
              <span className="createdLiveBadge"><Check size={13} />Launch confirmed</span>
            </div>
          </div>
          <div className="createdRevealBody">
            <div className="createdRevealHeading">
              <div>
                <h3>Constituent allocation</h3>
                <p>{creationMetadata ? weightingMethodLabel(creationMetadata.weightingMethod) : "Allocation metadata is unavailable in this browser."}</p>
              </div>
              <strong>{details?.assetCount ?? creationMetadata?.constituents.length ?? "—"}<span>assets</span></strong>
            </div>
            {creationMetadata ? (
              <div className="createdAllocationReveal" role="list" aria-label="Created OTF allocation">
                {creationMetadata.constituents.map((asset, index) => {
                  const allocation = Math.max(0, Math.min(100, Number(BigInt(asset.finalPercentageUnits)) / 1e18));
                  return (
                    <div className="createdAllocationRow" key={asset.address} role="listitem" style={{ "--allocation": `${allocation}%`, "--reveal-index": Math.min(index, 8) } as CSSProperties}>
                      <div className="rwaAssetIdentity"><AssetLogo symbol={asset.symbol} /><div><strong>{asset.symbol}</strong><small>{asset.name}</small></div></div>
                      <div className="createdAllocationTrack" aria-hidden="true"><span /></div>
                      <strong className="createdAllocationValue">{formatStoredPercentage(asset.finalPercentageUnits)}</strong>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="creationMetadataUnavailable" role="status"><History size={17} /><div><strong>Weighting method unavailable</strong><span>The launch is confirmed, but this browser does not have the offchain allocation snapshot.</span></div></div>
            )}
            {details?.fundThesis ? <blockquote className="createdThesis"><span>Fund thesis</span><p>{details.fundThesis}</p></blockquote> : null}
            <dl className="createdRevealFacts">
              <div><dt>Creator</dt><dd>{details ? shortAddress(details.creator) : "—"}</dd></div>
              <div><dt>Annual expense</dt><dd>{details ? formatAnnualExpenseRatioPercentage(details.annualCreatorExpenseRatioBps) : "—"}</dd></div>
              <div><dt>Mint fee</dt><dd>{details ? formatAnnualExpenseRatioPercentage(details.mintFeeBps) : "—"}</dd></div>
              <div><dt>Redeem fee</dt><dd>{details ? formatAnnualExpenseRatioPercentage(details.redeemFeeBps) : "—"}</dd></div>
            </dl>
          </div>
          {address ? (
            <div className="createdAddressBlock">
              <div><span>OTF contract address</span><code>{address}</code></div>
              <div className="createdAddressActions">
                <button className="iconOnly" type="button" onClick={() => void copyAddress()} title="Copy OTF address" aria-label="Copy OTF address">{copied ? <Check size={15} /> : <Copy size={15} />}</button>
                <a className="iconOnly" href={`${(chainId === robinhoodChainTestnet.id ? robinhoodChainTestnet : robinhoodChain).blockExplorers.default.url}/address/${address}`} target="_blank" rel="noreferrer" title="Open OTF in explorer" aria-label="Open OTF in explorer"><ExternalLink size={15} /></a>
              </div>
            </div>
          ) : null}
          {copied ? <span className="createdCopyFeedback" role="status" aria-live="polite">Address copied</span> : null}
          {transactionHash ? <a className="createdTransactionLink" href={`${(chainId === robinhoodChainTestnet.id ? robinhoodChainTestnet : robinhoodChain).blockExplorers.default.url}/tx/${transactionHash}`} target="_blank" rel="noreferrer"><ReceiptText size={15} /><span>View launch transaction</span><code>{shortAddress(transactionHash)}</code><ExternalLink size={14} /></a> : null}
          <div className="createdActions">
            <Link className="secondaryAction" href="/launch"><FilePlus2 size={14} />Launch another</Link>
            {confirmation === "confirmed" ? <Link className="primaryAction" href={destination}><ArrowRight size={14} />View OTF</Link> : null}
          </div>
        </section>
      </div>
    </DashboardPage>
  );
}

function FundRouteSurface() {
  const pathname = usePathname();
  return pathname.endsWith("/created") ? <CreatedFundSurface /> : <FundsSurface detail />;
}

type FeeClaimTransactionState = "idle" | "wallet" | "pending" | "success" | "rejected" | "failure";

function FeeClaimPanel({ vault, beneficiary, explorer }: { vault: Address; beneficiary: Address; explorer: string }) {
  const chainId = useChainId();
  const pageVisible = usePageVisible();
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId });
  const { data: walletClient } = useWalletClient({ chainId });
  const collector = protocolDeploymentForChain(chainId)?.addresses.buybackCollector;
  const canonicalWeth = protocolDeploymentForChain(chainId)?.addresses.weth;
  const launchManager = protocolDeploymentForChain(chainId)?.addresses.launchManager;
  const settlementAdapter = protocolDeploymentForChain(chainId)?.addresses.uniswapUniversalRouterAdapter;
  const configured = Boolean(protocolDeploymentForChain(chainId)?.routingReady
    && collector && canonicalWeth && launchManager && settlementAdapter);
  const [slippageBps, setSlippageBps] = useState(50);
  const [routePreference, setRoutePreference] = useState<FeeSettlementRoutePreference>("best");
  const [quoteState, setQuoteState] = useState<"idle" | "loading" | "ready" | "missing">("idle");
  const [settlementRoutes, setSettlementRoutes] = useState<FeeSettlementRoutes>({});
  const [claimState, setClaimState] = useState<FeeClaimTransactionState>("idle");
  const [claimHash, setClaimHash] = useState<Hex>();
  const collectorAddress = collector ?? zeroAddress;
  const feeReads = useReadContracts({
    contracts: [
      { address: collectorAddress, abi: buybackCollectorAbi, functionName: "feeAccounts", args: [vault] },
      { address: vault, abi: managedOtfVaultAbi, functionName: "previewExpenseFees" },
    ],
    query: { enabled: configured, refetchOnWindowFocus: false, refetchOnReconnect: false },
  });
  const feeAccountsRead = feeReads.data?.[0];
  const previewExpenseFeesRead = feeReads.data?.[1];
  const readState = feeClaimReadState({
    isPending: feeReads.isPending,
    isError: feeReads.isError,
    feeAccountsStatus: feeAccountsRead?.status,
    previewExpenseFeesStatus: previewExpenseFeesRead?.status,
    connectedAccount: address,
    beneficiary,
  });
  const recorded = feeAccountsRead?.status === "success" ? feeAccountsRead.result : undefined;
  const annual = previewExpenseFeesRead?.status === "success"
    ? previewExpenseFeesRead.result
    : undefined;
  const accountMatches = readState === "verified";
  const pending = useMemo(() => recorded && annual
    ? pendingFeeShares(recorded[0], recorded[1], annual[1], annual[2])
    : undefined, [annual, recorded]);
  const quoteService = useMemo(() => quoteServiceForChain(chainId), [chainId]);

  useEffect(() => {
    setClaimState("idle");
    setClaimHash(undefined);
  }, [pending?.total, routePreference, slippageBps]);

  useEffect(() => {
    if (!pageVisible) return;
    const controller = new AbortController();
    let cancelled = false;
    if (
      !configured || !accountMatches || !collector || !canonicalWeth || !settlementAdapter
      || !pending
    ) {
      setQuoteState(configured ? "idle" : "missing");
      setSettlementRoutes({});
      return;
    }
    if (pending.total === 0n) {
      setQuoteState("idle");
      setSettlementRoutes({});
      return;
    }
    setQuoteState("loading");
    setSettlementRoutes({});
    const requestedAt = Date.now();
    const input: SwapAsset = {
      address: vault,
      symbol: "OTF",
      name: "Pending fund fee shares",
      kind: "otf",
      decimals: 18,
      metadataResolved: true,
      isFactoryVault: true,
    };
    const output: SwapAsset = {
      address: canonicalWeth,
      symbol: "WETH",
      name: "Wrapped Ether",
      kind: "erc20",
      decimals: 18,
      metadataResolved: true,
      verified: false,
    };
    const request = {
      chainId,
      input,
      output,
      inputAmount: formatUnits(pending.total, 18),
      slippageBps,
      requestedAt,
      caller: collector,
      signal: controller.signal,
    } as const;
    void Promise.allSettled([
      quoteService.quoteBasket(request),
      quoteService.quoteDirect(request),
    ]).then(([redemptionResult, shareSaleResult]) => {
      if (cancelled) return;
      const now = Date.now();
      const redemptionQuote = redemptionResult.status === "fulfilled" ? redemptionResult.value : undefined;
      const shareSaleQuote = shareSaleResult.status === "fulfilled" ? shareSaleResult.value : undefined;
      const redemption = redemptionQuote && quoteIsFresh(redemptionQuote, now)
        ? redemptionFeeSettlementRouteFromQuote(redemptionQuote, vault, canonicalWeth, collector)
        : undefined;
      const settlementUniversalRouter = protocolDeploymentForChain(chainId)?.v4.universalRouter;
      const shareSale = settlementUniversalRouter && shareSaleQuote && quoteIsFresh(shareSaleQuote, now)
        ? shareSaleFeeSettlementRouteFromQuote(
            shareSaleQuote,
            vault,
            canonicalWeth,
            collector,
            settlementAdapter,
            settlementUniversalRouter,
          )
        : undefined;
      const routes: FeeSettlementRoutes = {
        redemption: redemption?.shares === pending.total ? redemption : undefined,
        shareSale: shareSale?.shares === pending.total ? shareSale : undefined,
      };
      setSettlementRoutes(routes);
      setQuoteState(routes.redemption || routes.shareSale ? "ready" : "missing");
    }).catch(() => {
      if (!cancelled) {
        setSettlementRoutes({});
        setQuoteState("missing");
      }
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [pageVisible, accountMatches, canonicalWeth, chainId, collector, configured, pending, quoteService, settlementAdapter, slippageBps, vault]);

  const settlementRoute = useMemo(
    () => selectFeeSettlementRoute(settlementRoutes, routePreference),
    [routePreference, settlementRoutes],
  );

  const launchAddress = launchManager ?? zeroAddress;
  const canonicalReads = useReadContracts({
    contracts: [
      { address: launchAddress, abi: otfLaunchManagerAbi, functionName: "phase" },
      { address: launchAddress, abi: otfLaunchManagerAbi, functionName: "currentPoolState" },
      { address: launchAddress, abi: otfLaunchManagerAbi, functionName: "currentOtfPriceWethWad" },
      { address: launchAddress, abi: otfLaunchManagerAbi, functionName: "initialSqrtPriceX96" },
      { address: launchAddress, abi: otfLaunchManagerAbi, functionName: "finalSqrtPriceX96" },
      { address: launchAddress, abi: otfLaunchManagerAbi, functionName: "otfIsCurrency0" },
      { address: launchAddress, abi: otfLaunchManagerAbi, functionName: "bootstrapLiquidity" },
      { address: launchAddress, abi: otfLaunchManagerAbi, functionName: "permanentLiquidity" },
      { address: launchAddress, abi: otfLaunchManagerAbi, functionName: "bootstrapSqrtPriceBounds" },
    ],
    query: { enabled: configured && Boolean(settlementRoute), refetchOnWindowFocus: false, refetchOnReconnect: false },
  });
  const minimumBuybackWeth = settlementRoute && pending
    ? proportionalWethSplit(settlementRoute.minWethOut, pending.creator, pending.buyback).buybackWeth
    : 0n;
  const minOtfOut = useMemo(() => {
    const phase = Number(canonicalReads.data?.[0]?.result ?? 0);
    const poolState = canonicalReads.data?.[1]?.result;
    const otfPriceWethWad = canonicalReads.data?.[2]?.result;
    const finalSqrtPriceX96 = canonicalReads.data?.[4]?.result;
    const otfIsCurrency0 = canonicalReads.data?.[5]?.result;
    const bootstrapLiquidity = canonicalReads.data?.[6]?.result;
    const permanentLiquidity = canonicalReads.data?.[7]?.result;
    const bootstrapBounds = canonicalReads.data?.[8]?.result;
    const liquidity = phase === 3 ? permanentLiquidity : bootstrapLiquidity;
    if (
      minimumBuybackWeth === 0n || !poolState || otfPriceWethWad === undefined
      || finalSqrtPriceX96 === undefined
      || otfIsCurrency0 === undefined || !liquidity || (phase !== 1 && phase !== 3)
    ) return undefined;
    if (phase !== 3 && !bootstrapBounds) return undefined;
    try {
      const quote = quoteCanonicalOtfSwap({
        side: "buy",
        amountIn: minimumBuybackWeth,
        slippageBps,
        sqrtPriceX96: poolState[0],
        liquidity,
        lowerSqrtPriceX96: phase === 3 ? FULL_RANGE_LOWER_SQRT : bootstrapBounds![0],
        upperSqrtPriceX96: phase === 3 ? FULL_RANGE_UPPER_SQRT : bootstrapBounds![1],
        otfIsCurrency0,
        otfPriceWethWad,
      });
      return quote.fullyFilled && quote.minimumReceived > 0n ? quote.minimumReceived : undefined;
    } catch {
      return undefined;
    }
  }, [canonicalReads.data, minimumBuybackWeth, slippageBps]);
  const expectedCreatorWeth = settlementRoute && pending
    ? proportionalWethSplit(settlementRoute.expectedWethOut, pending.creator, pending.buyback).creatorWeth
    : undefined;
  const busy = claimState === "wallet" || claimState === "pending";
  const claimReady = configured && quoteState === "ready" && Boolean(settlementRoute && minOtfOut);

  async function claimFees() {
    if (!claimReady || !address || !collector || !settlementRoute || !minOtfOut || !publicClient || !walletClient) return;
    try {
      setClaimState("wallet");
      setClaimHash(undefined);
      const deadline = BigInt(Math.floor(Date.now() / 1_000) + 5 * 60);
      const call = feeSettlementCall(settlementRoute, minOtfOut, deadline);
      let hash: Hex;
      if (call.functionName === "settleFeesViaRedemption") {
        const simulation = await publicClient.simulateContract({
          account: address,
          address: collector,
          abi: buybackCollectorAbi,
          functionName: call.functionName,
          args: call.args,
        });
        hash = await walletClient.writeContract(simulation.request);
      } else {
        const simulation = await publicClient.simulateContract({
          account: address,
          address: collector,
          abi: buybackCollectorAbi,
          functionName: call.functionName,
          args: call.args,
        });
        hash = await walletClient.writeContract(simulation.request);
      }
      setClaimHash(hash);
      setClaimState("pending");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Fee settlement reverted.");
      setClaimState("success");
      await feeReads.refetch();
    } catch (error) {
      const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
      setClaimState(/rejected|denied|cancelled/iu.test(message) ? "rejected" : "failure");
    }
  }

  const routeQuoteSummary = [
    settlementRoutes.redemption
      ? `Redeem ${formatWethAmount(settlementRoutes.redemption.expectedWethOut)}`
      : undefined,
    settlementRoutes.shareSale
      ? `Sell ${formatWethAmount(settlementRoutes.shareSale.expectedWethOut)}`
      : undefined,
  ].filter((value): value is string => Boolean(value)).join(" · ");
  const selectedRouteLabel = settlementRoute?.mode === "share-sale"
    ? "Selling shares through approved pools"
    : "Redeeming shares into the basket";
  const amount = expectedCreatorWeth !== undefined
    ? formatClaimWeth(expectedCreatorWeth)
    : quoteState === "loading" || (pending && pending.total > 0n && canonicalReads.isPending)
      ? "Quoting…"
      : pending?.total === 0n
        ? "No fees to claim"
        : "Route unavailable";
  const status = claimState === "wallet"
    ? "Confirm the atomic fee settlement in your wallet."
    : claimState === "pending"
      ? "Claim submitted. Waiting for confirmation."
      : claimState === "success"
        ? "Creator fees paid in WETH and the buyback completed."
        : claimState === "rejected"
          ? "The wallet request was rejected. Nothing was submitted."
          : claimState === "failure"
            ? "Settlement failed. Refresh the quote and try again."
            : !configured
              ? "Fee settlement is unavailable until the current contracts are deployed."
              : readState === "pending"
                ? "Loading pending fees and routes…"
                : readState !== "verified"
                  ? "The vault fee account could not be verified."
                  : pending?.total === 0n
                    ? ""
                    : quoteState === "missing"
                      ? "No complete share-sale or basket-redemption route to WETH is currently available."
                      : quoteState === "ready" && !settlementRoute
                        ? "The selected settlement route is unavailable. Choose another route."
                        : quoteState === "ready" && !minOtfOut && !canonicalReads.isPending
                          ? "The WETH-to-OTF buyback route cannot satisfy the selected minimum."
                          : claimReady
                            ? `${selectedRouteLabel}. ${routeQuoteSummary}`
                            : "Loading pending fees and routes…";

  return (
    <section className="fundFeeClaim" aria-label="Claim creator fees">
      <div className="fundFeeClaimControls" role="group" aria-label="Fee claim settings">
        <label><span>Settlement route</span><span className="selectControl fundFeeRoute"><select value={routePreference} onChange={(event) => setRoutePreference(event.target.value as FeeSettlementRoutePreference)} disabled={busy} aria-label="Fee settlement route"><option value="best">Best available</option><option value="share-sale" disabled={quoteState === "ready" && !settlementRoutes.shareSale}>Sell shares</option><option value="redemption" disabled={quoteState === "ready" && !settlementRoutes.redemption}>Redeem basket</option></select><ChevronDown size={14} aria-hidden="true" /></span></label>
        <label><span>Max slippage</span><span className="selectControl fundFeeSlippage"><select value={slippageBps} onChange={(event) => setSlippageBps(Number(event.target.value))} disabled={busy} aria-label="Fee settlement slippage"><option value={50}>0.5%</option><option value={100}>1.0%</option><option value={300}>3.0%</option></select><ChevronDown size={14} aria-hidden="true" /></span></label>
      </div>
      <div className="fundFeeClaimAmount"><strong>{amount}</strong><button className="primaryAction" type="button" disabled={!claimReady || busy || pending?.total === 0n} onClick={() => void claimFees()}>{busy ? <LoaderCircle className="spin" size={14} /> : <CheckCircle size={14} />}Claim fees</button></div>
      {status ? <div className={`fundFeeClaimStatus ${claimState === "failure" ? "failure" : claimState === "success" ? "success" : ""}`} aria-live="polite"><span>{status}</span>{claimHash ? <a href={`${explorer}/tx/${claimHash}`} target="_blank" rel="noreferrer">View transaction <ExternalLink size={11} /></a> : null}</div> : null}
    </section>
  );
}

function formatShareSupply(value: bigint): string {
  return Number(formatUnits(value, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatClaimWeth(value: bigint): string {
  if (value > 0n && value < 1_000_000_000_000n) return "<0.000001 WETH";
  return `${Number(formatUnits(value, 18)).toLocaleString(undefined, { maximumFractionDigits: 6 })} WETH`;
}

function formatWethAmount(value: bigint): string {
  return `${Number(formatUnits(value, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })} WETH`;
}

type FundValuationSnapshot = { at: number; navUsd: number; aumUsd: number };

type FundValuation = {
  error?: string;
  fundAddress?: Address;
  allocationWeights?: FundAllocationWeights;
  assetPrices?: CreationAssetData[];
  state: "loading" | "ready" | "unavailable";
  current?: FundValuationSnapshot;
  history: FundValuationSnapshot[];
  usesBootstrapNav: boolean;
};

type DirectoryAum = {
  error?: string;
  errorsByFund?: Map<string, string>;
  state: "loading" | "ready" | "unavailable";
  value?: number;
  byFund?: Map<string, number>;
  rewardWeights?: Map<string, number>;
  totalRewardWeightOtf?: number;
};

type IncentivePricing = {
  state: "loading" | "ready" | "unavailable";
  otfPriceUsd?: number;
  weeklyEmissionOtf?: number;
  weeklyDepositorEmissionOtf?: number;
  weeklyCreatorEmissionOtf?: number;
  week?: number;
  ended: boolean;
  otfToken?: Address;
};


function useFundValuation(fund?: FactoryVaultSummary): FundValuation {
  const chainId = useChainId();
  const { registry } = useAssetRegistry();
  const pageVisible = usePageVisible();
  const [valuation, setValuation] = useState<FundValuation>({ state: "loading", history: [], usesBootstrapNav: false });
  useEffect(() => {
    if (!fund || !pageVisible) return;
    const controller = new AbortController();
    let timer: number | undefined;
    const load = async () => {
      try {
        const response = await fetch(`/api/fund-history?chainId=${chainId}&address=${fund.address}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("HISTORY_UNAVAILABLE");
        const payload = await response.json() as FundHistoryResponse;
        const latest = payload.latest;
        const history = chartHistory(payload.history);
        const usable = latest && latest.status !== "unpriced" && Date.now()-Date.parse(latest.block_at) <= 10*60_000;
        const prices = payload.holdings.flatMap(holding => {
          const asset = registry.assets.find(asset => asset.chainId === chainId && asset.address.toLowerCase() === holding.address.toLowerCase());
          return asset && holding.price_usd ? [{ address: asset.address, symbol: asset.symbol, name: asset.name, decimals: holding.decimals,
            priceUsd: holding.price_usd, marketCapUsd: holding.market_cap_usd ?? "", verified: asset.verified, priceUpdatedAt: holding.source_at ?? undefined }] : [];
        });
        const amounts = payload.holdings.map(holding => BigInt(latest?.status === "bootstrap" ? holding.bootstrap_amount ?? "0" : holding.amount));
        if (controller.signal.aborted) return;
        setValuation({ state: usable ? "ready" : "unavailable", fundAddress: fund.address, history,
          error: usable ? undefined : !latest ? "No valuation snapshot is available for this fund."
            : latest.status === "unpriced" ? "One or more constituent prices are missing or stale."
            : "The fund valuation snapshot is out of date.",
          current: usable ? { at: Date.parse(latest.block_at), aumUsd: Number(latest.total_nav_usd), navUsd: Number(latest.status === "bootstrap" ? latest.bootstrap_nav_usd : latest.nav_per_share_usd) } : undefined,
          usesBootstrapNav: latest?.status === "bootstrap", assetPrices: prices,
          allocationWeights: prices.length === amounts.length ? fundAllocationWeights(prices, amounts) : undefined,
        });
      } catch { if (!controller.signal.aborted) setValuation(current => ({ ...current, state: "unavailable", current: undefined, error: "Could not load this fund's valuation." })); }
      if (!controller.signal.aborted) timer = window.setTimeout(load, 60_000);
    };
    void load();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [chainId, fund, registry, pageVisible]);
  return valuation;
}

function useDirectoryAum(vaults: FactoryVaultSummary[], directoryState: FactoryVaultDirectoryState, includeNav: boolean): DirectoryAum {
  const chainId=useChainId(),pageVisible=usePageVisible();
  const [value,setValue]=useState<DirectoryAum>({state:"loading"});
  useEffect(()=>{
    if(!pageVisible)return;
    if(directoryState!=="ready") {setValue({state:directoryState==="loading"?"loading":"unavailable"});return;}
    if(!vaults.length) {setValue({state:"ready",value:0,byFund:new Map(),rewardWeights:new Map(),totalRewardWeightOtf:0});return;}
    const controller=new AbortController();let timer:number|undefined;
    const load=async()=>{
      try {
        const response=await fetch('/api/fund-valuations?chainId='+chainId,{signal:controller.signal,cache:"no-store"});
        if(!response.ok)throw new Error("VALUATIONS_UNAVAILABLE");
        const payload=await response.json() as {funds:{address:string;status:string;total_nav_usd:string|null;otf_balance:string|null}[]};
        const byFund=new Map<string,number>(),rewardWeights=new Map<string,number>();
        const errorsByFund = new Map<string, string>();
        let total=0,totalRewardWeightOtf=0,complete=true;
        const otfToken=protocolDeploymentForChain(chainId)?.addresses.otfToken;
        for(const fund of vaults) {
          const row=payload.funds.find(row=>row.address.toLowerCase()===fund.address.toLowerCase());
          if(!row) {complete=false;errorsByFund.set(fund.address.toLowerCase(), "No valuation snapshot is available for this fund.");continue;}
          if (row.status === "unpriced" || row.total_nav_usd === null) errorsByFund.set(fund.address.toLowerCase(), "One or more constituent prices are missing or stale.");
          if(otfToken) {
            const weight=accountedRewardWeightOtf([otfToken],[BigInt(row.otf_balance??"0")],otfToken)!;
            rewardWeights.set(fund.address.toLowerCase(),weight);totalRewardWeightOtf+=weight;
          }
          if(includeNav && row.status!=="unpriced" && row.total_nav_usd!==null) {
            const nav=Number(row.total_nav_usd);byFund.set(fund.address.toLowerCase(),nav);total+=nav;
          } else if(includeNav)complete=false;
        }
        if(!controller.signal.aborted)setValue({state:complete?"ready":"unavailable",value:includeNav&&complete?total:undefined,byFund,rewardWeights,totalRewardWeightOtf,errorsByFund,error:complete?undefined:"The fund directory has incomplete valuation or reward-balance data."});
      } catch {if(!controller.signal.aborted)setValue({state:"unavailable",error:"Could not load fund valuations and reward balances."});}
      if(!controller.signal.aborted)timer=window.setTimeout(load,60_000);
    };
    void load();return()=>{controller.abort();window.clearTimeout(timer);};
  },[chainId,directoryState,includeNav,vaults,pageVisible]);
  return value;
}

function useIncentivePricing(): IncentivePricing {
  const chainId = useChainId();
  const [pricing, setPricing] = useState<IncentivePricing>({ state: "loading", ended: false });

  useEffect(() => {
    if (!protocolDeploymentForChain(chainId)?.rewardsReady) {
      setPricing({ state: "unavailable", ended: false });
      return;
    }
    let cancelled = false;
    let controller: AbortController | undefined;
    const load = () => {
      controller?.abort();
      controller = new AbortController();
      void fetch(`/api/incentive-apy?chainId=${chainId}&includePrice=true`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
        if (!response.ok) throw new Error("INCENTIVE_APY_UNAVAILABLE");
        return response.json() as Promise<Record<string, unknown>>;
      }).then((payload) => {
        const valid = Number.isInteger(payload.week) && Number(payload.week) >= 1
          && typeof payload.weeklyEmissionOtf === "number" && Number.isFinite(payload.weeklyEmissionOtf) && payload.weeklyEmissionOtf >= 0
          && typeof payload.weeklyDepositorEmissionOtf === "number" && Number.isFinite(payload.weeklyDepositorEmissionOtf) && payload.weeklyDepositorEmissionOtf >= 0
          && typeof payload.weeklyCreatorEmissionOtf === "number" && Number.isFinite(payload.weeklyCreatorEmissionOtf) && payload.weeklyCreatorEmissionOtf >= 0
          && (payload.otfPriceUsd === undefined || (typeof payload.otfPriceUsd === "number" && Number.isFinite(payload.otfPriceUsd) && payload.otfPriceUsd > 0))
          && typeof payload.ended === "boolean";
        if (!valid) throw new Error("INCENTIVE_APY_INVALID");
        if (!cancelled) {
          setPricing({
            state: "ready",
            week: Number(payload.week),
            weeklyEmissionOtf: payload.weeklyEmissionOtf as number,
            weeklyDepositorEmissionOtf: payload.weeklyDepositorEmissionOtf as number,
            weeklyCreatorEmissionOtf: payload.weeklyCreatorEmissionOtf as number,
            otfPriceUsd: payload.otfPriceUsd as number | undefined,
            ended: payload.ended as boolean,
          });
        }
      }).catch((error) => {
        if (!cancelled && !(error instanceof Error && error.name === "AbortError")) {
          setPricing({ state: "unavailable", ended: false });
        }
      });
    };
    setPricing({ state: "loading", ended: false });
    load();
    const refresh = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(refresh);
      controller?.abort();
    };
  }, [chainId]);

  return { ...pricing, otfToken: protocolDeploymentForChain(chainId)?.addresses.otfToken };
}

function fundApyPercent(fund: FactoryVaultSummary | undefined, aumUsd: number | undefined, pricing: IncentivePricing, directory: DirectoryAum): number | undefined {
  const hasOtf = fund && pricing.otfToken
    ? fund.assets.some((asset) => asset.toLowerCase() === pricing.otfToken!.toLowerCase()) : undefined;
  const weight = fund ? directory.rewardWeights?.get(fund.address.toLowerCase()) : undefined;
  if (hasOtf === false || fund?.totalSupply === 0n || aumUsd === 0 || weight === 0) return 0;
  if (pricing.state !== "ready" || directory.state !== "ready" || aumUsd === undefined) return undefined;
  return estimatedRewardsApy({
    weeklyDepositorEmissionOtf: pricing.weeklyDepositorEmissionOtf!,
    otfPriceUsd: pricing.otfPriceUsd!,
    fundAumUsd: aumUsd,
    fundRewardWeightOtf: weight!,
    totalRewardWeightOtf: directory.totalRewardWeightOtf!,
  })?.percent;
}

function fundSortValue(fund: FactoryVaultSummary, key: FundSortKey, pricing: IncentivePricing, directory: DirectoryAum) {
  const nav = directory.byFund?.get(fund.address.toLowerCase());
  return key === "assets" ? fund.assetCount : key === "nav" ? nav : fundApyPercent(fund, nav, pricing, directory);
}

function FundSortHeader({ sortKey, sort, onChange, children }: { sortKey: FundSortKey; sort: FundSort; onChange: (value: FundSort) => void; children: ReactNode }) {
  const active = sort.startsWith(sortKey + "-");
  const ascending = sort.endsWith("-asc");
  return <th aria-sort={active ? ascending ? "ascending" : "descending" : "none"}><button type="button" className="fundSortHeader" onClick={() => onChange(`${sortKey}-${active && !ascending ? "asc" : "desc"}`)}>{children}</button></th>;
}

function FundFees({ fund }: { fund: FactoryVaultSummary }) {
  return <span className="fundFeesInline" title="Annual NAV fee / mint fee / redeem fee">{formatAnnualExpenseRatioPercentage(fund.annualCreatorExpenseRatioBps)}/<wbr />{formatAnnualExpenseRatioPercentage(fund.mintFeeBps)}/<wbr />{formatAnnualExpenseRatioPercentage(fund.redeemFeeBps)}</span>;
}

function FundRewardsApy({ pricing, valuationState, valuationError, aumUsd, fund, directory }: {
  pricing: IncentivePricing;
  valuationState: FundValuation["state"];
  valuationError?: string;
  aumUsd?: number;
  fund?: FactoryVaultSummary;
  directory: DirectoryAum;
}) {
  const [explanationOpen, setExplanationOpen] = useState(false);
  const otfToken = pricing.otfToken;
  const hasOtf = fund && otfToken ? fund.assets.some((asset) => asset.toLowerCase() === otfToken.toLowerCase()) : undefined;
  const fundRewardWeightOtf = fund ? directory.rewardWeights?.get(fund.address.toLowerCase()) : undefined;
  const zeroApy = hasOtf === false || fund?.totalSupply === 0n || aumUsd === 0 || fundRewardWeightOtf === 0;
  const unavailable = pricing.state === "unavailable" || valuationState === "unavailable" || directory.state === "unavailable";
  const loading = !zeroApy && !unavailable && (pricing.state === "loading" || valuationState === "loading" || directory.state === "loading");
  const percent = zeroApy ? 0 : !loading && !unavailable ? fundApyPercent(fund, aumUsd, pricing, directory) : undefined;
  const estimate = percent === undefined ? undefined : { percent };
  const error = !loading && (percent === undefined || !Number.isFinite(percent))
    ? valuationError
      ?? (fund ? directory.errorsByFund?.get(fund.address.toLowerCase()) : undefined)
      ?? directory.error
      ?? (!otfToken ? "The protocol $OTF token is not configured for this network."
        : pricing.state === "unavailable" ? "Could not load the rewards schedule or pricing data."
        : pricing.otfPriceUsd === undefined ? "The $OTF price is missing or stale."
        : aumUsd === undefined ? "The fund valuation is unavailable."
        : fundRewardWeightOtf === undefined || directory.totalRewardWeightOtf === undefined ? "Reward balances are unavailable."
        : "The available data could not produce a valid rewards APY.")
    : undefined;
  const text = loading ? "…" : error ? "0%" : formatApy(estimate?.percent);
  const label = estimate
    ? `Estimated depositor rewards APY ${text}, paid in $OTF${pricing.week ? `, emission week ${pricing.week}` : ""}`
    : `Estimated depositor rewards APY ${loading ? "loading" : "unavailable"}`;
  return (
    <span className="fundRewardsValue" data-error={error ? "true" : undefined}>
      <span aria-label={error ? `Rewards APY error: ${error}` : label} title={error ?? label}>{text}</span>
      <button className="rewardsInfoButton" type="button" title={error} aria-label={error ? `Rewards APY error: ${error} Open explanation for ${fund?.name ?? "this fund"}.` : `Explain rewards APY for ${fund?.name ?? "this fund"}`} aria-haspopup="dialog" disabled={!fund} onClick={(event) => { event.preventDefault(); event.stopPropagation(); setExplanationOpen(true); }} onKeyDown={(event) => event.stopPropagation()}>{error ? <CircleAlert size={14} aria-hidden="true" /> : <Info size={14} aria-hidden="true" />}</button>
      {explanationOpen && fund ? <FundRewardsDialog
        fundName={fund.name}
        symbol={fund.symbol}
        apyText={loading || error ? text : formatApy(estimate?.percent, false)}
        error={error}
        hasOtf={hasOtf}
        zeroNav={fund.totalSupply === 0n || aumUsd === 0}
        loading={loading}
        navUsd={aumUsd}
        otfPriceUsd={pricing.otfPriceUsd}
        fundWeightOtf={fundRewardWeightOtf}
        totalWeightOtf={directory.totalRewardWeightOtf}
        weeklyDepositorEmissionOtf={pricing.weeklyDepositorEmissionOtf}
        week={pricing.week}
        onClose={() => setExplanationOpen(false)}
      /> : null}
    </span>
  );
}

function formatUsd(value: number | undefined, maximumFractionDigits = 2): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits });
}

function formatApy(value: number | undefined, compact = true): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString(undefined, compact && value >= 10_000
    ? { notation: "compact", maximumFractionDigits: 1 }
    : { maximumFractionDigits: compact && value >= 100 ? 0 : 2 })}%`;
}

function formatCompactNumber(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en", { notation: "compact", maximumFractionDigits: 1 });
}

type ValuationRange = "24h" | "7d" | "30d" | "all";

const VALUATION_RANGES: { label: string; value: ValuationRange; duration?: number }[] = [
  { label: "24H", value: "24h", duration: 24 * 60 * 60_000 },
  { label: "7D", value: "7d", duration: 7 * 24 * 60 * 60_000 },
  { label: "30D", value: "30d", duration: 30 * 24 * 60 * 60_000 },
  { label: "ALL", value: "all" },
];

function useFundAllocation(fund?: FactoryVaultSummary) {
  const publicClient = usePublicClient();
  const [allocation, setAllocation] = useState<{ state: "loading" | "ready" | "unavailable"; rows: FundAllocationRow[] }>({ state: "loading", rows: [] });
  useEffect(() => {
    let cancelled = false;
    setAllocation({ state: "loading", rows: [] });
    if (!fund || !publicClient) return;
    void Promise.all([
      publicClient.readContract({ address: fund.address, abi: managedOtfVaultAbi, functionName: "accountedBalances" }),
      Promise.all(fund.assets.map(async (address) => {
        const [symbol, name, decimals] = await Promise.all([
          publicClient.readContract({ address, abi: erc20Abi, functionName: "symbol" }).catch(() => undefined),
          publicClient.readContract({ address, abi: erc20Abi, functionName: "name" }).catch(() => undefined),
          publicClient.readContract({ address, abi: erc20Abi, functionName: "decimals" }).catch(() => undefined),
        ]);
        return { address, symbol, name, decimals };
      })),
    ]).then(([quantities, tokens]) => {
      if (!cancelled) setAllocation({ state: "ready", rows: fundAllocationRows(tokens, quantities) });
    }).catch(() => {
      if (!cancelled) setAllocation({ state: "unavailable", rows: [] });
    });
    return () => { cancelled = true; };
  }, [fund, publicClient]);
  return allocation;
}

function FundValuationChart({ symbol, valuation, fund }: { symbol: string; valuation: FundValuation; fund?: FactoryVaultSummary }) {
  const { registry } = useAssetRegistry();
  const chainId = useChainId();
  const allocation = useFundAllocation(fund);
  const weights = valuation.state === "ready" && valuation.fundAddress === fund?.address ? valuation.allocationWeights : undefined;
  const weightsByAddress = new Map(weights?.rows.map((row) => [row.address.toLowerCase(), row]));
  const pricesByAddress = new Map(valuation.state === "ready" && valuation.fundAddress === fund?.address ? valuation.assetPrices?.map((asset) => [asset.address.toLowerCase(), Number(asset.priceUsd)]) : []);
  const weightingLabel = weights?.matchesMarketCap === undefined
    ? valuation.state === "loading" ? "Loading weights…" : "Pricing data unavailable"
    : weights.matchesMarketCap ? "Market-cap weighted" : "Modified market-cap weighted";
  const [mode, setMode] = useState<"share" | "nav">("share");
  const [range, setRange] = useState<ValuationRange>("30d");
  const allPoints = valuation.history;
  const latestTimestamp = allPoints.at(-1)?.at ?? Date.now();
  const selectedRange = VALUATION_RANGES.find((option) => option.value === range);
  const rangeDuration = selectedRange?.duration;
  const points = rangeDuration
    ? allPoints.filter((point) => point.at >= latestTimestamp - rangeDuration)
    : allPoints;
  const values = points.map((point) => mode === "share" ? point.navUsd : point.aumUsd);
  const firstValue = values.at(0);
  const lastValue = values.at(-1);
  const changePercent = firstValue !== undefined && lastValue !== undefined && firstValue > 0
    ? ((lastValue - firstValue) / firstValue) * 100
    : undefined;
  const changeTone = changePercent === undefined || changePercent === 0
    ? "neutral"
    : changePercent > 0 ? "positive" : "negative";
  const changeLabel = changePercent === undefined
    ? "—"
    : `${changePercent > 0 ? "+" : ""}${changePercent.toFixed(2)}%`;

  const width = 720;
  const height = 190;
  const left = 0;
  const right = 14;
  const top = 18;
  const bottom = 25;
  const minimumValue = values.length ? Math.min(...values) : 0;
  const maximumValue = values.length ? Math.max(...values) : 1;
  const padding = Math.max((maximumValue - minimumValue) * 0.16, maximumValue * 0.025, 0.01);
  const minimum = Math.max(0, minimumValue - padding);
  const maximum = maximumValue + padding;
  const spread = Math.max(maximum - minimum, 0.01);
  const firstTimestamp = points.at(0)?.at ?? 0;
  const lastTimestamp = points.at(-1)?.at ?? firstTimestamp + 1;
  const timeSpread = Math.max(lastTimestamp - firstTimestamp, 1);
  const chartPoints = points.map((point) => ({
    x: points.length === 1 ? width - right : left + ((point.at - firstTimestamp) / timeSpread) * (width - left - right),
    y: top + ((maximum - (mode === "share" ? point.navUsd : point.aumUsd)) / spread) * (height - top - bottom),
  }));
  const linePath = chartPoints.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
  const baseline = height - bottom;
  const areaPath = chartPoints.length > 1 ? `${linePath} L ${chartPoints.at(-1)!.x} ${baseline} L ${chartPoints[0].x} ${baseline} Z` : "";
  const ticks = Array.from({ length: 4 }, (_, index) => maximum - ((maximum - minimum) * index) / 3);
  const selectedValue = valuation.current ? mode === "share" ? valuation.current.navUsd : valuation.current.aumUsd : undefined;
  const dateOptions: Intl.DateTimeFormatOptions = range === "24h"
    ? { hour: "numeric", minute: "2-digit" }
    : { month: "short", day: "numeric" };
  const firstDate = points.length ? new Date(firstTimestamp).toLocaleString(undefined, dateOptions) : "";
  const lastDate = points.length ? new Date(lastTimestamp).toLocaleString(undefined, dateOptions) : "";

  return (
    <div className="fundValuationColumn">
      <section className="sectionCard valuationPanel">
        <div className="valuationHeader">
          <h2>{mode === "share" ? "NAV/Share" : "NAV"}</h2>
          <div className="valuationModeToggle" role="group" aria-label="Chart metric"><button className={mode === "share" ? "active" : ""} type="button" aria-pressed={mode === "share"} onClick={() => setMode("share")}>SHARE</button><button className={mode === "nav" ? "active" : ""} type="button" aria-pressed={mode === "nav"} onClick={() => setMode("nav")}>NAV</button></div>
        </div>
        {valuation.state === "loading" ? <div className="valuationState"><LoaderCircle className="createAssetSpinner" size={17} /><span>Calculating the current valuation…</span></div> : valuation.state === "unavailable" ? <div className="valuationState"><History size={17} /><span>Valuation is unavailable because current prices or onchain balances could not be read.</span></div> : (
          <>
            <div className="valuationSummary">
              <div className="valuationPerformance"><strong className={changeTone}>{changeLabel}</strong></div>
              <div className="valuationRangeToggle" role="group" aria-label="Chart time range">{VALUATION_RANGES.map((option) => <button className={range === option.value ? "active" : ""} key={option.value} type="button" aria-pressed={range === option.value} onClick={() => setRange(option.value)}>{option.label}</button>)}</div>
            </div>
            <div className="valuationChartWrap">
              <svg className="valuationChart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${symbol} ${mode === "share" ? "NAV per share" : "total NAV"} chart ending at ${formatUsd(selectedValue)}`}>
                {ticks.map((tick) => { const y = top + ((maximum - tick) / spread) * (height - top - bottom); return <g key={tick}><line className="valuationChartGrid" x1={left} x2={width - right} y1={y} y2={y} /><text className="valuationChartLabel" x={left} y={y - 6} textAnchor="start">{formatUsd(tick, tick < 10 ? 2 : 0)}</text></g>; })}
                <path className="valuationChartArea" d={areaPath} />
                <path className="valuationChartLine" d={linePath} />
                {chartPoints.map((point, index) => <circle className="valuationChartPoint" key={`${point.x}-${index}`} cx={point.x} cy={point.y} r={index === chartPoints.length - 1 ? "4" : "3"} />)}
              </svg>
              {points.length ? <div className="valuationDates"><span>{firstDate}</span><span>{lastDate}</span></div> : null}
            </div>
          </>
        )}
      </section>
      <section className="sectionCard valuationAllocation" aria-labelledby="allocation-title">
        <div className="directoryPanelHeading allocationPanelHeading"><div><h2 id="allocation-title">Allocation</h2></div><span className="stateBadge muted methodologyBadge" title="Compares each allocation with the constituents’ current market-cap proportions. A match allows up to 0.01 percentage points difference per asset.">{weightingLabel}</span></div>
        {allocation.state === "ready" ? (
          <div className="creationAllocationTableWrap">
            <table className="creationAllocationTable">
              <thead><tr><th>Asset</th><th>Amount</th><th>Allocation</th><th>Price</th></tr></thead>
              <tbody>{allocation.rows.map((asset) => { const weight = weightsByAddress.get(asset.address.toLowerCase()); return <tr key={asset.address}><td><div className="rwaAssetIdentity"><AssetLogo symbol={asset.symbol} /><div><strong className="allocationAssetTitle">{asset.symbol}{fundAssetsVerified(registry, chainId, [asset.address]) ? <span className="allocationAssetVerified" role="img" aria-label="Verified asset" title="Verified asset"><BadgeCheck aria-hidden="true" /></span> : null}</strong><small>{asset.name}</small></div></div></td><td data-label="Amount" title={`${asset.quantity}${asset.quantityIsRaw ? " raw units" : ` ${asset.symbol}`}`}>{formatAllocationQuantity(asset.quantity)}{asset.quantityIsRaw ? " raw units" : ""}</td><td data-label="Allocation">{weight ? formatStoredPercentage(weight.percentageUnits.toString()) : "—"}</td><td data-label="Price">{formatUsd(pricesByAddress.get(asset.address.toLowerCase()), 6)}</td></tr>; })}</tbody>
            </table>
          </div>
        ) : (
          <div className="creationMetadataUnavailable" role="status"><span>{allocation.state === "loading" ? "Loading amounts…" : "Could not load amounts."}</span></div>
        )}
      </section>
    </div>
  );
}

function FundVerificationBadge({ chainId, assets }: { chainId: number; assets: readonly Address[] }) {
  const { registry } = useAssetRegistry();
  if (!fundAssetsVerified(registry, chainId, assets)) return null;
  return <span className="fundVerificationBadge" role="img" aria-label="All constituent assets verified" title="All constituent assets are in the verification registry"><BadgeCheck size={16} aria-hidden="true" /></span>;
}

function FundsSurface({ detail }: { detail: boolean }) {
  const routeAddress = addressFromLocation();
  const router = useRouter();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId });
  const { address } = useAccount();
  const testnet = chainId === robinhoodChainTestnet.id;
  const explorerUrl = testnet ? robinhoodChainTestnet.blockExplorers.default.url : robinhoodChain.blockExplorers.default.url;
  const directoryDeploymentReady = protocolDeploymentForChain(chainId)?.creationReady === true;
  const { state: factoryDirectoryState, vaults } = useFactoryVaults();
  const [directoryView, setDirectoryView] = useState<"rows" | "cards">("rows");
  const [mobileDirectory, setMobileDirectory] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const update = () => setMobileDirectory(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const [directorySearch, setDirectorySearch] = useState("");
  const [fundSort, setFundSort] = useState<FundSort>("nav-desc");
  const [detailState, setDetailState] = useState<"loading" | "ready" | "failure">("loading");
  const [vaultDetails, setVaultDetails] = useState<FactoryVaultSummary>();
  useEffect(() => {
    if (detail) document.title = `${vaultDetails?.symbol ?? "OTF"} - Onchain Traded Funds`;
  }, [detail, vaultDetails?.symbol]);
  const valuation = useFundValuation(detail ? vaultDetails : undefined);
  const directoryAum = useDirectoryAum(vaults, factoryDirectoryState, !detail);
  const fundAumUsd = valuation.state === "ready" ? valuation.current?.aumUsd : undefined;
  const rewardsApy = useIncentivePricing();
  const weeklyEmissionText = rewardsApy.state === "ready"
    ? `${formatCompactNumber(rewardsApy.weeklyEmissionOtf)} $OTF`
    : rewardsApy.state === "loading" ? "…" : "—";
  const weeklyDistributionLabel = rewardsApy.state === "ready"
    ? `Week ${rewardsApy.week} rewards budget: ${weeklyEmissionText}`
    : rewardsApy.state === "loading" ? "Weekly rewards budget loading" : "Weekly rewards budget unavailable";
  useEffect(() => {
    let cancelled = false;
    if (!detail) return;
    if (!directoryDeploymentReady || !publicClient) {
      setDetailState("failure");
      setVaultDetails(undefined);
      return;
    }
    setDetailState("loading");
    if (!routeAddress) {
      setDetailState("failure");
      setVaultDetails(undefined);
      return;
    }
    void readVaultSummary(publicClient, routeAddress).then((value) => {
      if (!cancelled) {
        setVaultDetails(value);
        setDetailState("ready");
      }
    }).catch(() => {
      if (!cancelled) {
        setVaultDetails(undefined);
        setDetailState("failure");
      }
    });
    return () => { cancelled = true; };
  }, [detail, directoryDeploymentReady, publicClient, routeAddress]);
  const directoryState = detail ? detailState : factoryDirectoryState;
  const normalizedSearch = directorySearch.trim().toLowerCase();
  const filteredVaults = sortFunds(normalizedSearch
    ? vaults.filter((vault) => `${vault.name} ${vault.symbol} ${vault.address}`.toLowerCase().includes(normalizedSearch))
    : vaults, fundSort, (fund, key) => fundSortValue(fund, key, rewardsApy, directoryAum));
  if (detail) {
    const embeddedFund: SwapAsset | undefined = vaultDetails ? {
      address: vaultDetails.address,
      symbol: vaultDetails.symbol,
      name: vaultDetails.name,
      kind: "otf",
      decimals: 18,
      metadataResolved: true,
      isFactoryVault: true,
    } : undefined;
    return (
      <DashboardPage className="fundsPage">
        <div className="appView fundsView">
          <section className="fundDetailHero" aria-labelledby="fund-detail-title">
            <div className="fundDetailHeader">
              <div className="fundDetailIdentity">
                <OtfTokenIcon className="fundDetailTokenIcon" size={48} ticker={vaultDetails?.symbol ?? "OTF"} />
                <div>
                  <div className="fundDetailTitleLine"><h1 id="fund-detail-title" className="fundNameWithBadge"><span className="fundNameText">{vaultDetails?.name ?? (routeAddress ? shortAddress(routeAddress) : "No OTF connected")}</span>{vaultDetails ? <FundVerificationBadge chainId={chainId} assets={vaultDetails.assets} /> : null}</h1></div>
                  <div className="fundDetailMeta">
                    {routeAddress ? <a href={`${explorerUrl}/address/${routeAddress}`} target="_blank" rel="noreferrer"><code>{shortAddress(routeAddress)}</code><ExternalLink size={11} /></a> : <span>No valid fund address in this route</span>}
                  </div>
                </div>
              </div>
              <div className="fundDetailMetrics" aria-label="Fund metrics">
                <div><span>NAV/Share</span><strong>{valuation.state === "ready" ? formatUsd(valuation.current?.navUsd, 4) : "—"}</strong></div>
                <div><span>NAV</span><strong>{valuation.state === "ready" ? formatUsd(valuation.current?.aumUsd) : "—"}</strong></div>
                <div><span>Rewards APY</span><strong className="fundRewardsMetric"><FundRewardsApy pricing={rewardsApy} valuationState={valuation.state} valuationError={valuation.error} aumUsd={fundAumUsd} fund={vaultDetails} directory={directoryAum} /></strong></div>
                <div><span>Creator</span><strong>{vaultDetails ? <a className="metricExternalLink fundMetricAddressLink" href={`${explorerUrl}/address/${vaultDetails.creator}`} target="_blank" rel="noreferrer"><code>{shortAddress(vaultDetails.creator)}</code><ExternalLink size={11} /></a> : "—"}</strong></div>
              </div>
            </div>
            <section className="fundThesis" aria-labelledby="fund-thesis-title"><span className="fundThesisMark" aria-hidden="true"><BookOpenText size={17} /></span><div><h2 id="fund-thesis-title">Fund thesis</h2>{vaultDetails ? <p>{vaultDetails.fundThesis}</p> : null}</div></section>
          </section>
          <div className="fundDetailPrimaryGrid">
            <FundValuationChart symbol={vaultDetails?.symbol ?? "OTF"} valuation={valuation} fund={vaultDetails} />
            <div className="fundTradeColumn">
              <section className="fundTradePanel" aria-labelledby="fund-trade-title">
                <div className="fundTradeBody">
                  <div className="fundTradeHeading"><div><span className="appPageIcon"><TrendingUp size={16} /></span><div><h2 id="fund-trade-title">Trade {vaultDetails?.symbol ?? "this OTF"}</h2><p>Buy or sell shares in the fund</p></div></div></div>
                  {embeddedFund ? <SwapSurface key={embeddedFund.address} embedded embeddedFund={embeddedFund} /> : <div className="valuationState"><ActivitySpinner size={17} /></div>}
                </div>
              </section>
              <section className="fundFeesPanel" aria-label="Fund fees">
                <div className="fundFeesHeading"><span>Fund fees</span><small>Permanent rates</small></div>
                <dl className="fundFeeGrid">
                  <div><dt>Annual</dt><dd>{vaultDetails ? formatAnnualExpenseRatioPercentage(vaultDetails.annualCreatorExpenseRatioBps) : "—"}</dd></div>
                  <div><dt>Mint</dt><dd>{vaultDetails ? formatAnnualExpenseRatioPercentage(vaultDetails.mintFeeBps) : "—"}</dd></div>
                  <div><dt>Redeem</dt><dd>{vaultDetails ? formatAnnualExpenseRatioPercentage(vaultDetails.redeemFeeBps) : "—"}</dd></div>
                </dl>
                {vaultDetails && address?.toLowerCase() === vaultDetails.expenseBeneficiary.toLowerCase()
                  ? <FeeClaimPanel vault={vaultDetails.address} beneficiary={vaultDetails.expenseBeneficiary} explorer={explorerUrl} />
                  : null}
              </section>
            </div>
          </div>
        </div>
      </DashboardPage>
    );
  }
  return (
    <DashboardPage className="fundsPage">
      <div className="appView fundsView">
        <section className="fundsSummary" aria-label="Funds overview">
          <div className="fundsHeadlineMetrics">
            <div className="fundsHeadlineMetric fundsAum">
              <strong aria-label="Total AUM">{directoryAum.state === "loading" ? "…" : formatUsd(directoryAum.value)}</strong>
              <span>in {vaults.length} OTF{vaults.length === 1 ? "" : "s"}</span>
            </div>
            <span className="fundsMetricSeparator" aria-hidden="true" />
            <div className="fundsHeadlineMetric fundsDistribution">
              <strong aria-label={weeklyDistributionLabel} title={weeklyDistributionLabel}>{weeklyEmissionText}</strong>
              <span>{rewardsApy.week ? `Week ${rewardsApy.week} rewards budget` : "Weekly rewards budget"}</span>
            </div>
          </div>
          <div className="appPageActions"><Link className="secondaryAction" href="/verified"><ShieldCheck size={14} />Registered assets</Link><Link className="primaryAction" href="/launch?from=funds">Launch OTF<ArrowUpRight size={14} /></Link></div>
        </section>
        {!directoryDeploymentReady ? (
          <section className="sectionCard depositsEmpty"><span><Network size={22} /></span><h2>Protocol deployment unavailable</h2><p>Fund discovery will become available when the protocol is deployed and configured on this network.</p></section>
        ) : (
          <>
            {!directoryDeploymentReady ? <div className="validationSummary directoryDataNotice" role="status"><History size={15} /><div><strong>Onchain directory unavailable</strong><span>The configured factory directory could not be loaded. No preview funds or aggregate values are substituted.</span></div></div> : null}
            <section className="sectionCard directoryPanel">
              <div className="directoryToolbar">
                <label className="searchField"><Search size={14} /><input aria-label="Search OTFs" placeholder="Search by OTF name, symbol, or address" value={directorySearch} onChange={(event) => setDirectorySearch(event.target.value)} disabled={directoryState !== "ready" || !vaults.length} /></label>
                <div className="directoryViewToggle" role="group" aria-label="OTF directory view">
                  <button className={directoryView === "rows" ? "active" : ""} type="button" aria-label="Show OTFs as rows" aria-pressed={directoryView === "rows"} onClick={() => setDirectoryView("rows")}><List size={15} /></button>
                  <button className={directoryView === "cards" ? "active" : ""} type="button" aria-label="Show OTFs as cards" aria-pressed={directoryView === "cards"} onClick={() => setDirectoryView("cards")}><LayoutGrid size={15} /></button>
                </div>
              </div>
              {directoryState === "ready" && filteredVaults.length ? mobileDirectory || directoryView === "rows" ? (
                <div className="directoryTableWrap">
                  <table className="directoryTable" aria-label="Onchain traded funds">
                    <thead><tr><th>OTF</th><FundSortHeader sortKey="nav" sort={fundSort} onChange={setFundSort}>NAV</FundSortHeader><FundSortHeader sortKey="apy" sort={fundSort} onChange={setFundSort}>Rewards APY</FundSortHeader><FundSortHeader sortKey="assets" sort={fundSort} onChange={setFundSort}>Assets</FundSortHeader><th>Fees</th><th>Creator</th></tr></thead>
                    <tbody>{filteredVaults.map((vault) => {
                      const href = `/funds/${vault.address}`;
                      const aumUsd = directoryAum.byFund?.get(vault.address.toLowerCase());
                      return (
                        <tr className="clickableDirectoryRow" key={vault.address} onClick={(event) => { if (!(event.target as Element).closest("a, button")) router.push(href); }}>
                          <td><Link className="directoryFundLink" href={href}><AssetLogo symbol={vault.symbol} /><span><strong className="fundNameWithBadge"><span className="fundNameText">{mobileDirectory ? vault.symbol : vault.name}</span><FundVerificationBadge chainId={chainId} assets={vault.assets} /></strong>{!mobileDirectory ? <small>{vault.symbol} · {shortAddress(vault.address)}</small> : null}</span></Link></td>
                          <td data-label="NAV">{directoryAum.state === "loading" ? "…" : formatUsd(aumUsd)}</td>
                          <td data-label="Rewards APY"><FundRewardsApy pricing={rewardsApy} valuationState={directoryAum.state} aumUsd={aumUsd} fund={vault} directory={directoryAum} /></td>
                          <td data-label="Assets">{vault.assetCount}</td>
                          <td data-label="Fees"><FundFees fund={vault} /></td>
                          <td data-label="Creator" className="monoValue">{shortAddress(vault.creator)}</td>
                        </tr>
                      );
                    })}</tbody>
                  </table>
                </div>
              ) : (
                <div className="directoryFundCards">{filteredVaults.map((vault) => {
                  const aumUsd = directoryAum.byFund?.get(vault.address.toLowerCase());
                  return (
                    <div className="directoryFundCard" key={vault.address}>
                      <Link className="directoryFundCardLink" href={`/funds/${vault.address}`}><AssetLogo symbol={vault.symbol} /><span><strong className="fundNameWithBadge"><span className="fundNameText">{vault.name}</span><FundVerificationBadge chainId={chainId} assets={vault.assets} /></strong><small>{vault.symbol} · {shortAddress(vault.address)}</small></span></Link>
                      <dl>
                        <div><dt>NAV</dt><dd>{directoryAum.state === "loading" ? "…" : formatUsd(aumUsd)}</dd></div>
                        <div><dt>Rewards APY</dt><dd><FundRewardsApy pricing={rewardsApy} valuationState={directoryAum.state} aumUsd={aumUsd} fund={vault} directory={directoryAum} /></dd></div>
                        <div><dt>Assets</dt><dd>{vault.assetCount}</dd></div>
                        <div><dt>Fees</dt><dd><FundFees fund={vault} /></dd></div>
                        <div><dt>Creator</dt><dd>{shortAddress(vault.creator)}</dd></div>
                      </dl>
                    </div>
                  );
                })}</div>
              ) : (
                <div className="emptyDirectory">{directoryState === "loading" ? <ActivitySpinner size={18} /> : <><Search size={18} /><strong>{directoryState === "failure" ? "Could not load OTFs" : normalizedSearch ? "No matching OTFs" : "No OTFs yet"}</strong><span>{directoryState === "failure" ? "The configured factory directory could not be read. Refresh to try again or inspect a known OTF address directly." : normalizedSearch ? "Try another name, symbol, or contract address." : "New OTFs will appear here after their launch transaction is confirmed."}</span></>}</div>
              )}
            </section>
          </>
        )}
      </div>
    </DashboardPage>
  );
}

function VerifiedSurface() {
  const chainId = useChainId();
  const { catalog, isPending, isError, refetch } = useAssetRegistry();
  const assets = catalog.assets;
  const explorer = (chainId === robinhoodChainTestnet.id ? robinhoodChainTestnet : robinhoodChain).blockExplorers.default.url;
  return <DashboardPage><div className="appView">
    <AppPageHeader title="Registered Assets" description="Assets registered on this network." icon={<ShieldCheck size={18} />} />
    <section className="sectionCard walletAssets">
      <div className="directoryPanelHeading"><div><h2>Asset registry</h2><p>{assets.length} registered assets</p></div>
      </div>
      {isPending ? <p role="status">Loading assets…</p> : isError ? <div role="alert"><p>Asset registry unavailable.</p><button type="button" className="secondaryAction" onClick={() => void refetch()}>Retry</button></div> : !assets.length ? <p>No assets registered on this network.</p> :
      <div className="directoryTableWrap"><table className="directoryTable registeredAssetsTable"><thead><tr><th>Onchain asset</th><th>Status</th><th>Decimals</th><th>Token contract</th></tr></thead><tbody>{assets.map(asset => <tr key={asset.address}>
        <td><div className="rwaAssetIdentity"><AssetLogo symbol={asset.symbol} /><div><strong>{asset.symbol}</strong><small>{asset.name}</small></div></div></td>
        <td data-label="Status"><span className={asset.verified ? "stateBadge success" : "stateBadge muted"}>{asset.verified ? "Verified" : "Unverified"}</span></td>
        <td data-label="Decimals" className="monoValue">{asset.decimals}</td><td data-label="Token contract" className="monoValue"><a className="tableAddressLink" href={explorer + "/address/" + asset.address} target="_blank" rel="noreferrer">{shortAddress(asset.address)}<ExternalLink size={11} /></a></td>
      </tr>)}</tbody></table></div>}
    </section>
  </div></DashboardPage>;
}

function TokenSurface() {
  return <DashboardPage><OTFTokenSurface swap={<SwapSurface embedded protocolTokenMode />} /></DashboardPage>;
}

function WalletSurface() {
  const chainId = useChainId();
  const testnet = chainId === robinhoodChainTestnet.id;
  const { address } = useAccount();
  const { state: vaultDirectoryState, vaults } = useFactoryVaults({ enabled: Boolean(address) });
  const balanceContracts = useMemo(() => address ? vaults.map((vault) => ({
    address: vault.address,
    abi: managedOtfVaultAbi,
    functionName: "balanceOf" as const,
    args: [address] as const,
  })) : [], [address, vaults]);
  const { data: vaultBalanceReads, isLoading: vaultBalancesLoading } = useReadContracts({
    contracts: balanceContracts,
    query: { enabled: Boolean(address && protocolDeploymentForChain(chainId)?.creationReady && balanceContracts.length) },
  });
  const walletAum = useDirectoryAum(vaults, vaultDirectoryState, Boolean(address && protocolDeploymentForChain(chainId)?.creationReady));
  const walletRewards = useIncentivePricing();
  const orderedPositions = sortFunds(vaults, "nav-desc", (fund, key) => fundSortValue(fund, key, walletRewards, walletAum));
  const positions = orderedPositions.flatMap((vault) => {
    const balance = vaultBalanceReads?.[vaults.indexOf(vault)]?.result;
    return typeof balance === "bigint" && balance > 0n ? [{ vault, balance }] : [];
  });
  const managedVaults = sortFunds(address ? vaults.filter((vault) => vault.creator.toLowerCase() === address.toLowerCase()) : [], "nav-desc", (fund, key) => fundSortValue(fund, key, walletRewards, walletAum));
  const vaultDataLoading = vaultDirectoryState === "loading" || (vaultDirectoryState === "ready" && vaultBalancesLoading);
  const explorerUrl = testnet ? robinhoodChainTestnet.blockExplorers.default.url : robinhoodChain.blockExplorers.default.url;

  return (
    <DashboardPage>
      <div className="appView">
        <AppPageHeader
          title={address ? <a className="metricExternalLink walletAddressLink" href={`${explorerUrl}/address/${address}`} target="_blank" rel="noreferrer" title="Open wallet in block explorer" aria-label={`Open wallet ${address} in block explorer in a new tab`}>{shortAddress(address)}<ExternalLink size={12} /></a> : "Wallet"}
          description="Your OTF share positions and managed funds."
          icon={<Wallet size={18} />}
        />
        {!protocolDeploymentForChain(chainId)?.creationReady ? <section className="sectionCard depositsEmpty"><span><Network size={22} /></span><h2>Protocol deployment unavailable</h2><p>Wallet positions will become available when the protocol is deployed and configured on this network.</p></section> : address ? (
          <>
            <section className="sectionCard depositPositions">
              <div className="managedVaultsHeading"><div><span className="appPageIcon"><CircleDollarSign size={16} /></span><div><h2>OTF positions</h2><p>Share-token balances held by the connected wallet.</p></div></div><span className="stateBadge muted">{vaultDataLoading ? <ActivitySpinner size={13} /> : `${positions.length} position${positions.length === 1 ? "" : "s"}`}</span></div>
              {positions.length ? <div className="walletVaultRows">{positions.map(({ vault, balance }) => <Link className="walletVaultRow walletPositionRow" href={`/funds/${vault.address}`} key={vault.address}><div className="walletVaultIdentity"><AssetLogo symbol={vault.symbol} /><span><strong>{vault.name}</strong><small>{vault.symbol} · {shortAddress(vault.address)}</small></span></div><div className="walletVaultStat"><span>Balance</span><strong>{formatShareSupply(balance)} {vault.symbol}</strong></div></Link>)}</div> : <div className="inlineEmptyState walletPositionEmpty">{vaultDataLoading ? <LoaderCircle className="createAssetSpinner" size={18} /> : <CircleDollarSign size={18} />}<div><strong>{vaultDataLoading ? "Checking OTF balances" : vaultDirectoryState === "failure" ? "Could not load OTF positions" : "No OTF positions found"}</strong><span>{vaultDirectoryState === "failure" ? "The factory directory could not be read from the configured network RPC." : "Your OTF shares will appear here after a purchase or deposit."}</span></div></div>}
            </section>
            <section className="sectionCard managedVaultsPanel">
              <div className="managedVaultsHeading"><div><span className="appPageIcon"><UserCog size={16} /></span><div><h2>Funds managed by you</h2><p>Funds launched by this wallet, discovered from the factory directory.</p></div></div><div className="managedVaultsHeaderActions"><Link className="secondaryAction" href="/launch?from=wallet">Launch OTF</Link></div></div>
              {managedVaults.length ? <div className="walletVaultRows">{managedVaults.map((vault) => <Link className="walletVaultRow" href={`/funds/${vault.address}`} key={vault.address}><div className="walletVaultIdentity"><AssetLogo symbol={vault.symbol} /><span><strong>{vault.name}</strong><small>{vault.symbol} · {shortAddress(vault.address)}</small></span></div><div className="walletVaultStat"><span>Constituents</span><strong>{vault.assetCount}</strong></div><div className="walletVaultStat"><span>Fees</span><strong><FundFees fund={vault} /></strong></div></Link>)}</div> : <div className="inlineEmptyState">{vaultDirectoryState === "loading" ? <LoaderCircle className="createAssetSpinner" size={18} /> : <UserCog size={18} />}<div><strong>{vaultDirectoryState === "loading" ? "Finding OTFs launched by this wallet" : vaultDirectoryState === "failure" ? "Could not load launched OTFs" : "No launched OTFs found"}</strong><span>{vaultDirectoryState === "failure" ? "The factory directory could not be read from the configured network RPC." : "OTFs will appear here after this wallet launches them through the factory."}</span></div></div>}
            </section>
          </>
        ) : (
          <section className="sectionCard depositsEmpty">
            <span><Wallet size={22} /></span>
            <h2>
              <ConnectButton.Custom>
                {({ mounted, openConnectModal }) => (
                  mounted ? <button className="depositsConnectLink" type="button" onClick={openConnectModal}>Connect your wallet</button> : <ActivitySpinner size={18} />
                )}
              </ConnectButton.Custom>{" "}
              to view positions
            </h2>
            <p>OTF share positions will appear here after connecting.</p>
            <Link className="secondaryAction" href="/funds"><LayoutGrid size={14} />Browse OTFs</Link>
          </section>
        )}
      </div>
    </DashboardPage>
  );
}

function OperateRouter({ initialView }: { initialView: OperateView }) {
  if (initialView === "landing") return <SplashPage />;

  if (initialView === "liquidity") return <LiquiditySurface />;
  if (initialView === "launch") return <LaunchSurface />;
  if (initialView === "vaults") return <FundsSurface detail={false} />;
  if (initialView === "detail") return <FundRouteSurface />;
  if (initialView === "verified") return <VerifiedSurface />;
  if (initialView === "wallet") return <WalletSurface />;
  if (initialView === "token") return <TokenSurface />;
  return <SwapSurface />;
}

export function OperateExperience({ initialView = "landing" }: { initialView?: OperateView }) {
  return <OperateRouter initialView={initialView} />;
}
