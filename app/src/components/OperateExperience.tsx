"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ConnectButton, useConnectModal } from "@rainbow-me/rainbowkit";
import { OtfTokenIcon } from "@onchaintradedfunds/brand";
import circularOtfIcon from "@onchaintradedfunds/brand/assets/otf-circular-icon.svg";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUpRight,
  ArrowRight,
  BookOpenText,
  Check,
  CheckCircle,
  ChevronDown,
  CircleDollarSign,
  Copy,
  Droplets,
  ExternalLink,
  FilePlus2,
  History,
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
import { decodeFunctionResult, encodeFunctionData, formatUnits, getAddress, isAddress, parseEventLogs, zeroAddress, type Address, type Hex, type TransactionReceipt } from "viem";
import { useAccount, useBalance, useChainId, usePublicClient, useReadContracts, useSwitchChain, useWalletClient } from "wagmi";
import { buybackCollectorAbi, managedOtfVaultAbi, otfEntryExitRouterAbi, otfFactoryAbi, otfLaunchManagerAbi } from "@onchaintradedfunds/generated";
import { robinhoodChain, robinhoodChainTestnet } from "@/lib/chains";
import {
  robinhoodMainnetAddresses,
  robinhoodMainnetUniswap,
  robinhoodTestnetAddresses,
  robinhoodTestnetCreationReady,
  robinhoodTestnetDeploymentReady,
  robinhoodTestnetV4,
} from "@/lib/deployment";
import { productionAssetsForChain, testnetAssets, testnetVenue } from "@/lib/asset-catalog";
import {
  bestQueriedQuote,
  assetHasExecutableMetadata,
  classifySwapDirection,
  decimalAmount,
  decimalInputValue,
  ERC20_APPROVE_ABI,
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
import { ensureExactErc20Approval } from "@/lib/erc20-approval";
import { quoteCanonicalOtfSwap } from "@/lib/otf-market";
import { canonicalV4Execution } from "@/lib/canonical-v4-execution";
import {
  claimSwapCelebration,
  confirmedSwapReceipt,
  receiptRefundDisclosure,
  type SwapReceipt,
} from "@/lib/swap-receipt";
import {
  feeSettlementCall,
  pendingFeeShares,
  proportionalWethSplit,
  redemptionFeeSettlementRouteFromQuote,
  selectFeeSettlementRoute,
  shareSaleFeeSettlementRouteFromQuote,
  type FeeSettlementRoutePreference,
  type FeeSettlementRoutes,
} from "@/lib/fee-settlement";
import { readVaultSummary, useFactoryVaults, type FactoryVaultSummary } from "@/lib/use-factory-vaults";
import { formatAnnualExpenseRatioPercentage, parseFixedDecimal, type CreationAssetData } from "@/lib/creation-model";
import {
  formatMarketCapMultiplier,
  formatStoredPercentage,
  formatStoredPercentageExact,
  loadCreationMetadata,
  multiplierPosition,
  weightingMethodLabel,
  type OtfCreationMetadata,
} from "@/lib/creation-metadata";
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

function configuredAssetsFor(chainId: number): SwapAsset[] {
  const assets = chainId === robinhoodChainTestnet.id
    ? testnetAssets
    : chainId === robinhoodChain.id
      ? productionAssetsForChain(chainId)
      : [];
  const configured = assets.map((asset): SwapAsset => ({
    address: asset.address,
    symbol: asset.symbol,
    name: asset.name,
    kind: "erc20",
    decimals: asset.decimals,
    metadataResolved: true,
    verified: true,
  }));
  const canonicalWeth = chainId === robinhoodChainTestnet.id
    ? robinhoodTestnetAddresses.weth
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
    verified: true,
  });
  const protocolToken = chainId === robinhoodChainTestnet.id
    ? robinhoodTestnetAddresses.otfToken
    : chainId === robinhoodChain.id
      ? robinhoodMainnetAddresses.otfToken
      : undefined;
  if (protocolToken) configured.push({
    address: protocolToken,
    symbol: "OTF",
    name: "OTF Protocol Token",
    kind: "erc20",
    decimals: 18,
    metadataResolved: true,
    verified: true,
    isProtocolToken: true,
  });
  return configured;
}

function configuredUsdgFor(chainId: number): SwapAsset | undefined {
  return configuredAssetsFor(chainId).find((asset) => asset.symbol === "USDG");
}

function configuredNativeFor(chainId: number): SwapAsset | undefined {
  return configuredAssetsFor(chainId).find((asset) => asset.kind === "native");
}

function configuredWethFor(chainId: number): SwapAsset | undefined {
  return configuredAssetsFor(chainId).find((asset) => asset.kind === "erc20" && asset.symbol === "WETH");
}

function configuredDefaultInputFor(chainId: number): SwapAsset | undefined {
  return configuredNativeFor(chainId) ?? configuredWethFor(chainId);
}

function configuredProtocolTokenFor(chainId: number): SwapAsset | undefined {
  return configuredAssetsFor(chainId).find((asset) => asset.isProtocolToken === true);
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
  if (asset.isProtocolToken) mark = <Image className="swapAssetImage" src={circularOtfIcon} alt="" width={30} height={30} />;
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
  const label = `${balance.formatted} ${symbol}`;
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
              <span><strong>{asset.symbol}</strong><small>{asset.name}</small></span>
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
      <span>Onchain Traded Funds · experimental, unaudited software</span>
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
  inputSymbol,
  outputSymbol,
  now,
  executionConfigured,
}: {
  quotes: SwapQuote[];
  activeQuote?: SwapQuote;
  onChoose: (quote: SwapQuote) => void;
  onRefresh: () => void;
  inputSymbol: string;
  outputSymbol: string;
  now: number;
  executionConfigured: boolean;
}) {
  const selectedValid = Boolean(activeQuote && quoteIsFresh(activeQuote, now));
  const executionTarget = activeQuote?.execution?.kind === "direct-api"
    ? activeQuote.execution.universalRouter
    : activeQuote?.execution?.kind === "direct-v3"
      ? activeQuote.execution.swapRouter02
      : activeQuote?.execution?.router;
  return (
    <details className="swapReview">
      <summary><span>Quote details</span><small>{selectedValid ? activeQuote?.routeLabel : "No executable quote"}</small><ChevronDown size={15} /></summary>
      <div className="swapReviewBody">
        <div className="swapReviewHeader"><strong>Compared routes</strong><button type="button" onClick={onRefresh}><LoaderCircle size={13} />Refresh</button></div>
        <div className="swapRoutes">
          {quotes.map((quote) => {
            const valid = quoteIsFresh(quote, now);
            return (
              <button key={quote.id} type="button" className={`swapRoute ${activeQuote?.id === quote.id ? "selected" : ""}`} disabled={!valid} onClick={() => onChoose(quote)}>
                <span><strong>{quote.routeLabel}</strong><small>{quote.reason || (valid ? "Quoted route" : "Unavailable")}</small></span>
                <span className={`swapRouteState ${valid ? "ready" : ""}`}>{valid ? activeQuote?.id === quote.id ? "Selected" : "Use route" : quote.state === "loading" ? <ActivitySpinner size={13} /> : quote.state}</span>
              </button>
            );
          })}
        </div>
        <dl className="swapQuoteMetrics">
          <div><dt>Expected output</dt><dd>{selectedValid ? `${activeQuote?.expectedOutput ?? activeQuote?.outputAmount} ${outputSymbol}` : "—"}</dd></div>
          <div><dt>Minimum received</dt><dd>{selectedValid ? `${activeQuote?.minimumReceived ?? "—"} ${outputSymbol}` : "—"}</dd></div>
          <div><dt>Venue fees</dt><dd>{selectedValid && activeQuote?.venueFeeBps !== undefined ? `${activeQuote.venueFeeBps / 100}%` : "—"}</dd></div>
          <div><dt>Price impact</dt><dd>{selectedValid && activeQuote?.priceImpactBps !== undefined ? `${activeQuote.priceImpactBps / 100}%` : "—"}</dd></div>
          <div><dt>Route</dt><dd>{selectedValid ? activeQuote?.routeLabel : "No valid route selected"}</dd></div>
          <div><dt>Network gas</dt><dd>{selectedValid ? activeQuote?.gasEstimate ?? "Unavailable" : "—"}</dd></div>
          <div><dt>Execution target</dt><dd>{selectedValid && executionTarget ? shortAddress(executionTarget) : "—"}</dd></div>
        </dl>
        <div className="swapRouteInspection">
          <strong>Route inspection</strong>
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
          ) : <p>No executable hop details are available for inspection.</p>}
        </div>
        {selectedValid && activeQuote?.residualRefunds?.length ? (
          <div className="swapRouteRefunds">
            <strong>Expected residual refunds</strong>
            <ul>{activeQuote.residualRefunds.map((refund) => <li key={refund.token}>{refund.displayAmount ?? refund.amount.toString()} · {shortAddress(refund.token)}</li>)}</ul>
          </div>
        ) : null}
        <p className="swapRouteDisclosure">The selected result is the best queried route by integer expected output. It is not a claim of best price across all venues.</p>
        <p className="swapRouteDisclosure">{executionConfigured
          ? "The selected typed plan is bound to this wallet, chain, amount, expiry, and configured target. A stale quote is never actionable."
          : "This route has no compatible execution target. No approval, simulation, or transaction can start."}</p>
        <span className="swapPairLine">Input: {inputSymbol} · Output: {outputSymbol}</span>
      </div>
    </details>
  );
}

