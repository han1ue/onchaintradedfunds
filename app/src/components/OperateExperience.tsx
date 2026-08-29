"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import {
  ArrowDownUp,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleAlert,
  ExternalLink,
  History,
  Info,
  LoaderCircle,
  Menu,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Wallet,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { encodeFunctionData, getAddress, isAddress, zeroAddress, type Address, type Hex } from "viem";
import { useAccount, useBalance, useChainId, usePublicClient, useWalletClient } from "wagmi";
import { otfEntryExitRouterAbi } from "@onchaintradedfunds/generated";
import { Providers } from "@/app/providers";
import { robinhoodChain, robinhoodChainTestnet } from "@/lib/chains";
import { robinhoodTestnetAddresses, robinhoodTestnetDeploymentReady } from "@/lib/deployment";
import {
  bestQueriedQuote,
  assetHasExecutableMetadata,
  creationValidation,
  decimalInputValue,
  ERC20_APPROVE_ABI,
  executionPlanForQuote,
  executionStages,
  isPositiveDecimalAmount,
  liquidityActionLabel,
  liquidityVenueFor,
  pastedAsset,
  quoteIsFresh,
  quoteServiceForChain,
  requestConcurrentQuotes,
  routerArgsForExecution,
  supportedSwapDirection,
  swapDirectionLabel,
  validSwapPair,
  type SwapAsset,
  type SwapAssetKind,
  type SwapQuote,
} from "@/lib/swap-model";
import { navigationItemForPath } from "@/lib/operate-navigation";

export type OperateView = "landing" | "detail" | "vaults" | "create" | "verified";

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
  if (chainId !== robinhoodChainTestnet.id) return [];
  const assets: SwapAsset[] = [];
  if (robinhoodTestnetAddresses.usdg) {
    assets.push({
      address: robinhoodTestnetAddresses.usdg,
      symbol: "USDG",
      name: "USDG",
      kind: "erc20",
      decimals: 18,
      metadataResolved: true,
      verified: true,
    });
  }
  if (robinhoodTestnetAddresses.weth) {
    assets.push({
      address: robinhoodTestnetAddresses.weth,
      symbol: "WETH",
      name: "Wrapped Ether",
      kind: "erc20",
      decimals: 18,
      metadataResolved: true,
      verified: true,
    });
  }
  return assets;
}

function configuredUsdgFor(chainId: number): SwapAsset | undefined {
  return configuredAssetsFor(chainId).find((asset) => asset.symbol === "USDG");
}

function addressFromLocation(): Address | undefined {
  if (typeof window === "undefined") return undefined;
  const segments = window.location.pathname.split("/").filter(Boolean);
  const candidate = segments[0] === "otfs" ? segments[1] : undefined;
  return candidate && isAddress(candidate) ? getAddress(candidate) : undefined;
}

