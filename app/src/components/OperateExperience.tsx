"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { OtfBrandMark } from "@onchaintradedfunds/brand";
import {
  ArrowLeft,
  ArrowRight,
  ArrowDownUp,
  ArrowUpRight,
  Check,
  CheckCircle,
  ChevronDown,
  CircleAlert,
  CircleDollarSign,
  Copy,
  Droplets,
  ExternalLink,
  FilePlus2,
  History,
  Info,
  LayoutGrid,
  List,
  LoaderCircle,
  LockKeyhole,
  Monitor,
  Network,
  Palette,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  UserCog,
  Wallet,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { encodeFunctionData, getAddress, isAddress, zeroAddress, type Address, type Hex } from "viem";
import { useAccount, useBalance, useChainId, useDisconnect, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";
import { otfEntryExitRouterAbi } from "@onchaintradedfunds/generated";
import { Providers } from "@/app/providers";
import { robinhoodChain, robinhoodChainTestnet } from "@/lib/chains";
import { robinhoodTestnetAddresses, robinhoodTestnetDeploymentReady, robinhoodTestnetLiquidity } from "@/lib/deployment";
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
  MAX_OTF_MANDATE_BYTES,
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

export type OperateView = "landing" | "detail" | "vaults" | "create" | "verified" | "wallet" | "liquidity";

type AppearancePreference = "default" | "light" | "dark";

const DOCS_URL = "https://github.com/han1ue/onchaintradedfunds#readme";
const REPOSITORY_URL = "https://github.com/han1ue/onchaintradedfunds";
const UNISWAP_LIQUIDITY_URL = "https://app.uniswap.org/positions?chain=robinhood";

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
  const candidate = segments[0] === "funds" ? segments[1] : undefined;
  return candidate && isAddress(candidate) ? getAddress(candidate) : undefined;
}

function sameAsset(left: SwapAsset | undefined, right: SwapAsset | undefined): boolean {
  return Boolean(left && right && left.address.toLowerCase() === right.address.toLowerCase());
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function symbolMonogram(symbol: string): string {
  const value = symbol.replace(/^OTF-/, "").replace(/[^A-Z0-9]/gi, "");
  return (value || "OTF").slice(0, 2).toUpperCase();
}

function AssetLogo({ symbol }: { symbol: string }) {
  return <span className="assetLogoFallback" aria-hidden="true">{symbolMonogram(symbol)}</span>;
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
    const initialTheme: AppearancePreference = savedTheme === "light" || savedTheme === "dark" ? savedTheme : "default";
    const savedPalette = window.localStorage.getItem("otf-palette");
    const initialPalette = savedPalette === "robinhood" ? "robinhood" : "default";
    setTheme(initialTheme);
    setPalette(initialPalette);
    document.documentElement.dataset.palette = initialPalette;
  }, []);

  useEffect(() => {
    const browserPreference = window.matchMedia("(prefers-color-scheme: light)");
    const applyTheme = () => {
      document.documentElement.dataset.theme = theme === "default"
        ? browserPreference.matches ? "light" : "dark"
        : theme;
    };
    applyTheme();
    if (theme !== "default") return;
    browserPreference.addEventListener("change", applyTheme);
    return () => browserPreference.removeEventListener("change", applyTheme);
  }, [theme]);

  useEffect(() => {
    if (!networkOpen && !settingsOpen) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      const target = event.target as Node;
      if (networkOpen && !networkRef.current?.contains(target)) setNetworkOpen(false);
      if (settingsOpen && !settingsRef.current?.contains(target)) setSettingsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setNetworkOpen(false);
        setSettingsOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [networkOpen, settingsOpen]);

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
        <Link className="logoGroup" href="/funds" aria-label="Onchain Traded Funds">
          <OtfBrandMark />
          <span className="brandText"><strong>Onchain Traded Funds</strong></span>
        </Link>
        <nav className="navTabs" aria-label="Primary navigation">
          <Link className={current === "swap" ? "active" : ""} href="/">Swap</Link>
          <Link className={current === "funds" ? "active" : ""} href="/funds">Funds</Link>
          <a href={DOCS_URL} target="_blank" rel="noreferrer">Docs<ExternalLink size={12} /></a>
        </nav>
        <div className="navActions">
          <Link className={`depositsButton ${pathname === "/wallet" ? "active" : ""}`} href="/wallet" title="Wallet">
            <Wallet size={14} />
            <span>Wallet</span>
          </Link>
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
                <div className="settingsMenuHeader"><strong>Networks</strong><span>Choose a supported ecosystem</span></div>
                <div className="settingsGroup">
                  <button
                    className="settingsOption selected"
                    type="button"
                    role="menuitemradio"
                    aria-checked={chainId === robinhoodChain.id || testnetMode}
                    disabled={networkSwitchPending}
                    onClick={() => {
                      const nextChainId = testnetMode ? robinhoodChainTestnet.id : robinhoodChain.id;
                      if (chainId !== nextChainId) switchChain({ chainId: nextChainId });
                      setNetworkOpen(false);
                    }}
                  >
                    <span className="settingsOptionIcon network"><span className="robinhoodNetworkIcon" aria-hidden="true" /></span>
                    <span className="settingsOptionText"><strong>Robinhood Chain</strong><small>Selected network</small></span>
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
                <div className="settingsMenuHeader"><strong>Settings</strong></div>
                <div className="settingsGroup">
                  <span className="settingsLabel">Environment</span>
                  <button
                    className="settingsEnvironmentToggle"
                    type="button"
                    aria-pressed={testnetMode}
                    disabled={networkSwitchPending}
                    onClick={() => switchChain({ chainId: testnetMode ? robinhoodChain.id : robinhoodChainTestnet.id })}
                  >
                    <span className="settingsOptionIcon"><Zap size={15} /></span>
                    <span className="settingsOptionText"><strong>Testnet mode</strong><small>Uses the testnet of the currently selected chain.</small></span>
                    <span className={`themeSwitch ${testnetMode ? "active" : ""}`} aria-hidden="true"><span /></span>
                  </button>
                </div>
                <div className="settingsGroup">
                  <span className="settingsLabel">Appearance</span>
                  <div className="settingsThemeHeading">
                    <span className="settingsOptionIcon"><Sun size={15} /></span>
                    <span className="settingsOptionText"><strong>Mode</strong><small>Follow your browser or choose a mode</small></span>
                  </div>
                  <div className="settingsThemeChoices appearance" role="radiogroup" aria-label="Application appearance">
                    {(["default", "light", "dark"] as const).map((value) => (
                      <button className={`settingsThemeChoice ${theme === value ? "selected" : ""}`} key={value} type="button" role="radio" aria-checked={theme === value} onClick={() => changeTheme(value)}>
                        {value === "default" ? <Monitor className="settingsSystemIcon" size={13} /> : <span className={`settingsThemeSwatch appearance-${value}`} aria-hidden="true" />}
                        <span>{value === "default" ? "Browser" : value[0].toUpperCase() + value.slice(1)}</span>
                        {theme === value ? <Check size={12} /> : null}
                      </button>
                    ))}
                  </div>
                  <div className="settingsThemePicker">
                    <div className="settingsThemeHeading">
                      <span className="settingsOptionIcon"><Palette size={15} /></span>
                      <span className="settingsOptionText"><strong>Theme</strong><small>Choose the application color palette</small></span>
                    </div>
                    <div className="settingsThemeChoices palette" role="radiogroup" aria-label="Application theme">
                      {(["default", "robinhood"] as const).map((value) => (
                        <button className={`settingsThemeChoice ${palette === value ? "selected" : ""}`} key={value} type="button" role="radio" aria-checked={palette === value} onClick={() => changePalette(value)}>
                          <span className={`settingsThemeSwatch ${value}`} aria-hidden="true" />
                          <span>{value === "default" ? "Default" : "Robinhood"}</span>
                          {palette === value ? <Check size={13} /> : null}
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

function OperateFooter() {
  const chainId = useChainId();
  const showLiquidity = chainId === robinhoodChainTestnet.id;

  return (
    <footer className="dashboardFooter">
      <span>Onchain Traded Funds · experimental, unaudited software</span>
      <div className="footerLinks">
        {showLiquidity ? <Link href="/liquidity">Testnet liquidity</Link> : null}
        <a href={DOCS_URL} target="_blank" rel="noreferrer">Docs<ExternalLink size={12} /></a>
        <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">GitHub<ExternalLink size={12} /></a>
      </div>
    </footer>
  );
}

function AppPageHeader({ title, description, icon, actions }: { title: string; description: React.ReactNode; icon: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <header className="appPageHeader">
      <div><span className="appPageIcon">{icon}</span><div><h1>{title}</h1><p>{description}</p></div></div>
      {actions ? <div className="appPageActions">{actions}</div> : null}
    </header>
  );
}

function MetricCard({ label, value, action }: { label: string; value: string; action?: React.ReactNode }) {
  return <article className={`metricCard${action ? " hasMetricAction" : ""}`}><span className="metricLabel">{label}</span><strong>{value}</strong>{action}</article>;
}

function WalletConnectionAction() {
  const { disconnect } = useDisconnect();
  return (
    <ConnectButton.Custom>
      {({ account, mounted, authenticationStatus, openConnectModal }) => {
        const ready = mounted && authenticationStatus !== "loading";
        const connected = ready && account && (!authenticationStatus || authenticationStatus === "authenticated");
        if (!ready) return <button className="secondaryAction" type="button" disabled>Loading wallet</button>;
        if (!connected) return <button className="primaryAction" type="button" onClick={openConnectModal}><Wallet size={14} />Connect wallet</button>;
        return <button className="secondaryAction walletDisconnectAction" type="button" onClick={() => disconnect()}><XCircle size={14} />Disconnect</button>;
      }}
    </ConnectButton.Custom>
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
  const testnet = chainId === robinhoodChainTestnet.id;
  const mainnet = chainId === robinhoodChain.id;
  const testnetLiquidityHref = testnet && routeOtf && routeOtf.address !== zeroAddress && configuredUsdg
    ? `/liquidity?vault=${encodeURIComponent(routeOtf.address)}&quote=${encodeURIComponent(configuredUsdg.address)}`
    : undefined;
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
        <section className="swapLiquidityAction" aria-label="Add OTF and USDG liquidity">
          <div>
            <strong>{liquidityActionLabel(routeOtf && routeOtf.address !== zeroAddress ? routeOtf.symbol : "OTF")}</strong>
            <p>Add liquidity for the selected OTF/USDG market in your own wallet. OTF never submits an LP transaction and this does not imply an official pool.</p>
          </div>
          {testnet ? (testnetLiquidityHref ? <Link href={testnetLiquidityHref}>Open liquidity page<ArrowRight size={14} /></Link> : <button type="button" disabled>Select an OTF and USDG</button>) : mainnet ? <a href={UNISWAP_LIQUIDITY_URL} target="_blank" rel="noopener noreferrer">Open Uniswap<ExternalLink size={14} /></a> : <button type="button" disabled>Unsupported network</button>}
          {testnetLiquidityHref ? <small>The selected OTF and USDG addresses will be carried into the testnet liquidity page.</small> : mainnet ? <small>Liquidity positions are created and managed externally on Uniswap.</small> : null}
        </section>
      </main>
      <div className="swapFooterFrame"><OperateFooter /></div>
      {picker ? <TokenPicker title={picker === "input" ? "Select token to pay" : "Select token to receive"} onClose={() => setPicker(undefined)} onSelect={(asset) => selectAsset(picker, asset)} selected={picker === "input" ? input : output} exclude={picker === "input" ? output : input} routeFund={routeFund} configuredAssets={configuredAssets} /> : null}
    </div>
  );
}

type ConstituentInput = { address: string };

function DashboardPage({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className="operateShell"><OperateNav /><main className={`dashboardMain${className ? ` ${className}` : ""}`}>{children}<OperateFooter /></main></div>;
}

function LiquiditySurface() {
  const chainId = useChainId();
  const testnet = chainId === robinhoodChainTestnet.id;
  const mainnet = chainId === robinhoodChain.id;
  const initialVault = typeof window === "undefined"
    ? ""
    : new URLSearchParams(window.location.search).get("vault") ?? "";
  const initialQuote = typeof window === "undefined"
    ? ""
    : new URLSearchParams(window.location.search).get("quote") ?? "";
  const marketAssets = configuredAssetsFor(robinhoodChainTestnet.id);
  const [otfAddress, setOtfAddress] = useState(initialVault);
  const [quoteChoice, setQuoteChoice] = useState(
    marketAssets.some((asset) => asset.address.toLowerCase() === initialQuote.toLowerCase())
      ? initialQuote
      : marketAssets[0]?.address ?? "",
  );
  const validOtfAddress = isAddress(otfAddress) ? getAddress(otfAddress) : undefined;
  const selectedMarketAsset = marketAssets.find(
    (asset) => asset.address.toLowerCase() === quoteChoice.toLowerCase(),
  ) ?? marketAssets[0];
  const venueName = mainnet ? "Uniswap" : "Synthra";
  const venueUrl = mainnet
    ? UNISWAP_LIQUIDITY_URL
    : robinhoodTestnetLiquidity.baseUrl ?? "https://app.synthra.org/";

  return (
    <DashboardPage className="liquidityPage">
      <div className="liquidityBreadcrumb">
        <Link href="/funds">Home</Link><span>/</span><strong>Liquidity</strong>
      </div>

      <section className="liquidityIntro">
        <div>
          <h1>OTF liquidity markets</h1>
          <p>Inspect supported markets here. Pool creation and every liquidity-position action happen on the network&apos;s external liquidity venue.</p>
        </div>
        <div className="liquidityBadges" aria-label="Liquidity venues">
          <span>{venueName}</span>
          <span>{testnet ? "Testnet" : mainnet ? "Mainnet" : "Unsupported network"}</span>
        </div>
      </section>

      <div className="liquidityLayout">
        <aside className="liquidityMarketPanel">
          <div className="liquidityPanelHeading">
            <Droplets size={16} />
            <div><strong>Market discovery</strong><span>{testnet ? "Supported testnet settlement assets are configured below." : "Mainnet discovery will follow the production deployment."}</span></div>
          </div>

          {testnet ? (
            <>
              <label className="liquidityField">
                <span>OTF address</span>
                <input value={otfAddress} onChange={(event) => setOtfAddress(event.target.value.trim())} placeholder="0x…" />
                <small>Enter a Robinhood Chain Testnet OTF address.</small>
              </label>

              <div className="liquidityField">
                <span>Settlement asset</span>
                <div className="liquidityQuoteChoices" role="list" aria-label="Supported OTF market assets">
                  {marketAssets.map((marketAsset) => {
                    const active = marketAsset.address.toLowerCase() === selectedMarketAsset?.address.toLowerCase();
                    return (
                      <button
                        className={active ? "active" : ""}
                        type="button"
                        key={marketAsset.address}
                        onClick={() => setQuoteChoice(marketAsset.address)}
                      >
                        <strong>{marketAsset.symbol}</strong>
                        <span>Configured</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="liquidityPoolRecord">
                <div><span>Selected market</span><strong>OTF / {selectedMarketAsset?.symbol ?? "quote"}</strong></div>
                <div><span>OTF</span><strong>{validOtfAddress ? shortAddress(validOtfAddress) : "Not selected"}</strong></div>
                <div><span>Settlement asset</span><strong>{selectedMarketAsset ? shortAddress(selectedMarketAsset.address) : "Not configured"}</strong></div>
                <div><span>Market state</span><strong>Check on {venueName}</strong></div>
              </div>

              {otfAddress && !validOtfAddress ? (
                <div className="validationSummary danger"><CircleAlert size={15} /><div><strong>Invalid OTF address</strong><span>Enter a valid EVM contract address.</span></div></div>
              ) : null}
              {validOtfAddress ? (
                <a className="liquidityExplorerLink" href={`${robinhoodChainTestnet.blockExplorers.default.url}/address/${validOtfAddress}`} target="_blank" rel="noreferrer">
                  Inspect OTF contract <ExternalLink size={12} />
                </a>
              ) : null}
            </>
          ) : (
            <div className="validationSummary"><Info size={15} /><div><strong>{mainnet ? "Mainnet markets are not indexed yet" : "Unsupported network"}</strong><span>{mainnet ? "Use Uniswap to create pools and manage positions. Discovery will appear after the production deployment is configured." : "Switch to Robinhood Testnet to use the testnet liquidity workspace."}</span></div></div>
          )}
        </aside>

        <section className="liquidityVenuePanel">
          <div className="liquidityPanelHeading">
            <ExternalLink size={16} />
            <div><strong>Manage on {venueName}</strong><span>{testnet ? "Robinhood Chain Testnet" : mainnet ? "Robinhood Chain Mainnet" : "External liquidity venue"}</span></div>
          </div>
          <div className="liquidityVenueMessage">
            <strong>One venue for the complete liquidity lifecycle</strong>
            <p>Create a pool, choose its initial price, add or remove liquidity, collect fees, and manage positions directly on {venueName}.</p>
          </div>
          {(testnet || mainnet) ? (
            <a className="primaryAction liquidityVenueAction" href={venueUrl} target="_blank" rel="noreferrer">
              Open {venueName} liquidity <ExternalLink size={14} />
            </a>
          ) : <button className="primaryAction liquidityVenueAction" type="button" disabled>Unsupported network</button>}
          <p className="liquidityHelper">The OTF app never takes custody of liquidity-position assets or submits pool-management transactions.</p>
        </section>
      </div>
    </DashboardPage>
  );
}

function CreateSurface() {
  const steps = [
    { label: "Basics", description: "Identity and mandate" },
    { label: "Constituents", description: "Ordered assets" },
    { label: "Economics", description: "Fee and beneficiary" },
    { label: "Review", description: "Confirm formation" },
  ] as const;
  const [step, setStep] = useState(0);
  const [furthestStep, setFurthestStep] = useState(0);
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [mandate, setMandate] = useState("");
  const [expenseRatio, setExpenseRatio] = useState("0");
  const [beneficiary, setBeneficiary] = useState("");
  const [constituents, setConstituents] = useState<ConstituentInput[]>([{ address: "" }]);
  const [submitted, setSubmitted] = useState(false);
  const annualExpenseRatioBps = expenseRatio === "" ? Number.NaN : Number(expenseRatio);
  const errors = creationValidation({ name, symbol, mandate, constituents, annualExpenseRatioBps, beneficiary });
  const structurallyValid = submitted && errors.length === 0;
  const normalizedName = name.trim();
  const nameValid = normalizedName.length > 4 && normalizedName.endsWith(" OTF");
  const tickerValid = /^[A-Z0-9][A-Z0-9-]*$/.test(symbol);
  const mandateBytes = new TextEncoder().encode(mandate.trim()).length;
  const mandateValid = mandateBytes > 0 && mandateBytes <= MAX_OTF_MANDATE_BYTES;
  const basicsIssues = [
    nameValid ? null : "Enter the complete fund name ending in ' OTF' (for example, 'Technology Leaders OTF').",
    tickerValid ? null : "Enter a ticker using letters, numbers, or hyphens.",
    mandateBytes > 0 ? null : "Write an initial strategy rationale.",
    mandateBytes <= MAX_OTF_MANDATE_BYTES ? null : `Shorten the initial strategy rationale to ${MAX_OTF_MANDATE_BYTES.toLocaleString("en-US")} bytes or fewer.`,
  ].filter((issue): issue is string => Boolean(issue));
  const normalizedConstituents = constituents.map((asset) => asset.address.trim().toLowerCase()).filter(Boolean);
  const stepValid = [
    nameValid && tickerValid && mandateValid,
    constituents.length > 0
      && constituents.length <= 20
      && constituents.every((asset) => isAddress(asset.address))
      && new Set(normalizedConstituents).size === normalizedConstituents.length,
    Number.isFinite(annualExpenseRatioBps)
      && annualExpenseRatioBps >= 0
      && annualExpenseRatioBps <= 1000
      && isAddress(beneficiary),
    true,
  ];

  function updateConstituent(index: number, value: string) {
    setConstituents((current) => current.map((asset, assetIndex) => assetIndex === index ? { ...asset, address: value } : asset));
  }

  return (
    <DashboardPage>
      <div className="appView">
        <AppPageHeader title="Create OTF" description="Deploy an onchain traded fund with enforceable portfolio limits." icon={<FilePlus2 size={18} />} />
        <div className="createLayout">
          <aside className="createSteps" aria-label="OTF creation progress">
            {steps.map((item, index) => (
              <button
                className={`${step === index ? "active" : ""} ${index < step || structurallyValid ? "complete" : ""}`}
                key={item.label}
                type="button"
                disabled={index > furthestStep}
                aria-current={step === index ? "step" : undefined}
                onClick={() => setStep(index)}
              >
                <span>{index < step || structurallyValid ? <CheckCircle size={14} /> : index + 1}</span>
                <div><strong>{item.label}</strong><small>{item.description}</small></div>
              </button>
            ))}
            <div className="createNotice"><LockKeyhole size={14} /><span>Constituent weights are calculated from the authenticated formation snapshot. They are not entered by the creator.</span></div>
          </aside>

          <section className="sectionCard createForm">
            <div className="sectionTitle">
              <div className="sectionHeading"><div className="sectionTitleLine"><span className="stepNumber">{step + 1}</span><h2>{steps[step].label}</h2></div><p>{steps[step].description}</p></div>
              <span className="stateBadge muted">Step {step + 1} of {steps.length}</span>
            </div>
            <div className="sectionBody">
              {step === 0 ? (
                <div className="formSection">
                  <div className="formGrid twoColumns">
                    <label><span>OTF name</span><input value={name} onChange={(event) => setName(event.target.value)} onBlur={() => setName((current) => current.trimEnd())} placeholder="Technology Leaders OTF" aria-label="OTF name" /><small>Must end in &apos; OTF&apos;. The name cannot be changed after formation.</small></label>
                    <label><span>OTF ticker</span><input value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 16))} placeholder="TECH" /><small>The ticker cannot be changed after formation.</small></label>
                  </div>
                  <label>
                    <div className="subHeader">
                      <span>Initial strategy rationale</span>
                      <small className={mandateValid ? "successText" : mandateBytes > MAX_OTF_MANDATE_BYTES ? "dangerText" : "warningText"}>{mandateBytes.toLocaleString("en-US")} / {MAX_OTF_MANDATE_BYTES.toLocaleString("en-US")} bytes</small>
                    </div>
                    <textarea value={mandate} onChange={(event) => setMandate(event.target.value)} placeholder="Describe the portfolio mandate and investment rationale." rows={4} maxLength={MAX_OTF_MANDATE_BYTES} aria-invalid={!mandateValid} />
                    <small>This becomes the fund&apos;s initial mandate and cannot be empty.</small>
                  </label>
                  {basicsIssues.length ? (
                    <div className="validationSummary" role="status" aria-live="polite">
                      <CircleAlert size={15} />
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
                  <div className="formIntro"><div><strong>Ordered constituent basket</strong><span>Add between 1 and 20 unique ERC-20 contracts.</span></div><span className="stateBadge muted">{constituents.length} / 20 assets</span></div>
                  <div className="createAssetList">
                    {constituents.map((asset, index) => (
                      <div className="createAssetRow noWeights" key={index}>
                        <label><span className="createAssetFieldLabel">Token contract {index + 1}</span><input value={asset.address} onChange={(event) => updateConstituent(index, event.target.value)} placeholder="0x…" aria-label={`Constituent ${index + 1} address`} /></label>
                        <button className="removeCreateAsset" type="button" aria-label={`Remove constituent ${index + 1}`} disabled={constituents.length === 1} onClick={() => setConstituents((current) => current.filter((_, assetIndex) => assetIndex !== index))}><X size={15} /></button>
                      </div>
                    ))}
                  </div>
                  <button type="button" className="secondaryAction addCreateAsset" disabled={constituents.length >= 20} onClick={() => setConstituents((current) => [...current, { address: "" }])}><Plus size={14} />Add constituent</button>
                  <div className="validationSummary" role="note"><Info size={15} /><div><strong>No creator-entered weights</strong><span>The snapshot authority supplies market caps, unit prices, and expected decimals for this exact ordered list.</span></div></div>
                </div>
              ) : null}

              {step === 2 ? (
                <div className="formSection">
                  <div className="formGrid twoColumns">
                    <label><span>Annual creator expense ratio</span><div className="inputWithSuffix"><input inputMode="numeric" value={expenseRatio} onChange={(event) => setExpenseRatio(event.target.value)} /><span>bps</span></div><small>0–1000 bps. The value is immutable after formation.</small></label>
                    <label><span>Fixed beneficiary</span><input value={beneficiary} onChange={(event) => setBeneficiary(event.target.value)} placeholder="0x…" /><small>The beneficiary is fixed in the formation transaction.</small></label>
                  </div>
                  <aside className="riskCallout warning"><CircleAlert size={15} /><div><strong>10% is the protocol maximum and is not recommended.</strong><span>Creator expense shares can dilute holders. The formation-allocation rebate benefits the creator and does not reduce the holder fee.</span></div></aside>
                </div>
              ) : null}

              {step === 3 ? (
                <div className="formSection reviewSection">
                  <div className="reviewHero"><span className="vaultMonogram">NEW</span><div><h2>{name.trim() || "Unnamed OTF"}</h2><span>{symbol.trim() || "No ticker"} · {constituents.length} constituent{constituents.length === 1 ? "" : "s"}</span></div></div>
                  <div className="reviewGrid">
                    <div className="reviewKeyMetric"><span>Annual creator expense ratio</span><strong>{Number.isFinite(annualExpenseRatioBps) ? `${annualExpenseRatioBps} bps` : "Not set"}</strong></div>
                    <div><span>Beneficiary</span><strong>{isAddress(beneficiary) ? shortAddress(beneficiary) : "Invalid address"}</strong></div>
                    <div><span>Formation</span><strong>Authenticated snapshot</strong></div>
                  </div>
                  <div><div className="subHeader"><span>Ordered constituents</span><small>No weights entered</small></div><div className="reviewPortfolio">{constituents.map((asset, index) => <span key={`${asset.address}-${index}`}><strong>{index + 1}</strong><small>{isAddress(asset.address) ? shortAddress(asset.address) : "Invalid token address"}</small></span>)}</div></div>
                  <aside className="snapshotNote"><History size={17} /><div><strong>Authenticated formation snapshot required</strong><p>The authority signature binds the chain, factory, creator, ordered constituents, expected decimals, market caps, unit prices, snapshot time, expiry, calculation version, and nonce.</p></div></aside>
                  {submitted && errors.length ? <div className="formErrors" role="alert">{errors.map((error) => <span key={error}>{error}</span>)}</div> : null}
                  {structurallyValid ? <div className="validationSummary success" role="status"><CheckCircle size={15} /><div><strong>Formation input is structurally valid</strong><span>No transaction or formation snapshot has been prepared.</span></div></div> : null}
                  <p className="createBlocked">Creation remains unavailable until the redesigned contracts, authenticated snapshot service, and typed create transaction are configured.</p>
                </div>
              ) : null}

              <div className="createFormActions">
                <button className="secondaryAction" type="button" onClick={() => step === 0 ? window.location.assign("/funds") : setStep((current) => current - 1)}><ArrowLeft size={14} />{step === 0 ? "Back to OTFs" : "Back"}</button>
                {step < steps.length - 1 ? (
                  <button className="primaryAction" type="button" disabled={!stepValid[step]} onClick={() => { setSubmitted(false); setFurthestStep((current) => Math.max(current, step + 1)); setStep((current) => current + 1); }}>Continue<ArrowRight size={14} /></button>
                ) : <button className="primaryAction" type="button" onClick={() => setSubmitted(true)}><FilePlus2 size={14} />Validate formation input</button>}
              </div>
            </div>
          </section>
        </div>
      </div>
    </DashboardPage>
  );
}

function FundsSurface({ detail }: { detail: boolean }) {
  const routeAddress = addressFromLocation();
  const chainId = useChainId();
  const testnet = chainId === robinhoodChainTestnet.id;
  const [directoryView, setDirectoryView] = useState<"rows" | "cards">("rows");
  if (detail) {
    return (
      <DashboardPage>
        <div className="appView">
          <div className="vaultBreadcrumb appBreadcrumb"><Link href="/funds"><ArrowLeft size={12} />OTFs</Link></div>
          <AppPageHeader title={routeAddress ? shortAddress(routeAddress) : "No OTF connected"} description="Identity and formation history for this address-routed fund." icon={<LayoutGrid size={18} />} />
          <section className="sectionCard detailIdentityCard">
            <div className="directoryPanelHeading"><div><h2>Fund details</h2><p>Onchain reads are not configured for the redesigned deployment.</p></div><span className="stateBadge muted">Unavailable</span></div>
            <dl><div><dt>Fund address</dt><dd>{routeAddress ?? "No valid fund address appears in this route."}</dd></div><div><dt>History</dt><dd>No activity is substituted while the typed history reader is unavailable.</dd></div><div><dt>Metadata</dt><dd>Name and symbol must resolve onchain before an identity result is shown.</dd></div></dl>
          </section>
        </div>
      </DashboardPage>
    );
  }
  return (
    <DashboardPage>
      <div className="appView">
        <AppPageHeader
          title="Onchain Traded Funds"
          description="Discover and monitor managed onchain funds."
          icon={<LayoutGrid size={18} />}
          actions={<><Link className="secondaryAction" href="/verified"><ShieldCheck size={14} />Verified</Link><Link className="primaryAction" href="/create">Create an OTF<ArrowUpRight size={14} /></Link></>}
        />
        {!testnet ? (
          <section className="sectionCard depositsEmpty"><span><Network size={22} /></span><h2>Robinhood Mainnet is not supported yet</h2><p>No assets, liquidity adapters, or OTF deployments are configured on Robinhood Mainnet. Enable Testnet in Settings to use the current protocol deployment.</p></section>
        ) : (
          <>
            <div className="validationSummary directoryDataNotice" role="status"><History size={15} /><div><strong>Onchain directory data</strong><span>The redesigned deployment is not configured. No preview funds or aggregate values are substituted.</span></div></div>
            <div className="directoryMetrics"><MetricCard label="Total AUM" value="Unavailable" /><MetricCard label="OTFs" value="0" /></div>
            <section className="sectionCard directoryPanel">
              <div className="directoryToolbar">
                <label className="searchField"><Search size={14} /><input aria-label="Search OTFs" placeholder="Search by OTF name or symbol" disabled /></label>
                <div className="directoryViewToggle" role="group" aria-label="OTF directory view">
                  <button className={directoryView === "rows" ? "active" : ""} type="button" aria-label="Show OTFs as rows" aria-pressed={directoryView === "rows"} onClick={() => setDirectoryView("rows")}><List size={15} /></button>
                  <button className={directoryView === "cards" ? "active" : ""} type="button" aria-label="Show OTFs as cards" aria-pressed={directoryView === "cards"} onClick={() => setDirectoryView("cards")}><LayoutGrid size={15} /></button>
                </div>
              </div>
              <div className={directoryView === "cards" ? "directoryCardsWrap" : "directoryTableWrap"}>
                <table className="directoryTable" aria-label="Onchain traded funds"><thead><tr><th>OTF</th><th>NAV</th><th>Assets</th><th>Manager fee</th><th>Manager</th></tr></thead><tbody /></table>
                <div className="emptyDirectory"><Search size={18} /><strong>No testnet OTFs yet</strong><span>New OTFs will appear here automatically.</span></div>
              </div>
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
        <div className="vaultBreadcrumb appBreadcrumb"><Link href="/funds"><ArrowLeft size={12} />Funds</Link></div>
        <AppPageHeader title="Verified Assets" description={<>Token identities and pricing routes checked against the app&apos;s <a href="/verified-assets.json" target="_blank" rel="noreferrer">verification registry</a>. Verification is informational and does not authorize OTF constituents.</>} icon={<ShieldCheck size={18} />} actions={testnet ? <a className="secondaryAction" href="https://faucet.testnet.chain.robinhood.com/" target="_blank" rel="noreferrer"><Droplets size={14} />Testnet faucet<ExternalLink size={12} /></a> : undefined} />
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

function WalletSurface() {
  const chainId = useChainId();
  const testnet = chainId === robinhoodChainTestnet.id;
  const { address } = useAccount();
  const [addressCopied, setAddressCopied] = useState(false);
  const usdg = configuredUsdgFor(chainId);
  const { data: nativeBalance, isLoading: nativeBalanceLoading } = useBalance({ address, chainId, query: { enabled: Boolean(address && testnet) } });
  const { data: usdgBalance, isLoading: usdgBalanceLoading } = useBalance({ address, token: usdg?.address, chainId, query: { enabled: Boolean(address && testnet && usdg) } });

  async function copyWalletAddress() {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setAddressCopied(true);
    window.setTimeout(() => setAddressCopied(false), 1800);
  }

  return (
    <DashboardPage>
      <div className="appView">
        <AppPageHeader title="My wallet" description="Your OTF share positions and network balance." icon={<Wallet size={18} />} actions={<><WalletConnectionAction /><Link className="secondaryAction walletExploreAction" href="/funds"><LayoutGrid size={14} />Explore OTFs</Link></>} />
        {!testnet ? <section className="sectionCard depositsEmpty"><span><Network size={22} /></span><h2>Robinhood Mainnet is not supported yet</h2><p>Switch to Robinhood Testnet in Settings to view deployed OTF positions.</p></section> : address ? (
          <>
            <div className="depositMetrics walletMetrics">
              <article className="metricCard walletAddressMetric"><div className="metricLabel"><span>Wallet address</span><div className="walletAddressActions">{addressCopied ? <span className="walletAddressCopyFeedback" role="status" aria-live="polite">Copied</span> : null}<button className="iconOnly compact" type="button" title={addressCopied ? "Wallet address copied" : "Copy wallet address"} onClick={copyWalletAddress} aria-label={addressCopied ? "Wallet address copied" : "Copy wallet address"}>{addressCopied ? <Check size={13} /> : <Copy size={13} />}</button><a className="iconOnly compact" href={`${robinhoodChainTestnet.blockExplorers.default.url}/address/${address}`} target="_blank" rel="noreferrer" title="Open wallet in block explorer" aria-label="Open wallet in block explorer in a new tab"><ExternalLink size={13} /></a></div></div><div className="walletAddressValue"><strong title={address}>{shortAddress(address)}</strong></div></article>
              <MetricCard label="OTF Positions" value="0" />
              <MetricCard label="USDG Balance" value={usdgBalanceLoading ? "Loading" : usdgBalance ? `${Number(usdgBalance.formatted).toLocaleString(undefined, { maximumFractionDigits: 4 })} USDG` : "0 USDG"} action={<a className="metricCardFaucetAction" href="https://faucet.paxos.com/" target="_blank" rel="noreferrer" title="Open USDG faucet" aria-label="Open USDG faucet in a new tab"><Droplets className="metricCardFaucetIcon" size={14} aria-hidden="true" /><span>Faucet</span><ExternalLink className="metricCardFaucetExternalIcon" size={10} aria-hidden="true" /></a>} />
              <MetricCard label="ETH Balance" value={nativeBalanceLoading ? "Loading" : nativeBalance ? `${Number(nativeBalance.formatted).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${nativeBalance.symbol}` : "Unavailable"} action={<a className="metricCardFaucetAction" href="https://faucet.testnet.chain.robinhood.com/" target="_blank" rel="noreferrer" title="Open Robinhood testnet ETH faucet" aria-label="Open Robinhood testnet ETH faucet in a new tab"><Droplets className="metricCardFaucetIcon" size={14} aria-hidden="true" /><span>Faucet</span><ExternalLink className="metricCardFaucetExternalIcon" size={10} aria-hidden="true" /></a>} />
            </div>
            <section className="sectionCard depositPositions"><div className="managedVaultsHeading"><div><span className="appPageIcon"><CircleDollarSign size={16} /></span><div><h2>OTF positions</h2><p>Shares held by the connected wallet.</p></div></div><span className="stateBadge muted">0 positions</span></div><div className="inlineEmptyState"><CircleDollarSign size={18} /><div><strong>No OTF positions found</strong><span>Your OTF shares will appear here after a purchase or deposit.</span></div></div></section>
            <section className="sectionCard managedVaultsPanel"><div className="managedVaultsHeading"><div><span className="appPageIcon"><UserCog size={16} /></span><div><h2>OTFs you manage</h2><p>Manager controls and protocol operations for OTFs currently managed by this wallet.</p></div></div><div className="managedVaultsHeaderActions"><Link className="secondaryAction" href="/create">Create OTF</Link></div></div><div className="inlineEmptyState"><UserCog size={18} /><div><strong>No managed OTFs found</strong><span>OTFs will appear here whenever this wallet is their current manager.</span></div></div></section>
          </>
        ) : (
          <section className="sectionCard depositsEmpty">
            <span><Wallet size={22} /></span>
            <h2>
              <ConnectButton.Custom>
                {({ mounted, openConnectModal }) => (
                  <button className="depositsConnectLink" type="button" disabled={!mounted} onClick={openConnectModal}>Connect your wallet</button>
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
  if (initialView === "liquidity") return <LiquiditySurface />;
  if (initialView === "create") return <CreateSurface />;
  if (initialView === "vaults") return <FundsSurface detail={false} />;
  if (initialView === "detail") return <FundsSurface detail />;
  if (initialView === "verified") return <VerifiedSurface />;
  if (initialView === "wallet") return <WalletSurface />;
  return <SwapSurface />;
}

export function OperateExperience({ initialView = "landing" }: { initialView?: OperateView }) {
  return <Providers><OperateRouter initialView={initialView} /></Providers>;
}