const SWAP_CONFETTI_PIECES = Array.from({ length: 18 }, (_, index) => ({
  x: (index % 6 - 2.5) * 44 + (index % 2 ? 12 : -8),
  y: 92 + (index % 4) * 18,
  rotation: (index % 2 ? 1 : -1) * (110 + index * 19),
  delay: (index % 5) * 18,
  color: index % 3 === 0 ? "var(--teal)" : index % 3 === 1 ? "var(--gold)" : "var(--text-muted)",
}));

function SwapConfetti({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="swapConfetti" aria-hidden="true">
      {SWAP_CONFETTI_PIECES.map((piece, index) => (
        <span
          key={index}
          style={{
            "--confetti-x": `${piece.x}px`,
            "--confetti-y": `${piece.y}px`,
            "--confetti-rotation": `${piece.rotation}deg`,
            "--confetti-delay": `${piece.delay}ms`,
            "--confetti-color": piece.color,
          } as CSSProperties}
        />
      ))}
    </div>
  );
}

function SwapReceiptPanel({ receipt, onBack }: { receipt: SwapReceipt; onBack: () => void }) {
  const [refundsExpanded, setRefundsExpanded] = useState(false);
  const refundDisclosure = receiptRefundDisclosure(receipt.refunds, refundsExpanded);
  return (
    <div className="swapReceipt" aria-labelledby="swap-receipt-title">
      <button type="button" className="swapReceiptBack" onClick={onBack}><ArrowLeft size={14} />Back to swap</button>
      <div className="swapReceiptHeading">
        <span className="swapReceiptConfirmedIcon"><Check size={25} strokeWidth={2.2} /></span>
        <h2 id="swap-receipt-title">Swap complete</h2>
      </div>
      <div className="swapReceiptResult" aria-live="polite">
        {receipt.sold ? <p><span>You sold</span><strong>{receipt.sold.displayAmount} {receipt.sold.symbol}</strong></p> : null}
        <p><span>You received</span><strong>{receipt.received.displayAmount} {receipt.received.symbol}</strong></p>
      </div>
      {receipt.refunds.length ? (
        <section className="swapReceiptRefunds" aria-labelledby="swap-refunds-title">
          <div><h3 id="swap-refunds-title">Also returned</h3><p>Surplus from basket execution</p></div>
          <ul className={refundsExpanded ? "expanded" : undefined}>
            {refundDisclosure.visible.map((refund) => <li key={refund.address}><span>{refund.displayAmount}</span><strong>{refund.symbol}</strong></li>)}
          </ul>
          {refundDisclosure.hiddenCount ? <button type="button" onClick={() => setRefundsExpanded(true)}>Show {refundDisclosure.hiddenCount} more</button> : refundsExpanded && receipt.refunds.length > 4 ? <button type="button" onClick={() => setRefundsExpanded(false)}>Show less</button> : null}
        </section>
      ) : null}
      <Link className="swapPrimary swapReceiptPrimary" href={receipt.fundHref}>View {receipt.fund.symbol}<ArrowRight size={14} /></Link>
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
  const configuredAssets = useMemo(() => configuredAssetsFor(chainId), [chainId]);
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
  const pinnedAsset = protocolTokenMode ? configuredProtocolTokenFor(chainId) : embeddedFund;
  const [input, setInput] = useState<SwapAsset>(() => configuredDefaultInputFor(chainId) ?? EMPTY_ERC20);
  const [output, setOutput] = useState<SwapAsset>(() => embeddedFund ?? (protocolTokenMode ? configuredProtocolTokenFor(chainId) ?? EMPTY_OTF : EMPTY_OTF));
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);
  const [swapSettingsOpen, setSwapSettingsOpen] = useState(false);
  const [picker, setPicker] = useState<"input" | "output">();
  const [quotes, setQuotes] = useState<SwapQuote[]>([]);
  const [activeQuote, setActiveQuote] = useState<SwapQuote>();
  const [quoteRequest, setQuoteRequest] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [execution, setExecution] = useState<"idle" | "approval" | "simulation" | "submission" | "success" | "failure">("idle");
  const [executionMessage, setExecutionMessage] = useState<string>();
  const [preflightMessage, setPreflightMessage] = useState<string>();
  const [swapReceipt, setSwapReceipt] = useState<SwapReceipt>();
  const [receiptStageHeight, setReceiptStageHeight] = useState<number>();
  const [confettiActive, setConfettiActive] = useState(false);
  const swapSettingsRef = useRef<HTMLDivElement>(null);
  const swapStageRef = useRef<HTMLDivElement>(null);
  const celebratedSwapsRef = useRef(new Set<string>());
  const confettiTimerRef = useRef<number | undefined>(undefined);
  const amountInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (confettiTimerRef.current !== undefined) window.clearTimeout(confettiTimerRef.current);
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
  const configuredWeth = configuredWethFor(chainId);
  const nativeWrapPair = isNativeWrapPair(input, output, configuredWeth?.address);
  const missingOtfAsset = pairValid && !hasOtfSide && !nativeWrapPair;
  const protocolToken = robinhoodTestnetAddresses.otfToken;
  const canonicalWeth = robinhoodTestnetAddresses.weth;
  const launchManager = robinhoodTestnetAddresses.launchManager;
  const canonicalOtfPair = Boolean(
    chainId === robinhoodChainTestnet.id
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
  ] as const;
  const { data: canonicalPoolReads } = useReadContracts({
    contracts: canonicalReadContracts,
    query: { enabled: canonicalOtfPair && Boolean(launchManager), refetchInterval: 12_000 },
  });
  const canonicalPhase = Number(canonicalPoolReads?.[0]?.result ?? 0);
  const canonicalAmountRaw = amountValid ? decimalAmount(amount, input.decimals) : undefined;
  const canonicalQuote = useMemo(() => {
    const poolState = canonicalPoolReads?.[1]?.result;
    const otfPriceWethWad = canonicalPoolReads?.[2]?.result;
    const initialSqrtPriceX96 = canonicalPoolReads?.[3]?.result;
    const finalSqrtPriceX96 = canonicalPoolReads?.[4]?.result;
    const otfIsCurrency0 = canonicalPoolReads?.[5]?.result;
    const bootstrapLiquidity = canonicalPoolReads?.[6]?.result;
    const permanentLiquidity = canonicalPoolReads?.[7]?.result;
    if (!canonicalOtfPair || !canonicalAmountRaw || !poolState || otfPriceWethWad === undefined
      || initialSqrtPriceX96 === undefined || finalSqrtPriceX96 === undefined || otfIsCurrency0 === undefined) return undefined;
    const liquidity = canonicalPhase === 3 ? permanentLiquidity : bootstrapLiquidity;
    if (!liquidity) return undefined;
    const bootstrapLower = initialSqrtPriceX96 < finalSqrtPriceX96 ? initialSqrtPriceX96 : finalSqrtPriceX96;
    const bootstrapUpper = initialSqrtPriceX96 > finalSqrtPriceX96 ? initialSqrtPriceX96 : finalSqrtPriceX96;
    try {
      return quoteCanonicalOtfSwap({
        side: input.isProtocolToken ? "sell" : "buy",
        amountIn: canonicalAmountRaw,
        slippageBps,
        sqrtPriceX96: poolState[0],
        liquidity,
        lowerSqrtPriceX96: canonicalPhase === 3 ? FULL_RANGE_LOWER_SQRT : bootstrapLower,
        upperSqrtPriceX96: canonicalPhase === 3 ? FULL_RANGE_UPPER_SQRT : bootstrapUpper,
        otfIsCurrency0,
        otfPriceWethWad,
      });
    } catch {
      return undefined;
    }
  }, [canonicalAmountRaw, canonicalOtfPair, canonicalPhase, canonicalPoolReads, input.isProtocolToken, slippageBps]);
  const canonicalQuoteUsable = Boolean(canonicalQuote?.fullyFilled && (canonicalPhase === 1 || canonicalPhase === 3));
  const usableQuote = nativeWrapPair ? amountValid : canonicalOtfPair ? canonicalQuoteUsable : Boolean(activeQuote && quoteIsFresh(activeQuote, now));
  const quoteService = useMemo(() => quoteServiceForChain(chainId), [chainId]);
  const executionPlan = useMemo(() => executionPlanForQuote(activeQuote, chainId, now), [activeQuote, chainId, now]);
  const executionConfigured = executionPlan?.kind === "direct-api"
    ? chainId === robinhoodChain.id && robinhoodMainnetUniswap.universalRouter?.toLowerCase() === executionPlan.universalRouter.toLowerCase()
    : executionPlan?.kind === "direct-v3"
      ? chainId === robinhoodChainTestnet.id && executionPlan.swapRouter02.toLowerCase() === testnetVenue.swapRouter02.toLowerCase()
      : executionPlan?.kind === "basket-router" && robinhoodTestnetDeploymentReady;
  const quoteNetworkConfigured = nativeWrapPair ? Boolean(configuredWeth) : chainId === robinhoodChain.id || robinhoodTestnetDeploymentReady;
  const routingLabel = nativeWrapPair
    ? "Native wrap · 1:1"
    : chainId === robinhoodChain.id
      ? "Mainnet · Uniswap API"
      : canonicalOtfPair
        ? "Testnet · Canonical V4"
        : chainId === robinhoodChainTestnet.id
          ? "Testnet · Synthra V3"
          : "Unsupported network";
  const inputSelected = input.address !== zeroAddress;
  const outputSelected = output.address !== zeroAddress;
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
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
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

  useEffect(() => {
    if (protocolTokenMode) {
      setInput(configuredDefaultInputFor(chainId) ?? EMPTY_ERC20);
      setOutput(configuredProtocolTokenFor(chainId) ?? EMPTY_OTF);
      return;
    }
    if (embedded) {
      const networkUsdg = configuredUsdgFor(chainId);
      setInput((current) => current.verified ? networkUsdg ?? EMPTY_ERC20 : current);
      setOutput((current) => current.verified ? EMPTY_ERC20 : current);
      return;
    }
    setInput(configuredDefaultInputFor(chainId) ?? EMPTY_ERC20);
    setOutput(EMPTY_OTF);
  }, [chainId, embedded, protocolTokenMode]);

  useEffect(() => {
    if (nativeWrapPair) {
      setQuotes([]);
      setActiveQuote(undefined);
      setPreflightMessage(undefined);
      return;
    }
    if (canonicalOtfPair) {
      setQuotes([]);
      setActiveQuote(undefined);
      setPreflightMessage(undefined);
      return;
    }
    if (!pairValid || !pairExecutable || !directionSupported || !amountValid || !supportedNetwork) {
      setQuotes([]);
      setActiveQuote(undefined);
      setPreflightMessage(undefined);
      return;
    }
    const requestedAt = Date.now();
    const request = { chainId, input, output, inputAmount: amount, slippageBps, requestedAt, caller: address };
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
    setPreflightMessage(undefined);
    let cancelled = false;
    void (async () => {
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
      const nextQuotes = enforceFirstPurchaseMinimum(
        await requestConcurrentQuotes(quoteService, request),
        output,
        outputTotalSupply,
      );
      if (cancelled) return;
      setQuotes(nextQuotes);
      setActiveQuote(bestQueriedQuote(nextQuotes, Date.now()));
    })().catch(() => {
      if (!cancelled) setQuotes([]);
    });
    return () => { cancelled = true; };
  }, [address, amount, amountValid, canonicalOtfPair, chainId, directionSupported, input, nativeWrapPair, output, pairExecutable, pairValid, publicClient, quoteRequest, quoteService, slippageBps, supportedNetwork]);

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
    setPreflightMessage(undefined);
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
      hash,
      owner: address!,
      pair: { input, output },
      logs: transactionReceipt.logs,
      knownAssets: [...configuredAssets, ...otfAssets, input, output],
      refundSender,
      confirmedOutputAmount,
    });

    setExecution("success");
    setExecutionMessage(`Swap submitted and confirmed: ${shortAddress(hash)}.`);
    if (!nextReceipt) return;

    setReceiptStageHeight(swapStageRef.current?.offsetHeight);
    setSwapReceipt(nextReceipt);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (claimSwapCelebration(hash, reducedMotion, celebratedSwapsRef.current, window.sessionStorage)) {
      setConfettiActive(true);
      if (confettiTimerRef.current !== undefined) window.clearTimeout(confettiTimerRef.current);
      confettiTimerRef.current = window.setTimeout(() => setConfettiActive(false), 850);
    }
  }

  function backToSwap() {
    if (confettiTimerRef.current !== undefined) window.clearTimeout(confettiTimerRef.current);
    confettiTimerRef.current = undefined;
    setConfettiActive(false);
    setSwapReceipt(undefined);
    setReceiptStageHeight(undefined);
    setAmount("");
    setQuotes([]);
    setActiveQuote(undefined);
    setExecution("idle");
    setExecutionMessage(undefined);
    setPreflightMessage(undefined);
    setPicker(undefined);
    setSwapSettingsOpen(false);
  }

  async function executeSwap() {
    if (!address || !publicClient || !walletClient) return;
    if (nativeWrapPair) {
      if (!configuredWeth || !inputAmountRaw) return;
      const wrapping = input.kind === "native";
      const data = wrapping
        ? encodeFunctionData({ abi: WETH_ABI, functionName: "deposit" })
        : encodeFunctionData({ abi: WETH_ABI, functionName: "withdraw", args: [inputAmountRaw] });
      const value = wrapping ? inputAmountRaw : 0n;
      try {
        setExecutionMessage(undefined);
        setPreflightMessage(undefined);
        setExecution("simulation");
        await publicClient.call({ account: address, to: configuredWeth.address, data, value });
        const gas = await publicClient.estimateGas({ account: address, to: configuredWeth.address, data, value });
        setPreflightMessage(`${wrapping ? "Wrap" : "Unwrap"} preflight passed · 1:1 output · gas estimate ${gas.toLocaleString()}.`);
        setExecution("submission");
        const hash = await walletClient.sendTransaction({ account: address, to: configuredWeth.address, data, value });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error(`The WETH ${wrapping ? "wrap" : "unwrap"} reverted.`);
        setExecution("success");
        setExecutionMessage(`${wrapping ? "Wrapped ETH to WETH" : "Unwrapped WETH to ETH"}: ${shortAddress(hash)}.`);
        await Promise.all([refetchInputBalance(), refetchOutputBalance()]);
      } catch (error) {
        setExecution("failure");
        setExecutionMessage(error instanceof Error ? error.message : `The WETH ${wrapping ? "wrap" : "unwrap"} failed.`);
      }
      return;
    }
    if (canonicalOtfPair) {
      if (!canonicalQuoteUsable || !canonicalQuote || !canonicalAmountRaw || !launchManager) return;
      const universalRouter = robinhoodTestnetV4.universalRouter;
      const permit2 = robinhoodTestnetV4.permit2;
      if (!universalRouter || (input.kind !== "native" && !permit2)) {
        setExecution("failure");
        setExecutionMessage("The canonical V4 router or Permit2 address is not configured.");
        return;
      }
      try {
        setExecutionMessage(undefined);
        setPreflightMessage(undefined);
        setExecution(input.kind === "native" ? "simulation" : "approval");
        const deadline = BigInt(Math.floor(Date.now() / 1_000) + 10 * 60);
        if (input.kind !== "native") {
          const allowance = await publicClient.readContract({
            address: input.address,
            abi: ERC20_APPROVE_ABI,
            functionName: "allowance",
            args: [address, permit2!],
          });
          await ensureExactErc20Approval(allowance, canonicalAmountRaw, async (approvalAmount) => {
            const approvalHash = await walletClient.writeContract({
              account: address,
              address: input.address,
              abi: ERC20_APPROVE_ABI,
              functionName: "approve",
              args: [permit2!, approvalAmount],
            });
            const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash });
            if (approvalReceipt.status !== "success") throw new Error(approvalAmount === 0n ? "The Permit2 approval reset reverted." : "The exact Permit2 approval reverted.");
          });
          const permitHash = await walletClient.writeContract({
            account: address,
            address: permit2!,
            abi: PERMIT2_APPROVE_ABI,
            functionName: "approve",
            args: [input.address, universalRouter, canonicalAmountRaw, Number(deadline)],
          });
          const permitReceipt = await publicClient.waitForTransactionReceipt({ hash: permitHash });
          if (permitReceipt.status !== "success") throw new Error("The Universal Router Permit2 approval reverted.");
        }
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
        setExecution("simulation");
        await publicClient.call({ account: address, to: universalRouter, data: canonicalExecution.data, value: canonicalExecution.value });
        const gas = await publicClient.estimateGas({ account: address, to: universalRouter, data: canonicalExecution.data, value: canonicalExecution.value });
        setPreflightMessage(`Canonical V4 preflight passed · gas estimate ${gas.toLocaleString()} · minimum ${formatUnits(canonicalQuote.minimumReceived, output.decimals)} ${output.symbol}.`);
        setExecution("submission");
        const outputBalanceBefore = await readOutputBalance();
        const hash = await walletClient.sendTransaction({ account: address, to: universalRouter, data: canonicalExecution.data, value: canonicalExecution.value });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("The canonical OTF swap reverted.");
        await finishConfirmedSwap(hash, receipt, outputBalanceBefore, canonicalExecution.value);
        await Promise.all([refetchInputBalance(), refetchOutputBalance()]);
      } catch (error) {
        setExecution("failure");
        setExecutionMessage(error instanceof Error ? error.message : "The canonical OTF swap failed.");
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
      setPreflightMessage(undefined);
      setExecution(
        executionPlan.kind === "direct-api"
          ? executionPlan.nativeInput ? "simulation" : "approval"
          : executionPlan.kind === "basket-router" && !executionPlan.approval
            ? "simulation"
            : "approval",
      );
      let target: Address;
      let data: Hex;
      let value = 0n;
      let preflight: string;
      if (executionPlan.kind === "direct-api") {
        if (robinhoodMainnetUniswap.universalRouter?.toLowerCase() !== executionPlan.universalRouter.toLowerCase()) throw new Error("The direct plan has an unsupported Universal Router target.");
        for (const authorization of [executionPlan.cancel, executionPlan.approval]) {
          if (!authorization) continue;
          const authorizationHash = await walletClient.sendTransaction({ account: address, to: authorization.to, data: authorization.data, value: authorization.value });
          const authorizationReceipt = await publicClient.waitForTransactionReceipt({ hash: authorizationHash });
          if (authorizationReceipt.status !== "success") throw new Error("The required Permit2 token authorization reverted.");
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
        const finalized = await quoteService.finalizeDirect(executionPlan, signature);
        if (!finalized.transaction) throw new Error("Uniswap did not return a final transaction.");
        target = finalized.transaction.to;
        data = finalized.transaction.data;
        value = finalized.transaction.value;
        setExecution("simulation");
        await publicClient.call({ account: address, to: target, data, value });
        const gas = await publicClient.estimateGas({ account: address, to: target, data, value });
        preflight = `Exact direct-swap preflight passed · gas estimate ${gas.toLocaleString()} · minimum ${activeQuote?.minimumReceived ?? "—"} ${output.symbol}.`;
      } else if (executionPlan.kind === "direct-v3") {
        if (executionPlan.swapRouter02.toLowerCase() !== testnetVenue.swapRouter02.toLowerCase()) throw new Error("The direct plan has an unsupported Synthra router target.");
        const allowance = await publicClient.readContract({
          address: executionPlan.approval.token,
          abi: ERC20_APPROVE_ABI,
          functionName: "allowance",
          args: [address, executionPlan.approval.spender],
        });
        await ensureExactErc20Approval(allowance, executionPlan.approval.amount, async (approvalAmount) => {
          const approvalHash = await walletClient.writeContract({
            account: address,
            address: executionPlan.approval.token,
            abi: ERC20_APPROVE_ABI,
            functionName: "approve",
            args: [executionPlan.approval.spender, approvalAmount],
          });
          const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash });
          if (approvalReceipt.status !== "success") throw new Error(approvalAmount === 0n ? "The Synthra approval reset reverted." : "The exact Synthra approval reverted.");
        });
        target = executionPlan.transaction.to;
        data = executionPlan.transaction.data;
        value = executionPlan.transaction.value;
        setExecution("simulation");
        await publicClient.call({ account: address, to: target, data, value });
        const gas = await publicClient.estimateGas({ account: address, to: target, data, value });
        preflight = `Exact Synthra V3 preflight passed · gas estimate ${gas.toLocaleString()} · minimum ${activeQuote?.minimumReceived ?? "—"} ${output.symbol}.`;
      } else {
        if (robinhoodTestnetAddresses.entryRouter?.toLowerCase() !== executionPlan.router.toLowerCase()) throw new Error("The basket plan has an unsupported entry-router target.");
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
        const gas = await publicClient.estimateGas({ account: address, to: target, data, value });
        if (!result.data) throw new Error("The basket preflight returned no result data.");
        const decoded = decodeFunctionResult({
          abi: otfEntryExitRouterAbi,
          functionName: executionPlan.call.method,
          data: result.data,
        } as never) as unknown as readonly [bigint, readonly Address[], readonly bigint[], bigint?];
        const refundSummary = decoded[1].length
          ? decoded[1].map((token, index) => `${decoded[2][index]?.toString() ?? "0"} ${shortAddress(token)}`).join(", ")
          : "none";
        const nativeRefund = decoded[3] ? ` · native refund ${formatUnits(decoded[3], 18)} ETH` : "";
        preflight = `Exact basket preflight passed · output ${formatUnits(decoded[0], output.decimals)} ${output.symbol} · refunds ${refundSummary}${nativeRefund} · gas estimate ${gas.toLocaleString()}.`;
      }
      setPreflightMessage(preflight);
      setExecution("submission");
      const outputBalanceBefore = await readOutputBalance();
      const hash = await walletClient.sendTransaction({ account: address, to: target, data, value });
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
      setExecutionMessage(error instanceof Error ? error.message : "The wallet, approval, simulation, or transaction failed.");
    }
  }

  const executionBusy = execution === "approval" || execution === "simulation" || execution === "submission";
  const canonicalExecutionConfigured = Boolean(launchManager && robinhoodTestnetV4.universalRouter && (input.kind === "native" || robinhoodTestnetV4.permit2));
  const canExecute = Boolean(address && publicClient && walletClient && pairExecutable && !insufficientBalance && !executionBusy && (
    nativeWrapPair
      ? amountValid && configuredWeth
      : canonicalOtfPair
      ? canonicalQuoteUsable && canonicalExecutionConfigured
      : executionPlan && executionConfigured
  ));
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
                      ? "On testnet, OTFs can swap only against USDG, WETH, or another OTF."
                      : "This OTF pair is unsupported."
                  : quotes.some((quote) => quote.state === "loading")
                    ? "Finding the best available queried route…"
                    : canonicalOtfPair && amountValid && !usableQuote
                      ? canonicalPhase === 2
                        ? "The canonical OTF pool is waiting for graduation finalization."
                        : "The canonical OTF pool could not quote this amount."
                    : quotes.length && !usableQuote
                      ? "No executable quote is currently available."
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
    return <button type="button" className="swapAssetButton" aria-label={`Select token to ${which === "input" ? "pay" : "receive"}`} onClick={() => setPicker(which)}><AssetMark asset={asset} /><strong className={isUnselectedOtf(asset) ? "swapAssetPlaceholder" : undefined}>{isUnselectedOtf(asset) ? "—" : asset.symbol}</strong><ChevronDown size={15} /></button>;
  }

  function cappedSwapAmount(value: string, asset: SwapAsset) {
    return decimalInputValue(value, Math.min(asset.decimals, MAX_SWAP_FRACTION_DIGITS)) ?? "0";
  }

  const swapCard = (
        <section className={`swapCard${swapReceipt ? " showReceipt" : ""}`} aria-label={embeddedFund ? `Swap ${embeddedFund.symbol}` : "Swap tokens"}>
          <SwapConfetti active={confettiActive} />
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
                  <div className="swapAmountEntry"><output aria-label={`Expected ${output.symbol} output`}>{cappedSwapAmount(usableQuote ? nativeWrapPair ? amount : canonicalOtfPair && canonicalQuote ? formatUnits(canonicalQuote.amountOut, output.decimals) : activeQuote?.outputAmount ?? "0" : "0", output)}</output><div className="swapAssetColumn">{assetControl("output", output)}<span className="swapBalanceSlot"><SwapBalance active={outputBalanceEnabled} loading={outputBalanceLoading} balance={outputBalance} symbol={output.symbol} /></span></div></div>
                </div>
              </div>
              <button type="button" className="swapPrimary" disabled={missingOtfAsset || (address && supportedNetwork ? !canExecute : false)} onClick={handlePrimaryAction}>{executionBusy ? <ActivitySpinner size={14} /> : null}{primaryLabel}</button>
              {statusMessage ? <p className={`swapStatusLine ${execution === "failure" ? "failure" : execution === "success" ? "success" : ""}`} aria-live="polite">{quotes.some((quote) => quote.state === "loading") ? <ActivitySpinner size={13} /> : null}{statusMessage}</p> : null}
              {preflightMessage ? <p className="swapPreflight" aria-live="polite">{preflightMessage}</p> : null}
              {quotes.length ? <QuoteReview quotes={quotes} activeQuote={activeQuote} onChoose={(quote) => { setActiveQuote(quote); setExecution("idle"); setExecutionMessage(undefined); setPreflightMessage(undefined); }} onRefresh={() => setQuoteRequest((current) => current + 1)} inputSymbol={input.symbol} outputSymbol={output.symbol} now={now} executionConfigured={Boolean(executionConfigured)} /> : null}
            </div>
            {swapReceipt ? <div className="swapCardPane swapReceiptPane"><SwapReceiptPanel receipt={swapReceipt} onBack={backToSwap} /></div> : null}
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
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!address || !transactionHash || chainId !== robinhoodChainTestnet.id || !publicClient) {
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
  return (
    <DashboardPage className="fundsPage">
      <div className="appView">
        <section className="createdConfirmation" aria-labelledby="created-otf-title">
          <div className="createdStatus">
            <span className={`createdStatusIcon ${confirmation === "failure" ? "failure" : ""}`}>{confirmation === "confirmed" ? <Check size={24} /> : confirmation === "failure" ? <X size={22} /> : <LoaderCircle className="createAssetSpinner" size={22} />}</span>
            <div>
              <h2 id="created-otf-title">{confirmation === "confirmed" ? details?.name ?? "Deployment confirmed" : confirmation === "failure" ? "Unable to verify launch" : "Verifying onchain confirmation"}</h2>
              <p>{confirmation === "confirmed" ? `${details?.symbol ? `$${details.symbol}` : "The new OTF"} is live. Deposits are opening and fees will start accruing to the selected address.` : confirmation === "failure" ? "Use the transaction explorer link below to inspect its status before trying again." : "The fund-page link will appear after the factory launch event is verified."}</p>
            </div>
          </div>
          {address ? (
            <div className="createdAddressBlock">
              <div><span>OTF contract address</span><code>{address}</code></div>
              <div className="createdAddressActions">
                <button className="iconOnly" type="button" onClick={() => void copyAddress()} title="Copy OTF address" aria-label="Copy OTF address">{copied ? <Check size={15} /> : <Copy size={15} />}</button>
                <a className="iconOnly" href={`${robinhoodChainTestnet.blockExplorers.default.url}/address/${address}`} target="_blank" rel="noreferrer" title="Open OTF in explorer" aria-label="Open OTF in explorer"><ExternalLink size={15} /></a>
              </div>
            </div>
          ) : null}
          {copied ? <span className="createdCopyFeedback" role="status" aria-live="polite">Address copied</span> : null}
          <div className="createdDetails" aria-label="Created OTF details">
            <section className="createdDetailGroup" aria-labelledby="created-fund-details-title">
              <h3 id="created-fund-details-title">Fund</h3>
              <div><span>Symbol</span><strong>{details?.symbol ?? "—"}</strong></div>
              <div><span>Assets</span><strong>{details?.assetCount ?? "—"}</strong></div>
              <div><span>Creator</span><strong>{details ? shortAddress(details.creator) : "—"}</strong></div>
            </section>
            <section className="createdDetailGroup" aria-labelledby="created-fee-details-title">
              <h3 id="created-fee-details-title">Fees</h3>
              <div><span>Creator</span><strong>{details ? formatAnnualExpenseRatioPercentage(details.annualCreatorExpenseRatioBps) : "—"}</strong></div>
              <div><span>Mint</span><strong>{details ? formatAnnualExpenseRatioPercentage(details.mintFeeBps) : "—"}</strong></div>
              <div><span>Redeem</span><strong>{details ? formatAnnualExpenseRatioPercentage(details.redeemFeeBps) : "—"}</strong></div>
            </section>
          </div>
          {transactionHash ? <a className="createdTransactionLink" href={`${robinhoodChainTestnet.blockExplorers.default.url}/tx/${transactionHash}`} target="_blank" rel="noreferrer"><ReceiptText size={15} /><span>View launch transaction</span><code>{shortAddress(transactionHash)}</code><ExternalLink size={14} /></a> : null}
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
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId });
  const { data: walletClient } = useWalletClient({ chainId });
  const collector = robinhoodTestnetAddresses.buybackCollector;
  const canonicalWeth = robinhoodTestnetAddresses.weth;
  const launchManager = robinhoodTestnetAddresses.launchManager;
  const settlementAdapter = robinhoodTestnetAddresses.uniswapV3Adapter;
  const configured = chainId === robinhoodChainTestnet.id
    && Boolean(collector && canonicalWeth && launchManager && settlementAdapter && robinhoodTestnetDeploymentReady);
  const [slippageBps, setSlippageBps] = useState(50);
  const [routePreference, setRoutePreference] = useState<FeeSettlementRoutePreference>("best");
  const [quoteState, setQuoteState] = useState<"idle" | "loading" | "ready" | "missing">("idle");
  const [settlementRoutes, setSettlementRoutes] = useState<FeeSettlementRoutes>({});
  const [quoteRequest, setQuoteRequest] = useState(0);
  const [claimState, setClaimState] = useState<FeeClaimTransactionState>("idle");
  const [claimHash, setClaimHash] = useState<Hex>();
  const collectorAddress = collector ?? zeroAddress;
  const feeReads = useReadContracts({
    contracts: [
      { address: collectorAddress, abi: buybackCollectorAbi, functionName: "feeAccounts", args: [vault] },
      { address: vault, abi: managedOtfVaultAbi, functionName: "previewExpenseFees" },
    ],
    query: { enabled: configured, refetchInterval: 12_000 },
  });
  const recorded = feeReads.data?.[0]?.result;
  const annual = feeReads.data?.[1]?.result;
  const accountMatches = Boolean(
    recorded
    && recorded[2].toLowerCase() === beneficiary.toLowerCase()
    && address?.toLowerCase() === beneficiary.toLowerCase(),
  );
  const pending = useMemo(() => recorded && annual
    ? pendingFeeShares(recorded[0], recorded[1], annual[1], annual[2])
    : undefined, [annual, recorded]);
  const quoteService = useMemo(() => quoteServiceForChain(chainId), [chainId]);

  useEffect(() => {
    setClaimState("idle");
    setClaimHash(undefined);
  }, [pending?.total, routePreference, slippageBps]);

  useEffect(() => {
    let cancelled = false;
    let refreshTimer: number | undefined;
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
      verified: true,
    };
    const request = {
      chainId,
      input,
      output,
      inputAmount: formatUnits(pending.total, 18),
      slippageBps,
      requestedAt,
      caller: collector,
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
      const shareSale = shareSaleQuote && quoteIsFresh(shareSaleQuote, now)
        ? shareSaleFeeSettlementRouteFromQuote(
            shareSaleQuote,
            vault,
            canonicalWeth,
            collector,
            settlementAdapter,
            testnetVenue.swapRouter02,
          )
        : undefined;
      const routes: FeeSettlementRoutes = {
        redemption: redemption?.shares === pending.total ? redemption : undefined,
        shareSale: shareSale?.shares === pending.total ? shareSale : undefined,
      };
      setSettlementRoutes(routes);
      setQuoteState(routes.redemption || routes.shareSale ? "ready" : "missing");
      const expiries = [
        routes.redemption ? redemptionQuote?.expiresAt : undefined,
        routes.shareSale ? shareSaleQuote?.expiresAt : undefined,
      ].filter((value): value is number => value !== undefined);
      if (expiries.length !== 0) {
        const refreshAfter = Math.max(1_000, Math.min(...expiries) - now + 25);
        refreshTimer = window.setTimeout(() => setQuoteRequest((current) => current + 1), refreshAfter);
      }
    }).catch(() => {
      if (!cancelled) {
        setSettlementRoutes({});
        setQuoteState("missing");
      }
    });
    return () => {
      cancelled = true;
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    };
  }, [accountMatches, canonicalWeth, chainId, collector, configured, pending, quoteRequest, quoteService, settlementAdapter, slippageBps, vault]);

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
    ],
    query: { enabled: configured && Boolean(settlementRoute), refetchInterval: 12_000 },
  });
  const minimumBuybackWeth = settlementRoute && pending
    ? proportionalWethSplit(settlementRoute.minWethOut, pending.creator, pending.buyback).buybackWeth
    : 0n;
  const minOtfOut = useMemo(() => {
    const phase = Number(canonicalReads.data?.[0]?.result ?? 0);
    const poolState = canonicalReads.data?.[1]?.result;
    const otfPriceWethWad = canonicalReads.data?.[2]?.result;
    const initialSqrtPriceX96 = canonicalReads.data?.[3]?.result;
    const finalSqrtPriceX96 = canonicalReads.data?.[4]?.result;
    const otfIsCurrency0 = canonicalReads.data?.[5]?.result;
    const bootstrapLiquidity = canonicalReads.data?.[6]?.result;
    const permanentLiquidity = canonicalReads.data?.[7]?.result;
    const liquidity = phase === 3 ? permanentLiquidity : bootstrapLiquidity;
    if (
      minimumBuybackWeth === 0n || !poolState || otfPriceWethWad === undefined
      || initialSqrtPriceX96 === undefined || finalSqrtPriceX96 === undefined
      || otfIsCurrency0 === undefined || !liquidity || (phase !== 1 && phase !== 3)
    ) return undefined;
    const lower = initialSqrtPriceX96 < finalSqrtPriceX96 ? initialSqrtPriceX96 : finalSqrtPriceX96;
    const upper = initialSqrtPriceX96 > finalSqrtPriceX96 ? initialSqrtPriceX96 : finalSqrtPriceX96;
    try {
      const quote = quoteCanonicalOtfSwap({
        side: "buy",
        amountIn: minimumBuybackWeth,
        slippageBps,
        sqrtPriceX96: poolState[0],
        liquidity,
        lowerSqrtPriceX96: phase === 3 ? FULL_RANGE_LOWER_SQRT : lower,
        upperSqrtPriceX96: phase === 3 ? FULL_RANGE_UPPER_SQRT : upper,
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
      setQuoteRequest((current) => current + 1);
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
              : feeReads.isError || !accountMatches
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
  state: "loading" | "ready" | "unavailable";
  current?: FundValuationSnapshot;
  history: FundValuationSnapshot[];
  usesBootstrapNav: boolean;
};

function valuationAsset(value: unknown): CreationAssetData | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const asset = value as Record<string, unknown>;
  if (
    typeof asset.address !== "string" || !isAddress(asset.address)
    || typeof asset.symbol !== "string" || typeof asset.name !== "string"
    || typeof asset.priceUsd !== "string" || typeof asset.marketCapUsd !== "string"
    || !Number.isInteger(asset.decimals)
  ) return undefined;
  return {
    address: getAddress(asset.address),
    symbol: asset.symbol,
    name: asset.name,
    decimals: Number(asset.decimals),
    priceUsd: asset.priceUsd,
    marketCapUsd: asset.marketCapUsd,
    priceUpdatedAt: typeof asset.priceUpdatedAt === "string" ? asset.priceUpdatedAt : undefined,
    verified: asset.verified === true,
  };
}

function useFundValuation(fund?: FactoryVaultSummary): FundValuation {
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId });
  const [valuation, setValuation] = useState<FundValuation>({ state: "loading", history: [], usesBootstrapNav: false });

  useEffect(() => {
    let cancelled = false;
    if (!fund || !publicClient || chainId !== robinhoodChainTestnet.id) {
      setValuation({ state: fund ? "unavailable" : "loading", history: [], usesBootstrapNav: false });
      return;
    }
    setValuation((current) => ({ ...current, state: "loading" }));
    const assetRequest = fetch(`/api/creation-assets?chainId=${chainId}`, { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("VALUATION_PRICES_UNAVAILABLE");
      return response.json() as Promise<{ data?: unknown[]; marketCapSnapshotAt?: unknown }>;
    });
    void Promise.all([
      assetRequest,
      publicClient.readContract({ address: fund.address, abi: managedOtfVaultAbi, functionName: "accountedBalances" }),
      publicClient.readContract({ address: fund.address, abi: managedOtfVaultAbi, functionName: "bootstrapBasketUnits" }),
    ]).then(([payload, accountedBalances, bootstrapUnits]) => {
      const prices = (payload.data ?? []).flatMap((value) => {
        const parsed = valuationAsset(value);
        return parsed ? [parsed] : [];
      });
      const priceByAddress = new Map(prices.map((asset) => [asset.address.toLowerCase(), asset]));
      const pricedAssets = fund.assets.map((address) => priceByAddress.get(address.toLowerCase()));
      if (pricedAssets.some((asset) => !asset) || accountedBalances.length !== fund.assets.length || bootstrapUnits.length !== fund.assets.length) {
        throw new Error("VALUATION_ASSET_METADATA_UNAVAILABLE");
      }
      const usdWadFor = (quantities: readonly bigint[]) => quantities.reduce((total, quantity, index) => {
        const asset = pricedAssets[index]!;
        const priceUsdWad = parseFixedDecimal(asset.priceUsd, 18);
        if (!priceUsdWad) throw new Error("VALUATION_PRICE_INVALID");
        return total + quantity * priceUsdWad / 10n ** BigInt(asset.decimals);
      }, 0n);
      const aumUsdWad = usdWadFor(accountedBalances);
      const usesBootstrapNav = fund.totalSupply === 0n;
      const navUsdWad = usesBootstrapNav
        ? usdWadFor(bootstrapUnits)
        : aumUsdWad * 10n ** 18n / fund.totalSupply;
      const at = typeof payload.marketCapSnapshotAt === "string" && Number.isFinite(Date.parse(payload.marketCapSnapshotAt))
        ? Date.parse(payload.marketCapSnapshotAt)
        : Date.now();
      const current = {
        at,
        navUsd: Number(formatUnits(navUsdWad, 18)),
        aumUsd: Number(formatUnits(aumUsdWad, 18)),
      };
      const storageKey = `otf:valuation-history:${chainId}:${fund.address.toLowerCase()}`;
      let history: FundValuationSnapshot[] = [];
      try {
        const stored = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]") as unknown;
        if (Array.isArray(stored)) {
          history = stored.flatMap((value) => {
            if (!value || typeof value !== "object" || Array.isArray(value)) return [];
            const row = value as Record<string, unknown>;
            return typeof row.at === "number" && Number.isFinite(row.at)
              && typeof row.navUsd === "number" && Number.isFinite(row.navUsd) && row.navUsd >= 0
              && typeof row.aumUsd === "number" && Number.isFinite(row.aumUsd) && row.aumUsd >= 0
              ? [{ at: row.at, navUsd: row.navUsd, aumUsd: row.aumUsd }]
              : [];
          });
        }
      } catch {
        history = [];
      }
      const previous = history.at(-1);
      const nextHistory = (previous && Math.abs(current.at - previous.at) < 5 * 60_000
        ? [...history.slice(0, -1), current]
        : [...history, current]).slice(-180);
      window.localStorage.setItem(storageKey, JSON.stringify(nextHistory));
      return { current, history: nextHistory, usesBootstrapNav };
    }).then((result) => {
      if (!cancelled) {
        setValuation({ state: "ready", ...result });
      }
    }).catch(() => {
      if (!cancelled) {
        setValuation({ state: "unavailable", history: [], usesBootstrapNav: false });
      }
    });
    return () => { cancelled = true; };
  }, [chainId, fund, publicClient]);

  return valuation;
}