function sameAsset(left: SwapAsset | undefined, right: SwapAsset | undefined): boolean {
  return Boolean(left && right && left.address.toLowerCase() === right.address.toLowerCase());
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function AssetMark({ asset }: { asset: SwapAsset }) {
  return <span className={`swapAssetMark ${asset.kind}`} aria-hidden="true">{asset.symbol.slice(0, 1)}</span>;
}

function TokenPicker({
  title,
  onClose,
  onSelect,
  selected,
  exclude,
  routeFund,
  configuredAssets,
}: {
  title: string;
  onClose: () => void;
  onSelect: (asset: SwapAsset) => void;
  selected?: SwapAsset;
  exclude?: SwapAsset;
  routeFund?: SwapAsset;
  configuredAssets: readonly SwapAsset[];
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<SwapAssetKind>(selected?.kind ?? "erc20");
  const searchRef = useRef<HTMLInputElement>(null);
  const addressAsset = pastedAsset(query);
  const options: SwapAsset[] = routeFund ? [...configuredAssets, routeFund] : [...configuredAssets];
  const searchable = options
    .filter((asset) => asset.kind === kind && !sameAsset(asset, exclude))
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
        <div className="swapKindToggle" aria-label="Asset kind">
          <button type="button" aria-pressed={kind === "erc20"} className={kind === "erc20" ? "selected" : ""} onClick={() => setKind("erc20")}>Token</button>
          <button type="button" aria-pressed={kind === "otf"} className={kind === "otf" ? "selected" : ""} onClick={() => setKind("otf")}>OTF share</button>
        </div>
        <div className="swapTokenList">
          {searchable.map((asset) => (
            <button type="button" key={asset.address} className="swapTokenOption" onClick={() => onSelect(asset)}>
              <AssetMark asset={asset} />
              <span><strong>{asset.symbol}</strong><small>{asset.name}</small></span>
              {sameAsset(asset, selected) ? <Check size={15} aria-label="Selected" /> : <small>{shortAddress(asset.address)}</small>}
            </button>
          ))}
          {canSelectAddress ? (
            <button type="button" className="swapTokenOption addressOption" onClick={() => onSelect({ ...addressAsset!, kind })}>
              <AssetMark asset={{ ...addressAsset!, kind }} />
              <span><strong>{kind === "otf" ? "OTF share address" : "Token address"}</strong><small>{shortAddress(addressAsset!.address)}</small></span>
              <small>Unresolved</small>
            </button>
          ) : null}
          {!searchable.length && !canSelectAddress ? <p className="swapPickerEmpty">No configured {kind === "otf" ? "OTF shares" : "tokens"} match this search.</p> : null}
        </div>
        <p className="swapTokenFootnote">Pasting an address only selects it. It does not resolve metadata, establish verification, or enable a route.</p>
      </section>
    </div>
  );
}

function OperateNav() {
  const pathname = usePathname();
  const current = navigationItemForPath(pathname);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => setMenuOpen(false), [pathname]);

  return (
    <header className="swapNav">
      <Link className="swapBrand" href="/" aria-label="Onchain Traded Funds swap"><span>OTF</span><strong>Onchain Traded Funds</strong></Link>
      <button type="button" className="swapMenuButton" aria-label="Toggle navigation" aria-expanded={menuOpen} aria-controls="operate-primary-nav" onClick={() => setMenuOpen((open) => !open)}><Menu size={19} /></button>
      <nav id="operate-primary-nav" className={menuOpen ? "open" : ""} aria-label="Primary navigation">
        <Link className={current === "swap" ? "active" : ""} href="/">Swap</Link>
        <Link className={current === "funds" ? "active" : ""} href="/otfs">Funds</Link>
        <Link className={current === "verified" ? "active" : ""} href="/verified">Verified</Link>
      </nav>
      <div className="swapNavActions"><Link href="/docs">Docs</Link><Link href="/create" className="swapCreateLink">Create OTF</Link><ConnectButton accountStatus="address" chainStatus="icon" showBalance={false} /></div>
    </header>
  );
}

function SwapStatus({
  chainId,
  quotes,
  activeQuote,
  now,
  deploymentReady,
  execution,
}: {
  chainId: number;
  quotes: SwapQuote[];
  activeQuote?: SwapQuote;
  now: number;
  deploymentReady: boolean;
  execution: "idle" | "approval" | "simulation" | "submission" | "success" | "failure";
}) {
  const { address } = useAccount();
  const knownNetwork = chainId === robinhoodChainTestnet.id || chainId === robinhoodChain.id;
  const testnet = chainId === robinhoodChainTestnet.id;
  const networkText = testnet ? "Robinhood Chain Testnet" : chainId === robinhoodChain.id ? "Robinhood Chain" : "Unsupported network";
  const usableQuote = Boolean(activeQuote && quoteIsFresh(activeQuote, now));
  const quoteText = usableQuote ? "Quote ready" : quotes.some((quote) => quote.state === "loading") ? "Requesting quotes" : "No executable quote";
  const stages = executionStages({
    walletConnected: Boolean(address),
    networkSupported: knownNetwork,
    usableQuote,
    deploymentReady,
    execution: execution === "idle" ? undefined : execution,
  });
  return (
    <div className="swapExecutionState" aria-live="polite">
      <span><Wallet size={14} />{address ? shortAddress(address) : "Wallet not connected"}</span>
      <span className={knownNetwork ? "ready" : "warning"}><ShieldCheck size={14} />{networkText}</span>
      <span className={usableQuote ? "ready" : "warning"}><CircleAlert size={14} />{quoteText}</span>
      {!deploymentReady ? <span className="warning"><CircleAlert size={14} />Deployment configuration incomplete</span> : null}
      <dl className="swapStageList">
        <div><dt>Wallet</dt><dd>{stages.wallet}</dd></div>
        <div><dt>Approval</dt><dd>{stages.approval}</dd></div>
        <div><dt>Simulation</dt><dd>{stages.simulation}</dd></div>
        <div><dt>Submit</dt><dd>{stages.submission}</dd></div>
        <div><dt>Success</dt><dd>{stages.success}</dd></div>
        <div><dt>Failure</dt><dd>{stages.failure}</dd></div>
      </dl>
    </div>
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
  return (
    <section className="swapReview" aria-label="Quote details">
      <div className="swapReviewHeader"><strong>Quote details</strong><button type="button" onClick={onRefresh}><LoaderCircle size={13} />Refresh</button></div>
      <div className="swapRoutes">
        {quotes.map((quote) => {
          const valid = quoteIsFresh(quote, now);
          return (
            <button key={quote.id} type="button" className={`swapRoute ${activeQuote?.id === quote.id ? "selected" : ""}`} disabled={!valid} onClick={() => onChoose(quote)}>
              <span><strong>{quote.routeLabel}</strong><small>{quote.reason || (valid ? "Quoted route" : "Unavailable")}</small></span>
              <span className={`swapRouteState ${valid ? "ready" : ""}`}>{valid ? "Select" : quote.state}</span>
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
                  <small>V3 fee tier {hop.feeTier / 10_000}% · pool address is authenticated by the onchain V3 factory during execution</small>
                </div>
              </li>
            ))}
          </ol>
        ) : <p>No executable hop details are available for inspection.</p>}
      </div>
      <p className="swapRouteDisclosure">Only the direct-liquidity and basket-settlement routes queried here are compared. Selection is not a claim of best price across all venues.</p>
      <p className="swapRouteDisclosure">{executionConfigured
        ? "This response was parsed into a bounded entry-router method. A stale quote is never actionable."
        : "Typed quote and deployment configuration are incomplete. A stale quote is never actionable, and no approval, simulation, or transaction can start."}</p>
      <span className="swapPairLine">Input: {inputSymbol} · Output: {outputSymbol}</span>
    </section>
  );
}