function formatUsd(value: number | undefined, maximumFractionDigits = 2): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits });
}

type ValuationRange = "24h" | "7d" | "30d" | "all";

const VALUATION_RANGES: { label: string; value: ValuationRange; duration?: number }[] = [
  { label: "24H", value: "24h", duration: 24 * 60 * 60_000 },
  { label: "7D", value: "7d", duration: 7 * 24 * 60 * 60_000 },
  { label: "30D", value: "30d", duration: 30 * 24 * 60 * 60_000 },
  { label: "ALL", value: "all" },
];

function FundValuationChart({ symbol, valuation, creationMetadata }: { symbol: string; valuation: FundValuation; creationMetadata: OtfCreationMetadata | null }) {
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
  const left = 54;
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
  const methodologyLabel = creationMetadata
    ? weightingMethodLabel(creationMetadata.weightingMethod)
    : "Weighting method unavailable";

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
              <div className="valuationPerformance"><strong className={changeTone}>{changeLabel}</strong><small>{formatUsd(selectedValue, mode === "share" ? 4 : 2)}</small></div>
              <div className="valuationRangeToggle" role="group" aria-label="Chart time range">{VALUATION_RANGES.map((option) => <button className={range === option.value ? "active" : ""} key={option.value} type="button" aria-pressed={range === option.value} onClick={() => setRange(option.value)}>{option.label}</button>)}</div>
            </div>
            <div className="valuationChartWrap">
              <svg className="valuationChart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${symbol} ${mode === "share" ? "NAV per share" : "total NAV"} chart ending at ${formatUsd(selectedValue)}`}>
                {ticks.map((tick) => { const y = top + ((maximum - tick) / spread) * (height - top - bottom); return <g key={tick}><line className="valuationChartGrid" x1={left} x2={width - right} y1={y} y2={y} /><text className="valuationChartLabel" x={left - 8} y={y + 3} textAnchor="end">{formatUsd(tick, tick < 10 ? 2 : 0)}</text></g>; })}
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
        <div className="directoryPanelHeading allocationPanelHeading">
          <div><h2 id="allocation-title">Allocation</h2></div>
          <div className="allocationHeadingMeta"><span className="stateBadge muted methodologyBadge">{methodologyLabel}</span></div>
        </div>
        {creationMetadata ? (
          <div className="creationAllocationTableWrap">
            <table className="creationAllocationTable">
              <thead><tr><th>Constituent</th><th>Market-cap weight</th><th>Creator-selected weight</th><th>Multiplier</th></tr></thead>
              <tbody>{creationMetadata.constituents.map((asset) => { const position = multiplierPosition(BigInt(asset.multiplierUnits)); return <tr key={asset.address}><td><div className="rwaAssetIdentity"><AssetLogo symbol={asset.symbol} /><div><strong>{asset.symbol}</strong><small>{asset.name} · {shortAddress(asset.address)}</small></div></div></td><td data-label="Market-cap weight" title={`${formatStoredPercentageExact(asset.marketCapDefaultPercentageUnits)} exact default`}>{formatStoredPercentage(asset.marketCapDefaultPercentageUnits)}</td><td data-label="Creator-selected weight" title={`${formatStoredPercentageExact(asset.finalPercentageUnits)} exact selected weight`}>{formatStoredPercentage(asset.finalPercentageUnits)}</td><td data-label="Multiplier"><strong>{formatMarketCapMultiplier(BigInt(asset.multiplierUnits))}</strong>{position === "unchanged" ? null : <small>{position[0].toUpperCase()}{position.slice(1)}</small>}</td></tr>; })}</tbody>
            </table>
          </div>
        ) : (
          <div className="creationMetadataUnavailable" role="status"><History size={17} /><div><strong>Weighting method unavailable</strong><span>It is not inferred or fabricated from current balances. The methodology can only be shown when this browser has the vault&apos;s creation metadata.</span></div></div>
        )}
      </section>
    </div>
  );
}