function SwapSurface() {
  const chainId = useChainId();
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId });
  const { data: walletClient } = useWalletClient({ chainId });
  const configuredAssets = useMemo(() => configuredAssetsFor(chainId), [chainId]);
  const configuredUsdg = useMemo(() => configuredUsdgFor(chainId), [chainId]);
  const routeFundAddress = addressFromLocation();
  const routeFund = routeFundAddress ? { address: routeFundAddress, symbol: "OTF", name: "Unresolved fund route address", kind: "otf" as const, decimals: 18, metadataResolved: false } : undefined;
  const [input, setInput] = useState<SwapAsset>(() => configuredUsdgFor(robinhoodChainTestnet.id) ?? EMPTY_ERC20);
  const [output, setOutput] = useState<SwapAsset>(EMPTY_OTF);
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);
  const [picker, setPicker] = useState<"input" | "output">();
  const [quotes, setQuotes] = useState<SwapQuote[]>([]);
  const [activeQuote, setActiveQuote] = useState<SwapQuote>();
  const [quoteRequest, setQuoteRequest] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [execution, setExecution] = useState<"idle" | "approval" | "simulation" | "submission" | "success" | "failure">("idle");
  const [executionMessage, setExecutionMessage] = useState<string>();
  const pairValid = validSwapPair(input, output);
  const pairExecutable = assetHasExecutableMetadata(input) && assetHasExecutableMetadata(output);
  const directionSupported = supportedSwapDirection(input, output);
  const amountValid = isPositiveDecimalAmount(amount, input.decimals);
  const supportedNetwork = chainId === robinhoodChainTestnet.id || chainId === robinhoodChain.id;
  const usableQuote = Boolean(activeQuote && quoteIsFresh(activeQuote, now));
  const deploymentReady = chainId === robinhoodChainTestnet.id && robinhoodTestnetDeploymentReady;
  const quoteService = useMemo(() => quoteServiceForChain(chainId), [chainId]);
  const executionPlan = useMemo(() => executionPlanForQuote(activeQuote, chainId, now), [activeQuote, chainId, now]);
  const routeOtf = output.kind === "otf" ? output : input.kind === "otf" ? input : undefined;
  const venue = liquidityVenueFor(chainId, routeOtf, configuredUsdg);
  const { data: inputBalance, isLoading: inputBalanceLoading } = useBalance({
    address,
    token: input.address === zeroAddress ? undefined : input.address,
    chainId,
    query: { enabled: Boolean(address && assetHasExecutableMetadata(input)) },
  });
  const { data: outputBalance, isLoading: outputBalanceLoading } = useBalance({
    address,
    token: output.address === zeroAddress ? undefined : output.address,
    chainId,
    query: { enabled: Boolean(address && assetHasExecutableMetadata(output)) },
  });

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

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
    if (chainId === robinhoodChainTestnet.id) return;
    setInput((current) => current.verified ? EMPTY_ERC20 : current);
    setOutput((current) => current.verified ? EMPTY_ERC20 : current);
  }, [chainId]);

  useEffect(() => {
    if (!pairValid || !pairExecutable || !directionSupported || !amountValid || !supportedNetwork) {
      setQuotes([]);
      setActiveQuote(undefined);
      return;
    }
    const requestedAt = Date.now();
    const request = { chainId, input, output, inputAmount: amount, slippageBps, requestedAt, caller: address };
    setQuotes([
      { id: `direct-loading-${requestedAt}`, route: "direct", state: "loading", queriedAt: requestedAt, inputAmount: amount, routeLabel: "Direct liquidity" },
      { id: `basket-loading-${requestedAt}`, route: "basket", state: "loading", queriedAt: requestedAt, inputAmount: amount, routeLabel: "Basket settlement" },
    ]);
    setActiveQuote(undefined);
    let cancelled = false;
    requestConcurrentQuotes(quoteService, request).then((nextQuotes) => {
      if (cancelled) return;
      setQuotes(nextQuotes);
      setActiveQuote(bestQueriedQuote(nextQuotes, Date.now()));
    }).catch(() => {
      if (!cancelled) setQuotes([]);
    });
    return () => { cancelled = true; };
  }, [address, amount, amountValid, chainId, directionSupported, input, output, pairExecutable, pairValid, quoteRequest, quoteService, slippageBps, supportedNetwork]);

  function selectAsset(which: "input" | "output", asset: SwapAsset) {
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

  async function executeSwap() {
    if (!address || !publicClient || !walletClient || !executionPlan || !deploymentReady) return;
    if (activeQuote?.caller?.toLowerCase() !== address.toLowerCase()) {
      setExecution("failure");
      setExecutionMessage("Refresh the quote after changing the connected wallet.");
      return;
    }
    if (robinhoodTestnetAddresses.entryRouter?.toLowerCase() !== executionPlan.router.toLowerCase()) {
      setExecution("failure");
      setExecutionMessage("The quote does not target the configured immutable entry router.");
      return;
    }
    try {
      setExecutionMessage(undefined);
      setExecution("approval");
      const allowance = await publicClient.readContract({
        address: executionPlan.approval.token,
        abi: ERC20_APPROVE_ABI,
        functionName: "allowance",
        args: [address, executionPlan.approval.spender],
      });
      if (allowance < executionPlan.approval.amount) {
        const approvalHash = await walletClient.writeContract({
          account: address,
          address: executionPlan.approval.token,
          abi: ERC20_APPROVE_ABI,
          functionName: "approve",
          args: [executionPlan.approval.spender, executionPlan.approval.amount],
        });
        await publicClient.waitForTransactionReceipt({ hash: approvalHash });
      }
      setExecution("simulation");
      const data = encodeFunctionData({
        abi: otfEntryExitRouterAbi,
        functionName: executionPlan.call.method,
        args: routerArgsForExecution(executionPlan.call) as never,
      });
      await publicClient.call({ account: address, to: executionPlan.router, data: data as Hex });
      setExecution("submission");
      const hash = await walletClient.sendTransaction({ account: address, to: executionPlan.router, data: data as Hex });
      await publicClient.waitForTransactionReceipt({ hash });
      setExecution("success");
      setExecutionMessage(`Swap submitted and confirmed: ${shortAddress(hash)}.`);
    } catch (error) {
      setExecution("failure");
      setExecutionMessage(error instanceof Error ? error.message : "The wallet, approval, simulation, or transaction failed.");
    }
  }

  const executionBusy = execution === "approval" || execution === "simulation" || execution === "submission";
  const canExecute = Boolean(address && publicClient && walletClient && pairExecutable && executionPlan && deploymentReady && !executionBusy);
  const primaryLabel = !address
    ? "Connect wallet"
    : !supportedNetwork
      ? "Switch network"
      : !amountValid
        ? "Enter a valid amount"
        : !pairValid
          ? "Choose different tokens"
          : !pairExecutable
            ? "Resolve token metadata"
          : !directionSupported
            ? "Choose an OTF share"
            : !deploymentReady
              ? "Deployment configuration required"
          : !usableQuote
            ? "Quotes unavailable"
            : execution === "approval"
              ? "Approving exact input"
              : execution === "simulation"
                ? "Simulating swap"
                : execution === "submission"
                  ? "Submitting swap"
                  : "Review and submit swap";

  return (
    <div className="operateShell">
      <OperateNav />
      <main className="swapMain">
        <section className="swapIntro"><h1>Swap</h1><p>Trade ERC-20s and OTF shares through routes that are explicitly quoted and inspectable.</p></section>
        <section className="swapCard" aria-label="Swap tokens">
          <div className="swapSettings"><span>{swapDirectionLabel(input, output)}</span><label>Slippage <select value={slippageBps} onChange={(event) => setSlippageBps(Number(event.target.value))}><option value={50}>0.5%</option><option value={100}>1.0%</option><option value={300}>3.0%</option></select></label><SlidersHorizontal size={15} /></div>
          <div className="swapAmountBox">
            <div className="swapAmountTop"><span>You pay</span><span>{inputBalanceLoading ? "Loading balance" : inputBalance ? `Balance ${inputBalance.formatted}` : "Balance unavailable"} <button type="button" disabled={!inputBalance || inputBalance.value === 0n} title={inputBalance ? `Use the full ${input.symbol} balance` : "A resolved wallet balance is required before MAX can be used"} onClick={() => inputBalance && setAmount(inputBalance.formatted)}>MAX</button></span></div>
            <div className="swapAmountEntry"><input inputMode="decimal" value={amount} onChange={(event) => { const next = decimalInputValue(event.target.value); if (next !== undefined) setAmount(next); }} placeholder="0" aria-label={`Amount of ${input.symbol} to pay`} /><button type="button" className="swapAssetButton" onClick={() => setPicker("input")}><AssetMark asset={input} /><strong>{input.symbol}</strong><ChevronDown size={15} /></button></div>
          </div>
          <button type="button" className="swapReverse" onClick={reverse} aria-label="Reverse swap direction"><ArrowDownUp size={16} /></button>
          <div className="swapAmountBox receive">
            <div className="swapAmountTop"><span>You receive</span><span>{outputBalanceLoading ? "Loading balance" : outputBalance ? `Balance ${outputBalance.formatted}` : "Balance unavailable"}</span></div>
            <div className="swapAmountEntry"><output aria-label={`Expected ${output.symbol} output`}>{usableQuote ? activeQuote?.outputAmount ?? "0" : "0"}</output><button type="button" className="swapAssetButton" onClick={() => setPicker("output")}><AssetMark asset={output} /><strong>{output.symbol}</strong><ChevronDown size={15} /></button></div>
          </div>
          <SwapStatus chainId={chainId} quotes={quotes} activeQuote={activeQuote} now={now} deploymentReady={deploymentReady} execution={execution} />
          <button type="button" className="swapPrimary" disabled={!canExecute} onClick={executeSwap}>{primaryLabel}</button>
          <p className="swapExecutionNote">{deploymentReady
            ? "The client approves only the exact selected input to the immutable entry router, simulates the locally typed call, then asks the wallet to submit it."
            : "Writes remain disabled: the redesigned factory, immutable entry router, and typed quote endpoint have not been configured for this network."}</p>
          {executionMessage ? <p className={`swapExecutionFeedback ${execution === "failure" ? "failure" : "success"}`} role="status">{executionMessage}</p> : null}
          {quotes.length ? <QuoteReview quotes={quotes} activeQuote={activeQuote} onChoose={(quote) => { setActiveQuote(quote); setExecution("idle"); setExecutionMessage(undefined); }} onRefresh={() => setQuoteRequest((current) => current + 1)} inputSymbol={input.symbol} outputSymbol={output.symbol} now={now} executionConfigured={deploymentReady} /> : <div className="swapEmptyQuote"><Info size={15} /><span>{pairExecutable ? "Enter a valid amount to request direct-liquidity and basket-settlement quotes concurrently." : "Resolve token decimals and OTF factory identity before requesting executable quotes."}</span></div>}
        </section>
        <section className="swapLiquidityAction" aria-label="External liquidity">
          <div><strong>{liquidityActionLabel(routeOtf?.isFactoryVault ? routeOtf.symbol : "OTF")}</strong><p>Liquidity is created on the venue in your own wallet. OTF never submits an LP transaction and this does not imply an official pool.</p></div>
          {venue ? <a href={venue.href} target="_blank" rel="noopener noreferrer">Open {venue.name}<ExternalLink size={14} /></a> : <button type="button" disabled>Choose an OTF, USDG, and valid network</button>}
          {venue ? <small>{venue.prefilled ? "Leaving OTF for Uniswap with the selected OTF and USDG addresses." : "Leaving OTF for Synthra. No LP prefill is used because a documented pair-prefill URL format is unavailable."}</small> : null}
        </section>
      </main>
      {picker ? <TokenPicker title={picker === "input" ? "Select token to pay" : "Select token to receive"} onClose={() => setPicker(undefined)} onSelect={(asset) => selectAsset(picker, asset)} selected={picker === "input" ? input : output} exclude={picker === "input" ? output : input} routeFund={routeFund} configuredAssets={configuredAssets} /> : null}
    </div>
  );
}