function FundsSurface({ detail }: { detail: boolean }) {
  const routeAddress = addressFromLocation();
  const router = useRouter();
  const chainId = useChainId();
  const publicClient = usePublicClient({ chainId });
  const { address } = useAccount();
  const testnet = chainId === robinhoodChainTestnet.id;
  const explorerUrl = testnet ? robinhoodChainTestnet.blockExplorers.default.url : robinhoodChain.blockExplorers.default.url;
  const directoryDeploymentReady = testnet && robinhoodTestnetCreationReady;
  const { state: factoryDirectoryState, vaults } = useFactoryVaults({ enabled: !detail });
  const [directoryView, setDirectoryView] = useState<"rows" | "cards">("rows");
  const [directorySearch, setDirectorySearch] = useState("");
  const [detailState, setDetailState] = useState<"loading" | "ready" | "failure">("loading");
  const [vaultDetails, setVaultDetails] = useState<FactoryVaultSummary>();
  const [creationMetadata, setCreationMetadata] = useState<OtfCreationMetadata | null>(null);
  const valuation = useFundValuation(detail ? vaultDetails : undefined);
  useEffect(() => {
    if (!detail || !routeAddress) {
      setCreationMetadata(null);
      return;
    }
    setCreationMetadata(loadCreationMetadata(window.localStorage, chainId, routeAddress) ?? null);
  }, [chainId, detail, routeAddress]);
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
  const filteredVaults = normalizedSearch
    ? vaults.filter((vault) => `${vault.name} ${vault.symbol} ${vault.address}`.toLowerCase().includes(normalizedSearch))
    : vaults;
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
                  <div className="fundDetailTitleLine"><h1 id="fund-detail-title">{vaultDetails?.name ?? (routeAddress ? shortAddress(routeAddress) : "No OTF connected")}</h1></div>
                  <div className="fundDetailMeta">
                    {routeAddress ? <a href={`${explorerUrl}/address/${routeAddress}`} target="_blank" rel="noreferrer"><code>{shortAddress(routeAddress)}</code><ExternalLink size={11} /></a> : <span>No valid fund address in this route</span>}
                  </div>
                </div>
              </div>
              <div className="fundDetailMetrics" aria-label="Fund metrics">
                <div><span>NAV/Share</span><strong>{valuation.state === "ready" ? formatUsd(valuation.current?.navUsd, 4) : "—"}</strong></div>
                <div><span>NAV</span><strong>{valuation.state === "ready" ? formatUsd(valuation.current?.aumUsd) : "—"}</strong></div>
                <div><span>Creator</span><strong>{vaultDetails ? <a className="metricExternalLink fundMetricAddressLink" href={`${explorerUrl}/address/${vaultDetails.creator}`} target="_blank" rel="noreferrer"><code>{shortAddress(vaultDetails.creator)}</code><ExternalLink size={11} /></a> : "—"}</strong></div>
              </div>
            </div>
            <section className="fundThesis" aria-labelledby="fund-thesis-title"><span className="fundThesisMark" aria-hidden="true"><BookOpenText size={17} /></span><div><h2 id="fund-thesis-title">Fund thesis</h2>{vaultDetails ? <p>{vaultDetails.fundThesis}</p> : null}</div></section>
          </section>
          <div className="fundDetailPrimaryGrid">
            <FundValuationChart symbol={vaultDetails?.symbol ?? "OTF"} valuation={valuation} creationMetadata={creationMetadata} />
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
          <div className="fundsAum"><strong aria-label="Total AUM">$0.00</strong><span>in {vaults.length} OTF{vaults.length === 1 ? "" : "s"}</span></div>
          <div className="appPageActions"><Link className="secondaryAction" href="/verified"><ShieldCheck size={14} />Verified</Link><Link className="primaryAction" href="/launch?from=funds">Launch OTF<ArrowUpRight size={14} /></Link></div>
        </section>
        {!testnet ? (
          <section className="sectionCard depositsEmpty"><span><Network size={22} /></span><h2>Robinhood Mainnet is not supported yet</h2><p>Canonical USDG is configured, but no OTF deployments or typed execution service are available on Robinhood Mainnet. Enable Testnet in Settings to use the current protocol deployment.</p></section>
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
              {directoryState === "ready" && filteredVaults.length ? directoryView === "rows" ? (
                <div className="directoryTableWrap">
                  <table className="directoryTable" aria-label="Onchain traded funds"><thead><tr><th>OTF</th><th>Supply</th><th>Assets</th><th>Creator fee</th><th>Creator</th></tr></thead><tbody>{filteredVaults.map((vault) => { const href = `/funds/${vault.address}`; return <tr className="clickableDirectoryRow" key={vault.address} role="link" tabIndex={0} onClick={() => router.push(href)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); router.push(href); } }}><td><div className="directoryFundLink"><AssetLogo symbol={vault.symbol} /><span><strong>{vault.name}</strong><small>{vault.symbol} · {shortAddress(vault.address)}</small></span></div></td><td data-label="Supply">{Number(formatUnits(vault.totalSupply, 18)).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td><td data-label="Assets">{vault.assetCount}</td><td data-label="Creator fee">{formatAnnualExpenseRatioPercentage(vault.annualCreatorExpenseRatioBps)}</td><td data-label="Creator" className="monoValue">{shortAddress(vault.creator)}</td></tr>; })}</tbody></table>
                </div>
              ) : (
                <div className="directoryFundCards">{filteredVaults.map((vault) => <Link className="directoryFundCard" href={`/funds/${vault.address}`} key={vault.address}><div><AssetLogo symbol={vault.symbol} /><span><strong>{vault.name}</strong><small>{vault.symbol} · {shortAddress(vault.address)}</small></span></div><dl><div><dt>Assets</dt><dd>{vault.assetCount}</dd></div><div><dt>Creator fee</dt><dd>{formatAnnualExpenseRatioPercentage(vault.annualCreatorExpenseRatioBps)}</dd></div><div><dt>Creator</dt><dd>{shortAddress(vault.creator)}</dd></div></dl></Link>)}</div>
              ) : (
                <div className="emptyDirectory">{directoryState === "loading" ? <ActivitySpinner size={18} /> : <><Search size={18} /><strong>{directoryState === "failure" ? "Could not load testnet OTFs" : normalizedSearch ? "No matching OTFs" : "No testnet OTFs yet"}</strong><span>{directoryState === "failure" ? "The configured factory directory could not be read. Refresh to try again or inspect a known OTF address directly." : normalizedSearch ? "Try another name, symbol, or contract address." : "New OTFs will appear here after their launch transaction is confirmed."}</span></>}</div>
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
  const testnet = chainId === robinhoodChainTestnet.id;
  const assets = configuredAssetsFor(chainId);
  return (
    <DashboardPage>
      <div className="appView">
        <AppPageHeader title="Verified Assets" description={<>Token identities and pricing routes checked against the app&apos;s <a href="/verified-assets.json" target="_blank" rel="noreferrer">verification registry</a>. Verification is informational and does not authorize OTF constituents.</>} icon={<ShieldCheck size={18} />} actions={testnet ? <a className="secondaryAction utilityAction" href="https://faucet.testnet.chain.robinhood.com/" target="_blank" rel="noreferrer"><Droplets size={14} />Testnet faucet<ExternalLink size={12} /></a> : undefined} />
        {!testnet ? <section className="sectionCard depositsEmpty"><span><Network size={22} /></span><h2>Mainnet verification is not available yet</h2><p>Switch on Testnet mode in Settings to inspect the current verified-asset registry.</p></section> : (
          <section className="sectionCard walletAssets">
            <div className="directoryPanelHeading"><div><h2>Verification details</h2><p>Registry verification paired with metadata read directly from each token contract.</p></div><span className="stateBadge success"><CheckCircle size={12} />{assets.length} verified</span></div>
            <div className="directoryTableWrap"><table className="directoryTable verifiedAssetsTable"><thead><tr><th>Onchain asset</th><th>Decimals</th><th>Token contract</th></tr></thead><tbody>{assets.map((asset) => <tr key={asset.address}><td><div className="rwaAssetIdentity"><AssetLogo symbol={asset.symbol} /><div><strong>{asset.symbol}</strong><small>{asset.name}</small></div></div></td><td data-label="Decimals" className="monoValue">{asset.decimals}</td><td data-label="Token contract" className="monoValue"><a className="tableAddressLink" href={`${robinhoodChainTestnet.blockExplorers.default.url}/address/${asset.address}`} target="_blank" rel="noreferrer">{shortAddress(asset.address)}<ExternalLink size={11} /></a></td></tr>)}</tbody></table></div>
          </section>
        )}
      </div>
    </DashboardPage>
  );
}

function TokenSurface() {
  return <DashboardPage><OTFTokenSurface swap={<SwapSurface embedded protocolTokenMode />} /></DashboardPage>;
}

function WalletSurface() {
  const chainId = useChainId();
  const testnet = chainId === robinhoodChainTestnet.id;
  const { address } = useAccount();
  const { state: vaultDirectoryState, vaults } = useFactoryVaults({ enabled: testnet && Boolean(address) });
  const balanceContracts = useMemo(() => address ? vaults.map((vault) => ({
    address: vault.address,
    abi: managedOtfVaultAbi,
    functionName: "balanceOf" as const,
    args: [address] as const,
  })) : [], [address, vaults]);
  const { data: vaultBalanceReads, isLoading: vaultBalancesLoading } = useReadContracts({
    contracts: balanceContracts,
    query: { enabled: Boolean(address && testnet && balanceContracts.length) },
  });
  const positions = vaults.flatMap((vault, index) => {
    const balance = vaultBalanceReads?.[index]?.result;
    return typeof balance === "bigint" && balance > 0n ? [{ vault, balance }] : [];
  });
  const managedVaults = address ? vaults.filter((vault) => vault.creator.toLowerCase() === address.toLowerCase()) : [];
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
        {!testnet ? <section className="sectionCard depositsEmpty"><span><Network size={22} /></span><h2>Robinhood Mainnet is not supported yet</h2><p>Switch to Robinhood Testnet in Settings to view deployed OTF positions.</p></section> : address ? (
          <>
            <section className="sectionCard depositPositions">
              <div className="managedVaultsHeading"><div><span className="appPageIcon"><CircleDollarSign size={16} /></span><div><h2>OTF positions</h2><p>Share-token balances held by the connected wallet.</p></div></div><span className="stateBadge muted">{vaultDataLoading ? <ActivitySpinner size={13} /> : `${positions.length} position${positions.length === 1 ? "" : "s"}`}</span></div>
              {positions.length ? <div className="walletVaultRows">{positions.map(({ vault, balance }) => <Link className="walletVaultRow walletPositionRow" href={`/funds/${vault.address}`} key={vault.address}><div className="walletVaultIdentity"><AssetLogo symbol={vault.symbol} /><span><strong>{vault.name}</strong><small>{vault.symbol} · {shortAddress(vault.address)}</small></span></div><div className="walletVaultStat"><span>Balance</span><strong>{formatShareSupply(balance)} {vault.symbol}</strong></div></Link>)}</div> : <div className="inlineEmptyState walletPositionEmpty">{vaultDataLoading ? <LoaderCircle className="createAssetSpinner" size={18} /> : <CircleDollarSign size={18} />}<div><strong>{vaultDataLoading ? "Checking OTF balances" : vaultDirectoryState === "failure" ? "Could not load OTF positions" : "No OTF positions found"}</strong><span>{vaultDirectoryState === "failure" ? "The factory directory could not be read from the configured testnet RPC." : "Your OTF shares will appear here after a purchase or deposit."}</span></div></div>}
            </section>
            <section className="sectionCard managedVaultsPanel">
              <div className="managedVaultsHeading"><div><span className="appPageIcon"><UserCog size={16} /></span><div><h2>Funds managed by you</h2><p>Funds launched by this wallet, discovered from the factory directory.</p></div></div><div className="managedVaultsHeaderActions"><Link className="secondaryAction" href="/launch?from=wallet">Launch OTF</Link></div></div>
              {managedVaults.length ? <div className="walletVaultRows">{managedVaults.map((vault) => <Link className="walletVaultRow" href={`/funds/${vault.address}`} key={vault.address}><div className="walletVaultIdentity"><AssetLogo symbol={vault.symbol} /><span><strong>{vault.name}</strong><small>{vault.symbol} · {shortAddress(vault.address)}</small></span></div><div className="walletVaultStat"><span>Constituents</span><strong>{vault.assetCount}</strong></div><div className="walletVaultStat"><span>Creator fee</span><strong>{formatAnnualExpenseRatioPercentage(vault.annualCreatorExpenseRatioBps)}</strong></div></Link>)}</div> : <div className="inlineEmptyState">{vaultDirectoryState === "loading" ? <LoaderCircle className="createAssetSpinner" size={18} /> : <UserCog size={18} />}<div><strong>{vaultDirectoryState === "loading" ? "Finding OTFs launched by this wallet" : vaultDirectoryState === "failure" ? "Could not load launched OTFs" : "No launched OTFs found"}</strong><span>{vaultDirectoryState === "failure" ? "The factory directory could not be read from the configured testnet RPC." : "OTFs will appear here after this wallet launches them through the factory."}</span></div></div>}
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