type ConstituentInput = { address: string };

function CreateSurface() {
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [expenseRatio, setExpenseRatio] = useState("0");
  const [beneficiary, setBeneficiary] = useState("");
  const [constituents, setConstituents] = useState<ConstituentInput[]>([{ address: "" }]);
  const [submitted, setSubmitted] = useState(false);
  const annualExpenseRatioBps = expenseRatio === "" ? Number.NaN : Number(expenseRatio);
  const errors = creationValidation({ name, symbol, constituents, annualExpenseRatioBps, beneficiary });
  const structurallyValid = submitted && errors.length === 0;

  function updateConstituent(index: number, value: string) {
    setConstituents((current) => current.map((asset, assetIndex) => assetIndex === index ? { ...asset, address: value } : asset));
  }

  return (
    <div className="operateShell"><OperateNav /><main className="formMain">
      <section className="formIntro"><h1>Create an OTF</h1><p>Define ordered constituents and immutable economics. Creation remains unavailable until an authenticated formation snapshot can be prepared.</p></section>
      <form className="createForm" onSubmit={(event) => { event.preventDefault(); setSubmitted(true); }} noValidate>
        <fieldset><legend>Fund identity</legend><label>Name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Example Fund OTF" /></label><label>Ticker<input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} placeholder="EXAMPLE" /></label><label className="full">Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Plain-language fund metadata" rows={3} /></label></fieldset>
        <fieldset><legend>Constituents <span>Maximum 20 · ordered token addresses only · duplicates are rejected</span></legend>
          <div className="constituentLabels"><span>Token address</span></div>
          {constituents.map((asset, index) => <div className="constituentRow" key={index}><input value={asset.address} onChange={(event) => updateConstituent(index, event.target.value)} placeholder="0x…" aria-label={`Constituent ${index + 1} address`} /><button type="button" disabled={constituents.length === 1} onClick={() => setConstituents((current) => current.filter((_, assetIndex) => assetIndex !== index))}>Remove</button></div>)}
          <button type="button" className="addConstituent" disabled={constituents.length >= 20} onClick={() => setConstituents((current) => [...current, { address: "" }])}><Plus size={15} />Add constituent</button>
        </fieldset>
        <fieldset><legend>Immutable economics</legend><label>Annual creator expense ratio (bps)<input inputMode="numeric" value={expenseRatio} onChange={(event) => setExpenseRatio(event.target.value)} /><small>0–1000 bps. This value is immutable after formation.</small></label><label>Fixed beneficiary<input value={beneficiary} onChange={(event) => setBeneficiary(event.target.value)} placeholder="0x…" /><small>The beneficiary is fixed in the formation transaction.</small></label></fieldset>
        <aside className="creationWarning"><CircleAlert size={17} /><div><strong>10% is the protocol maximum and is not recommended.</strong><p>Creator expense shares can dilute holders. The formation-allocation rebate benefits the creator and does not reduce the holder fee; it can remain high if OTF value later falls.</p></div></aside>
        <aside className="snapshotNote"><History size={17} /><div><strong>Authenticated formation snapshot required</strong><p>The authority signature binds the chain, factory, intended creator, ordered constituents and expected decimals, market caps and unit prices, snapshot time and expiry, calculation version, and nonce. You choose metadata, beneficiary, and annual ratio separately.</p></div></aside>
        {submitted && errors.length ? <div className="formErrors" role="alert">{errors.map((error) => <span key={error}>{error}</span>)}</div> : null}
        {structurallyValid ? <p className="formValid" role="status">Input is structurally valid. It has not created an OTF or prepared a transaction.</p> : null}
        <button type="submit" className="createPrimary">Validate formation input</button>
        <p className="createBlocked">Creation transactions are intentionally unavailable until the snapshot and typed create service are configured. This form never reports a preview as a submitted fund.</p>
      </form>
    </main></div>
  );
}

function FundsSurface({ detail }: { detail: boolean }) {
  const routeAddress = addressFromLocation();
  if (detail) {
    return <div className="operateShell"><OperateNav /><main className="fundMain"><Link href="/otfs" className="backLink">← Funds</Link><section className="fundDetail"><h1>{routeAddress ? shortAddress(routeAddress) : "Fund address unavailable"}</h1><p>Fund routes remain address-based. This page exposes identity and history only when the corresponding typed read service is available.</p><dl><div><dt>Fund address</dt><dd>{routeAddress ?? "No valid fund address appears in this route."}</dd></div><div><dt>History</dt><dd>History retrieval is not configured. No activity is substituted for this address.</dd></div><div><dt>Metadata</dt><dd>Resolve the onchain name and symbol before presenting an identity result.</dd></div></dl></section></main></div>;
  }
  return <div className="operateShell"><OperateNav /><main className="fundMain"><section className="fundIntro"><div><h1>Funds</h1><p>Address-routed OTFs. Identity and ordinary metadata are distinct from economic or route safety.</p></div><Link href="/create">Create an OTF <ArrowUpRight size={14} /></Link></section><section className="fundDirectory"><div><strong>Onchain directory</strong><span>Directory reader unavailable</span></div><div className="fundTableWrap"><table><thead><tr><th>Fund</th><th>Constituents</th><th>Annual creator expense ratio</th><th>Formation</th></tr></thead><tbody><tr><td colSpan={4}><strong>No current deployment data</strong><span>The redesigned factory and typed directory reader are not configured. No preview funds are substituted for onchain rows.</span></td></tr></tbody></table></div><small className="fundDirectoryDisclosure">A future directory can establish an onchain address and ordinary metadata only. It does not indicate a pool, liquidity, route, economic safety, or investment outcome.</small></section></main></div>;
}

function VerifiedSurface() {
  return <div className="operateShell"><OperateNav /><main className="verifiedMain"><section><h1>Verified</h1><p>Verification here means identity and metadata only. It never controls routing or access to a fund address.</p><div className="verifiedStatement"><ShieldCheck size={20} /><div><strong>What this can establish</strong><p>Displayed name, symbol, token address, and ordinary metadata can be checked against their declared source.</p></div></div><div className="verifiedStatement"><CircleAlert size={20} /><div><strong>What this never establishes</strong><p>It does not verify a pool, route, liquidity, price, economic safety, audit status, or investment outcome.</p></div></div></section></main></div>;
}

function OperateRouter({ initialView }: { initialView: OperateView }) {
  if (initialView === "create") return <CreateSurface />;
  if (initialView === "vaults") return <FundsSurface detail={false} />;
  if (initialView === "detail") return <FundsSurface detail />;
  if (initialView === "verified") return <VerifiedSurface />;
  return <SwapSurface />;
}

export function OperateExperience({ initialView = "landing" }: { initialView?: OperateView }) {
  return <Providers><OperateRouter initialView={initialView} /></Providers>;
}
