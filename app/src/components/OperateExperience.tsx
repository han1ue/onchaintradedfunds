"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectButton, useConnectModal } from "@rainbow-me/rainbowkit";
import { OtfBrandMark } from "@onchaintradedfunds/brand";
import {
  ArrowLeft,
  ArrowRight,
  ArrowDown,
  ArrowUpRight,
  BadgeCheck,
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
  Trash2,
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
import { robinhoodMainnetAddresses, robinhoodTestnetAddresses, robinhoodTestnetDeploymentReady } from "@/lib/deployment";
import {
  bestQueriedQuote,
  assetHasExecutableMetadata,
  creationValidation,
  decimalInputValue,
  ERC20_APPROVE_ABI,
  executionPlanForQuote,
  isPositiveDecimalAmount,
  MAX_OTF_MANDATE_BYTES,
  pastedAsset,
  quoteIsFresh,
  quoteServiceForChain,
  requestConcurrentQuotes,
  routerArgsForExecution,
  supportedSwapDirection,
  validSwapPair,
  type SwapAsset,
  type SwapAssetKind,
  type SwapQuote,
} from "@/lib/swap-model";
import { navigationItemForPath } from "@/lib/operate-navigation";
import { ensureExactErc20Approval } from "@/lib/erc20-approval";
import { SplashPage } from "./SplashPage";
import { TestnetLiquiditySurface } from "./TestnetLiquiditySurface";

export type OperateView = "landing" | "swap" | "detail" | "vaults" | "create" | "verified" | "wallet" | "liquidity";

type AppearancePreference = "default" | "light" | "dark";

const DOCS_URL = "https://docs.onchaintradedfunds.com";
const REPOSITORY_URL = "https://github.com/han1ue/onchaintradedfunds";
const MAX_CONSTITUENT_DECIMALS = 36;
const ERC20_METADATA_READ_ABI = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
] as const;

type TokenMetadata = { name: string; symbol: string; decimals: number };

function useTokenMetadataLookup(chainId: number, address: Address | undefined) {
  const publicClient = usePublicClient({ chainId });
  const [metadata, setMetadata] = useState<TokenMetadata>();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!address || !publicClient) {
      setMetadata(undefined);
      setLoading(false);
      setFailed(false);
      return;
    }
    let cancelled = false;
    setMetadata(undefined);
    setLoading(true);
    setFailed(false);
    void (async () => {
      try {
        const decimals = await publicClient.readContract({ address, abi: ERC20_METADATA_READ_ABI, functionName: "decimals" });
        const [name, symbol] = await Promise.all([
          publicClient.readContract({ address, abi: ERC20_METADATA_READ_ABI, functionName: "name" }).catch(() => "Unindexed token"),
          publicClient.readContract({ address, abi: ERC20_METADATA_READ_ABI, functionName: "symbol" }).catch(() => "TOKEN"),
        ]);
        if (cancelled) return;
        setMetadata({
          name: String(name).trim().slice(0, 80) || "Unindexed token",
          symbol: String(symbol).trim().slice(0, 16) || "TOKEN",
          decimals: Number(decimals),
        });
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [address, publicClient]);

  return { metadata, loading, failed };
}

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
  const addresses = chainId === robinhoodChainTestnet.id
    ? robinhoodTestnetAddresses
    : chainId === robinhoodChain.id
      ? robinhoodMainnetAddresses
      : undefined;
  if (!addresses) return [];
  const assets: SwapAsset[] = [];
  if (addresses.usdg) {
    assets.push({
      address: addresses.usdg,
      symbol: "USDG",
      name: "USDG",
      kind: "erc20",
      decimals: chainId === robinhoodChain.id ? 6 : 18,
      metadataResolved: true,
      verified: true,
    });
  }
  if (chainId === robinhoodChainTestnet.id && robinhoodTestnetAddresses.weth) {
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
        <Link className="logoGroup" href="/" aria-label="Onchain Traded Funds">
          <OtfBrandMark />
          <span className="brandText"><strong>Onchain Traded Funds</strong></span>
        </Link>
        <nav className="navTabs" aria-label="Primary navigation">
          <Link className={current === "swap" ? "active" : ""} href="/">Swap</Link>
          <Link className={current === "funds" ? "active" : ""} href="/funds">Funds</Link>
          <a href={DOCS_URL} target="_blank" rel="noreferrer">Docs<ExternalLink size={12} /></a>
        </nav>
        <div className="navActions">
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
          <HeaderWalletControl active={pathname === "/wallet"} />
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

function HeaderWalletControl({ active }: { active: boolean }) {
  return (
    <ConnectButton.Custom>
      {({ account, mounted, authenticationStatus, openConnectModal }) => {
        const ready = mounted && authenticationStatus !== "loading";
        const connected = ready && account && (!authenticationStatus || authenticationStatus === "authenticated");
        if (!ready) return <button className="headerWalletButton" type="button" disabled>Wallet</button>;
        if (!connected) return <button className="headerWalletButton" type="button" onClick={openConnectModal}><Wallet size={14} /><span>Connect wallet</span></button>;
        return (
          <Link className={`headerWalletButton ${active ? "active" : ""}`} href="/wallet" title={`Open wallet: ${account.displayName}`}>
            <Wallet size={14} />
            <span>{account.displayName}</span>
          </Link>
        );
      }}
    </ConnectButton.Custom>
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
  return <div className={`metricCard${action ? " hasMetricAction" : ""}`}><span className="metricLabel">{label}</span><strong>{value}</strong>{action}</div>;
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
                <span className={`swapRouteState ${valid ? "ready" : ""}`}>{valid ? activeQuote?.id === quote.id ? "Selected" : "Use route" : quote.state}</span>
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
      </div>
    </details>
  );
}

function SwapSurface() {
  const chainId = useChainId();
  const { address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChain } = useSwitchChain();
  const publicClient = usePublicClient({ chainId });
  const { data: walletClient } = useWalletClient({ chainId });
  const configuredAssets = useMemo(() => configuredAssetsFor(chainId), [chainId]);
  const routeFundAddress = addressFromLocation();
  const routeFund = routeFundAddress ? { address: routeFundAddress, symbol: "OTF", name: "Unresolved fund route address", kind: "otf" as const, decimals: 18, metadataResolved: false } : undefined;
  const [input, setInput] = useState<SwapAsset>(() => configuredUsdgFor(robinhoodChainTestnet.id) ?? EMPTY_ERC20);
  const [output, setOutput] = useState<SwapAsset>(EMPTY_OTF);
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
  const swapSettingsRef = useRef<HTMLDivElement>(null);
  const pairValid = validSwapPair(input, output);
  const pairExecutable = assetHasExecutableMetadata(input) && assetHasExecutableMetadata(output);
  const directionSupported = supportedSwapDirection(input, output);
  const amountValid = isPositiveDecimalAmount(amount, input.decimals);
  const supportedNetwork = chainId === robinhoodChainTestnet.id || chainId === robinhoodChain.id;
  const usableQuote = Boolean(activeQuote && quoteIsFresh(activeQuote, now));
  const deploymentReady = chainId === robinhoodChainTestnet.id && robinhoodTestnetDeploymentReady;
  const quoteService = useMemo(() => quoteServiceForChain(chainId), [chainId]);
  const executionPlan = useMemo(() => executionPlanForQuote(activeQuote, chainId, now), [activeQuote, chainId, now]);
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
    const networkUsdg = configuredUsdgFor(chainId);
    setInput((current) => current.verified ? networkUsdg ?? EMPTY_ERC20 : current);
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
      await ensureExactErc20Approval(allowance, executionPlan.approval.amount, async (approvalAmount) => {
        const approvalHash = await walletClient.writeContract({
          account: address,
          address: executionPlan.approval.token,
          abi: ERC20_APPROVE_ABI,
          functionName: "approve",
          args: [executionPlan.approval.spender, approvalAmount],
        });
        const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash });
        if (approvalReceipt.status !== "success") {
          throw new Error(approvalAmount === 0n ? "The token approval reset reverted." : "The exact token approval reverted.");
        }
      });
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
  const statusMessage = executionMessage
    ?? (!supportedNetwork
      ? "Switch to Robinhood Chain to continue."
      : !deploymentReady
        ? "Swaps are unavailable until the entry router and typed quote endpoint are configured."
        : amount && !amountValid
          ? "Enter a positive amount within the selected token's decimal precision."
          : !pairValid
            ? "Choose two different assets."
            : !pairExecutable
              ? "Resolve token decimals and OTF factory identity to request a quote."
              : !directionSupported
                ? "Choose an OTF share for one side of the swap."
                : quotes.some((quote) => quote.state === "loading")
                  ? "Finding the best available queried route…"
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

  return (
    <div className="operateShell">
      <OperateNav />
      <main className="swapMain">
        <section className="swapCard" aria-label="Swap tokens">
          <div className="swapCardHeader">
            <strong>Swap</strong>
            <div className="swapSettingsControl" ref={swapSettingsRef}>
              <button type="button" className={`swapIconButton ${swapSettingsOpen ? "active" : ""}`} title="Swap settings" aria-label="Open swap settings" aria-haspopup="dialog" aria-expanded={swapSettingsOpen} onClick={() => setSwapSettingsOpen((open) => !open)}><SlidersHorizontal size={16} /></button>
              {swapSettingsOpen ? (
                <div className="swapSettingsPopover" role="dialog" aria-label="Swap settings">
                  <label><span>Maximum slippage</span><select value={slippageBps} onChange={(event) => setSlippageBps(Number(event.target.value))}><option value={50}>0.5%</option><option value={100}>1.0%</option><option value={300}>3.0%</option></select></label>
                  <small>The quote&apos;s minimum received amount reflects this tolerance.</small>
                </div>
              ) : null}
            </div>
          </div>
          <div className="swapPair">
            <div className="swapAmountBox">
              <div className="swapAmountTop"><span>You pay</span><span>{inputBalanceLoading ? "Loading balance" : inputBalance ? `Balance ${inputBalance.formatted}` : "Balance unavailable"} <button type="button" disabled={!inputBalance || inputBalance.value === 0n} title={inputBalance ? `Use the full ${input.symbol} balance` : "A resolved wallet balance is required before MAX can be used"} onClick={() => inputBalance && setAmount(inputBalance.formatted)}>MAX</button></span></div>
              <div className="swapAmountEntry"><input inputMode="decimal" value={amount} onChange={(event) => { const next = decimalInputValue(event.target.value); if (next !== undefined) setAmount(next); }} placeholder="0" aria-label={`Amount of ${input.symbol} to pay`} /><button type="button" className="swapAssetButton" onClick={() => setPicker("input")}><AssetMark asset={input} /><strong>{input.symbol}</strong><ChevronDown size={15} /></button></div>
            </div>
            <button type="button" className="swapReverse" onClick={reverse} aria-label="Reverse swap direction"><ArrowDown size={20} /></button>
            <div className="swapAmountBox receive">
              <div className="swapAmountTop"><span>You receive</span><span>{outputBalanceLoading ? "Loading balance" : outputBalance ? `Balance ${outputBalance.formatted}` : "Balance unavailable"}</span></div>
              <div className="swapAmountEntry"><output aria-label={`Expected ${output.symbol} output`}>{usableQuote ? activeQuote?.outputAmount ?? "0" : "0"}</output><button type="button" className="swapAssetButton" onClick={() => setPicker("output")}><AssetMark asset={output} /><strong>{output.symbol}</strong><ChevronDown size={15} /></button></div>
            </div>
          </div>
          <button type="button" className="swapPrimary" disabled={address && supportedNetwork ? !canExecute : false} onClick={handlePrimaryAction}>{primaryLabel}</button>
          {statusMessage ? <p className={`swapStatusLine ${execution === "failure" ? "failure" : execution === "success" ? "success" : ""}`} aria-live="polite">{statusMessage}</p> : null}
          {quotes.length ? <QuoteReview quotes={quotes} activeQuote={activeQuote} onChoose={(quote) => { setActiveQuote(quote); setExecution("idle"); setExecutionMessage(undefined); }} onRefresh={() => setQuoteRequest((current) => current + 1)} inputSymbol={input.symbol} outputSymbol={output.symbol} now={now} executionConfigured={deploymentReady} /> : null}
        </section>
      </main>
      <div className="swapFooterFrame"><OperateFooter /></div>
      {picker ? <TokenPicker title={picker === "input" ? "Select token to pay" : "Select token to receive"} onClose={() => setPicker(undefined)} onSelect={(asset) => selectAsset(picker, asset)} selected={picker === "input" ? input : output} exclude={picker === "input" ? output : input} routeFund={routeFund} configuredAssets={configuredAssets} /> : null}
    </div>
  );
}

type ConstituentInput = {
  address: string;
  symbol: string;
  name: string;
  decimals?: number;
  verified: boolean;
};

function constituentFromAsset(asset: SwapAsset): ConstituentInput {
  return { address: asset.address, symbol: asset.symbol, name: asset.name, decimals: asset.decimals, verified: asset.verified === true };
}

function emptyConstituent(): ConstituentInput {
  return { address: "", symbol: "Select asset", name: "Search verified assets or add by address", verified: false };
}

function DashboardPage({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className="operateShell"><OperateNav /><main className={`dashboardMain${className ? ` ${className}` : ""}`}>{children}<OperateFooter /></main></div>;
}

function LiquiditySurface() {
  return (
    <DashboardPage className="liquidityPage">
      <TestnetLiquiditySurface />
    </DashboardPage>
  );
}

function CreateSurface() {
  const chainId = useChainId();
  const configuredConstituentAssets = useMemo(() => configuredAssetsFor(chainId), [chainId]);
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
  const [constituents, setConstituents] = useState<ConstituentInput[]>(() => {
    const initialAssets = configuredAssetsFor(chainId).slice(0, 2).map(constituentFromAsset);
    return initialAssets.length ? initialAssets : [emptyConstituent()];
  });
  const [returnDestination, setReturnDestination] = useState<"funds" | "wallet">("funds");
  const [openAssetPickerIndex, setOpenAssetPickerIndex] = useState<number>();
  const [assetPickerSearch, setAssetPickerSearch] = useState("");
  const [unverifiedAssetIndex, setUnverifiedAssetIndex] = useState<number>();
  const [manualAssetAddress, setManualAssetAddress] = useState("");
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
  const constituentIssues = [
    constituents.length > 0 ? null : "Select at least one asset to continue.",
    constituents.length <= 20 ? null : "Remove assets until the portfolio contains no more than 20.",
    constituents.every((asset) => isAddress(asset.address)) ? null : "Choose a token contract for every asset row.",
    new Set(normalizedConstituents).size === normalizedConstituents.length ? null : "Each contract address can appear only once.",
  ].filter((issue): issue is string => Boolean(issue));
  const normalizedAssetPickerSearch = assetPickerSearch.trim().toLowerCase();
  const filteredAssetPickerOptions = configuredConstituentAssets.filter((candidate) => !normalizedAssetPickerSearch
    || candidate.symbol.toLowerCase().includes(normalizedAssetPickerSearch)
    || candidate.name.toLowerCase().includes(normalizedAssetPickerSearch)
    || candidate.address.toLowerCase().includes(normalizedAssetPickerSearch));
  const assetSearchAddress = isAddress(assetPickerSearch.trim()) ? getAddress(assetPickerSearch.trim()) : undefined;
  const assetSearchConfigured = assetSearchAddress
    ? configuredConstituentAssets.some((candidate) => candidate.address.toLowerCase() === assetSearchAddress.toLowerCase())
    : false;
  const { metadata: assetSearchMetadata, loading: assetSearchMetadataPending } = useTokenMetadataLookup(chainId, assetSearchAddress && !assetSearchConfigured ? assetSearchAddress : undefined);
  const manualAssetAddressValue = isAddress(manualAssetAddress) ? getAddress(manualAssetAddress) : undefined;
  const { metadata: manualAssetMetadata, loading: manualAssetMetadataPending, failed: manualAssetMetadataReadFailed } = useTokenMetadataLookup(chainId, manualAssetAddressValue);
  const manualVerifiedAsset = manualAssetAddressValue
    ? configuredConstituentAssets.find((candidate) => candidate.address.toLowerCase() === manualAssetAddressValue.toLowerCase())
    : undefined;
  const manualAssetDuplicate = manualAssetAddressValue
    ? constituents.some((asset, index) => index !== unverifiedAssetIndex && asset.address.toLowerCase() === manualAssetAddressValue.toLowerCase())
    : false;
  const manualAssetCompatible = Boolean(manualAssetMetadata && Number.isInteger(manualAssetMetadata.decimals) && manualAssetMetadata.decimals >= 0 && manualAssetMetadata.decimals <= MAX_CONSTITUENT_DECIMALS);
  const nextAvailableAsset = configuredConstituentAssets.find((candidate) => !constituents.some((asset) => asset.address.toLowerCase() === candidate.address.toLowerCase()));
  const returnHref = returnDestination === "wallet" ? "/wallet" : "/funds";
  const returnLabel = returnDestination === "wallet" ? "Wallet" : "Funds";
  const stepValid = [
    nameValid && tickerValid && mandateValid,
    constituentIssues.length === 0,
    Number.isFinite(annualExpenseRatioBps)
      && annualExpenseRatioBps >= 0
      && annualExpenseRatioBps <= 1000
      && isAddress(beneficiary),
    true,
  ];

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("from") === "wallet") setReturnDestination("wallet");
  }, []);

  useEffect(() => {
    if (openAssetPickerIndex === undefined) return;
    const closePicker = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".assetPickerShell")) return;
      setOpenAssetPickerIndex(undefined);
      setAssetPickerSearch("");
    };
    const closePickerOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpenAssetPickerIndex(undefined);
      setAssetPickerSearch("");
    };
    document.addEventListener("pointerdown", closePicker);
    document.addEventListener("keydown", closePickerOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closePicker);
      document.removeEventListener("keydown", closePickerOnEscape);
    };
  }, [openAssetPickerIndex]);

  useEffect(() => {
    if (unverifiedAssetIndex === undefined) return;
    const closeModalOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setUnverifiedAssetIndex(undefined);
      setManualAssetAddress("");
    };
    document.addEventListener("keydown", closeModalOnEscape);
    return () => document.removeEventListener("keydown", closeModalOnEscape);
  }, [unverifiedAssetIndex]);

  function updateConstituent(index: number, asset: ConstituentInput) {
    setConstituents((current) => current.map((item, assetIndex) => assetIndex === index ? asset : item));
  }

  function selectConfiguredAsset(index: number, asset: SwapAsset) {
    updateConstituent(index, constituentFromAsset(asset));
    setOpenAssetPickerIndex(undefined);
    setAssetPickerSearch("");
  }

  function addAsset() {
    if (constituents.length >= 20) return;
    if (nextAvailableAsset) {
      setConstituents((current) => [...current, constituentFromAsset(nextAvailableAsset)]);
      return;
    }
    setConstituents((current) => [...current, emptyConstituent()]);
    setOpenAssetPickerIndex(constituents.length);
    setAssetPickerSearch("");
  }

  function removeAsset(index: number) {
    setConstituents((current) => current.filter((_, assetIndex) => assetIndex !== index));
    setOpenAssetPickerIndex(undefined);
    setAssetPickerSearch("");
  }

  function openUnverifiedAssetModal(index: number, address = "") {
    setOpenAssetPickerIndex(undefined);
    setAssetPickerSearch("");
    setUnverifiedAssetIndex(index);
    setManualAssetAddress(address);
  }

  function closeUnverifiedAssetModal() {
    setUnverifiedAssetIndex(undefined);
    setManualAssetAddress("");
  }

  function addManualAsset() {
    if (unverifiedAssetIndex === undefined || !manualAssetAddressValue || !manualAssetMetadata || !manualAssetCompatible || manualAssetDuplicate) return;
    updateConstituent(unverifiedAssetIndex, manualVerifiedAsset ? constituentFromAsset(manualVerifiedAsset) : {
      address: manualAssetAddressValue,
      symbol: manualAssetMetadata.symbol,
      name: manualAssetMetadata.name,
      decimals: manualAssetMetadata.decimals,
      verified: false,
    });
    closeUnverifiedAssetModal();
  }

  return (
    <DashboardPage>
      <div className="appView">
        <div className="vaultBreadcrumb appBreadcrumb"><Link href={returnHref}><ArrowLeft size={12} />Back to {returnLabel}</Link></div>
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
                  <div className="formIntro"><div><strong>Initial portfolio</strong></div><span className={`stateBadge ${constituentIssues.length ? "danger" : "success"}`}>{constituents.length} / 20 assets</span></div>
                  <div className="createAssetList">
                    {constituents.map((asset, index) => (
                      <div className="createAssetRow noWeights constituentAssetRow" key={`${asset.address || "new"}-${index}`}>
                        <div className="assetSelectField">
                          <span className="createAssetFieldLabel">Asset</span>
                          <div className="assetPickerShell">
                            <button className={`createAssetPicker ${openAssetPickerIndex === index ? "active" : ""}`} type="button" aria-label={`Choose asset ${index + 1}`} aria-haspopup="listbox" aria-expanded={openAssetPickerIndex === index} onClick={() => { setAssetPickerSearch(""); setOpenAssetPickerIndex((current) => current === index ? undefined : index); }}>
                              <span className="createAssetPickerIdentity">
                                <span className="createAssetPickerName">
                                  <strong>{asset.symbol}</strong>
                                  {asset.address ? asset.verified ? <BadgeCheck className="createAssetVerificationIcon" size={13} aria-label="Verified asset"><title>Verified</title></BadgeCheck> : <CircleAlert className="createAssetVerificationIcon unverified" size={13} aria-label="Unverified asset"><title>Unverified</title></CircleAlert> : null}
                                </span>
                                <small>{asset.address ? `${asset.name} · ${shortAddress(asset.address)}` : asset.name}</small>
                              </span>
                              <ChevronDown aria-hidden="true" size={14} />
                            </button>
                            {openAssetPickerIndex === index ? (
                              <div className="createAssetPickerMenu">
                                <label className="createAssetPickerSearch"><Search size={14} aria-hidden="true" /><input autoFocus value={assetPickerSearch} onChange={(event) => setAssetPickerSearch(event.target.value)} placeholder="Search name, ticker, or contract address" aria-label={`Search assets for position ${index + 1}`} autoComplete="off" spellCheck={false} /></label>
                                <div className="createAssetPickerOptions" role="listbox" aria-label={`Assets for position ${index + 1}`}>
                                  {filteredAssetPickerOptions.map((candidate) => (
                                    <button key={candidate.address} type="button" role="option" aria-selected={candidate.address.toLowerCase() === asset.address.toLowerCase()} onClick={() => selectConfiguredAsset(index, candidate)}>
                                      <span className="createAssetOptionIdentity"><span className="createAssetOptionTicker"><strong>{candidate.symbol}</strong><BadgeCheck className="createAssetVerificationIcon" size={13} aria-label="Verified asset"><title>Verified</title></BadgeCheck></span><small>{candidate.name}</small><small>{shortAddress(candidate.address)}</small></span>
                                      {candidate.address.toLowerCase() === asset.address.toLowerCase() ? <Check size={13} aria-hidden="true" /> : null}
                                    </button>
                                  ))}
                                  {assetSearchMetadataPending ? <div className="createAssetPickerStatus" role="status"><LoaderCircle className="createAssetSpinner" size={14} />Reading token metadata…</div> : null}
                                  {assetSearchAddress && !assetSearchMetadataPending && assetSearchMetadata ? (
                                    <button className="createAssetDiscoveredOption" type="button" role="option" aria-selected={assetSearchAddress.toLowerCase() === asset.address.toLowerCase()} disabled={assetSearchMetadata.decimals > MAX_CONSTITUENT_DECIMALS} onClick={() => openUnverifiedAssetModal(index, assetSearchAddress)}>
                                      <span className="createAssetOptionIdentity"><span className="createAssetOptionTicker"><strong>{assetSearchMetadata.symbol}</strong><CircleAlert className="createAssetVerificationIcon unverified" size={13} aria-label="Unverified asset"><title>Unverified</title></CircleAlert></span><small>{assetSearchMetadata.name}</small><small>{shortAddress(assetSearchAddress)} · {assetSearchMetadata.decimals} decimals</small></span>
                                      {assetSearchMetadata.decimals <= MAX_CONSTITUENT_DECIMALS ? <Plus size={13} aria-hidden="true" /> : null}
                                    </button>
                                  ) : null}
                                  {normalizedAssetPickerSearch && filteredAssetPickerOptions.length === 0 && !assetSearchMetadataPending && !assetSearchMetadata ? (
                                    <div className="createAssetPickerEmpty" role="status"><strong>No configured asset found</strong><p>Add another compatible ERC-20 by contract address. Token details are read directly onchain.</p><button className="secondaryAction" type="button" onClick={() => openUnverifiedAssetModal(index, assetSearchAddress ?? "")}>{assetSearchAddress ? "Continue with this address" : "Add by contract address"}</button></div>
                                  ) : null}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </div>
                        <button className="removeCreateAsset" type="button" title={`Remove ${asset.symbol}`} aria-label={`Remove ${asset.symbol} from portfolio`} onClick={() => removeAsset(index)}><Trash2 size={14} /></button>
                      </div>
                    ))}
                  </div>
                  <button type="button" className="secondaryAction addCreateAsset" disabled={constituents.length >= 20} onClick={addAsset}><Plus size={14} />Add asset</button>
                  {constituentIssues.length ? <div className="validationSummary" role="status" aria-live="polite"><CircleAlert size={15} /><div><strong>Portfolio needs attention</strong><ul>{constituentIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div></div> : null}
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
                  <div><div className="subHeader"><span>Ordered constituents</span><small>No weights entered</small></div><div className="reviewPortfolio">{constituents.map((asset, index) => <span key={`${asset.address}-${index}`}><strong>{index + 1}</strong><small>{isAddress(asset.address) ? `${asset.symbol} · ${shortAddress(asset.address)}` : "Select an asset"}</small></span>)}</div></div>
                  <aside className="snapshotNote"><History size={17} /><div><strong>Authenticated formation snapshot required</strong><p>The authority signature binds the chain, factory, creator, ordered constituents, expected decimals, market caps, unit prices, snapshot time, expiry, calculation version, and nonce.</p></div></aside>
                  {submitted && errors.length ? <div className="formErrors" role="alert">{errors.map((error) => <span key={error}>{error}</span>)}</div> : null}
                  {structurallyValid ? <div className="validationSummary success" role="status"><CheckCircle size={15} /><div><strong>Formation input is structurally valid</strong><span>No transaction or formation snapshot has been prepared.</span></div></div> : null}
                  <p className="createBlocked">Creation remains unavailable until the redesigned contracts, authenticated snapshot service, and typed create transaction are configured.</p>
                </div>
              ) : null}

              <div className="createFormActions">
                <button className="secondaryAction" type="button" onClick={() => step === 0 ? window.location.assign(returnHref) : setStep((current) => current - 1)}><ArrowLeft size={14} />{step === 0 ? `Back to ${returnLabel}` : "Back"}</button>
                {step < steps.length - 1 ? (
                  <button className="primaryAction" type="button" disabled={!stepValid[step]} onClick={() => { setSubmitted(false); setFurthestStep((current) => Math.max(current, step + 1)); setStep((current) => current + 1); }}>Continue<ArrowRight size={14} /></button>
                ) : <button className="primaryAction" type="button" onClick={() => setSubmitted(true)}><FilePlus2 size={14} />Validate formation input</button>}
              </div>
            </div>
          </section>
        </div>
      </div>
      {unverifiedAssetIndex !== undefined ? (
        <div className="swapDialogBackdrop createAssetDialogBackdrop" onMouseDown={(event) => event.target === event.currentTarget && closeUnverifiedAssetModal()}>
          <section className="unverifiedAssetModal" role="dialog" aria-modal="true" aria-labelledby="unverified-asset-title" aria-describedby="unverified-asset-description" onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => {
            if (event.key !== "Tab") return;
            const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])"));
            const first = focusable.at(0);
            const last = focusable.at(-1);
            if (!first || !last) return;
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
          }}>
            <header className="unverifiedAssetModalHeader">
              <div><h2 id="unverified-asset-title">{manualVerifiedAsset ? "Add a verified asset" : "Add an unverified asset"}</h2><p id="unverified-asset-description">{manualVerifiedAsset ? "This contract matches a verified asset record. Its token details are still checked onchain before it is added." : "Enter an ERC-20 contract. Its token details are read directly onchain before the asset is added."}</p></div>
              <button className="unverifiedAssetModalClose" type="button" aria-label="Close unverified asset configuration" autoFocus onClick={closeUnverifiedAssetModal}><X size={16} /></button>
            </header>
            <div className="unverifiedAssetModalBody">
              <label className="unverifiedTokenAddressField"><span>Token contract</span><input className={manualAssetAddress && !isAddress(manualAssetAddress) ? "invalid" : undefined} value={manualAssetAddress} onChange={(event) => setManualAssetAddress(event.target.value.trim())} placeholder="0x ERC-20 address" autoComplete="off" /><small>The app checks the token contract and reads its name, symbol, and decimals.</small></label>
              {manualAssetMetadataPending ? <div className="unverifiedAssetLookup" role="status"><LoaderCircle className="createAssetSpinner" size={16} /><div><strong>Reading token details</strong><small>Checking the ERC-20 contract onchain…</small></div></div> : null}
              {manualAssetMetadata ? (
                <div className={`unverifiedAssetDetected ${manualAssetCompatible ? "valid" : "invalid"}`}>
                  {manualAssetCompatible ? <BadgeCheck size={18} aria-label="Valid token contract"><title>Valid token contract</title></BadgeCheck> : <CircleAlert size={18} />}
                  <div><span>{manualVerifiedAsset?.symbol ?? manualAssetMetadata.symbol}</span><strong>{manualVerifiedAsset?.name ?? manualAssetMetadata.name}</strong><small>{manualAssetAddressValue ? shortAddress(manualAssetAddressValue) : manualAssetAddress} · {manualVerifiedAsset ? "Verified" : `${manualAssetMetadata.decimals} decimals`}</small></div>
                </div>
              ) : null}
              {manualAssetMetadataReadFailed ? <span className="fieldError">No ERC-20 metadata was found at this address.</span> : null}
              {manualAssetMetadata && !manualAssetCompatible ? <span className="fieldError">Constituents support token decimals from 0 to {MAX_CONSTITUENT_DECIMALS}.</span> : null}
              {manualAssetDuplicate ? <span className="fieldError">This token contract is already in the portfolio.</span> : null}
              {!manualVerifiedAsset ? <div className="manualAssetRiskNotice" role="note"><CircleAlert size={15} /><span>Unverified assets are not blocked by the protocol. Review ownership, upgradeability, liquidity, and transfer behavior before using one.</span></div> : null}
            </div>
            <footer className="unverifiedAssetModalActions">
              <button type="button" className="secondaryAction" onClick={closeUnverifiedAssetModal}>Cancel</button>
              <button type="button" className="primaryAction" onClick={addManualAsset} disabled={!manualAssetAddressValue || manualAssetMetadataPending || !manualAssetMetadata || !manualAssetCompatible || manualAssetDuplicate}><Plus size={14} />{manualVerifiedAsset ? `Add ${manualVerifiedAsset.symbol}` : "Add asset"}</button>
            </footer>
          </section>
        </div>
      ) : null}
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
        <section className="fundsSummary" aria-label="Funds overview">
          <dl>
            <div><dt>Total AUM</dt><dd>Unavailable</dd><small>Waiting for the onchain directory</small></div>
            <div><dt>OTFs</dt><dd>0</dd><small>Deployed funds indexed</small></div>
          </dl>
          <div className="appPageActions"><Link className="secondaryAction" href="/verified"><ShieldCheck size={14} />Verified</Link><Link className="primaryAction" href="/create?from=funds">Create an OTF<ArrowUpRight size={14} /></Link></div>
        </section>
        {!testnet ? (
          <section className="sectionCard depositsEmpty"><span><Network size={22} /></span><h2>Robinhood Mainnet is not supported yet</h2><p>Canonical USDG is configured, but no OTF deployments or typed execution service are available on Robinhood Mainnet. Enable Testnet in Settings to use the current protocol deployment.</p></section>
        ) : (
          <>
            <div className="validationSummary directoryDataNotice" role="status"><History size={15} /><div><strong>Onchain directory data</strong><span>The redesigned deployment is not configured. No preview funds or aggregate values are substituted.</span></div></div>
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
        <AppPageHeader title="My wallet" description="Your OTF share positions and network balance." icon={<Wallet size={18} />} actions={<><WalletConnectionAction /><Link className="secondaryAction" href="/funds"><LayoutGrid size={14} />Explore OTFs</Link></>} />
        {!testnet ? <section className="sectionCard depositsEmpty"><span><Network size={22} /></span><h2>Robinhood Mainnet is not supported yet</h2><p>Switch to Robinhood Testnet in Settings to view deployed OTF positions.</p></section> : address ? (
          <>
            <div className="depositMetrics walletMetrics">
              <div className="metricCard walletAddressMetric"><div className="metricLabel"><span>Wallet address</span><div className="walletAddressActions">{addressCopied ? <span className="walletAddressCopyFeedback" role="status" aria-live="polite">Copied</span> : null}<button className="iconOnly compact" type="button" title={addressCopied ? "Wallet address copied" : "Copy wallet address"} onClick={copyWalletAddress} aria-label={addressCopied ? "Wallet address copied" : "Copy wallet address"}>{addressCopied ? <Check size={13} /> : <Copy size={13} />}</button><a className="iconOnly compact" href={`${robinhoodChainTestnet.blockExplorers.default.url}/address/${address}`} target="_blank" rel="noreferrer" title="Open wallet in block explorer" aria-label="Open wallet in block explorer in a new tab"><ExternalLink size={13} /></a></div></div><div className="walletAddressValue"><strong title={address}>{shortAddress(address)}</strong></div></div>
              <MetricCard label="OTF Positions" value="0" />
              <MetricCard label="USDG Balance" value={usdgBalanceLoading ? "Loading" : usdgBalance ? `${Number(usdgBalance.formatted).toLocaleString(undefined, { maximumFractionDigits: 4 })} USDG` : "0 USDG"} action={<a className="metricCardFaucetAction" href="https://faucet.paxos.com/" target="_blank" rel="noreferrer" title="Open USDG faucet" aria-label="Open USDG faucet in a new tab"><Droplets className="metricCardFaucetIcon" size={14} aria-hidden="true" /><span>Faucet</span><ExternalLink className="metricCardFaucetExternalIcon" size={10} aria-hidden="true" /></a>} />
              <MetricCard label="ETH Balance" value={nativeBalanceLoading ? "Loading" : nativeBalance ? `${Number(nativeBalance.formatted).toLocaleString(undefined, { maximumFractionDigits: 4 })} ${nativeBalance.symbol}` : "Unavailable"} action={<a className="metricCardFaucetAction" href="https://faucet.testnet.chain.robinhood.com/" target="_blank" rel="noreferrer" title="Open Robinhood testnet ETH faucet" aria-label="Open Robinhood testnet ETH faucet in a new tab"><Droplets className="metricCardFaucetIcon" size={14} aria-hidden="true" /><span>Faucet</span><ExternalLink className="metricCardFaucetExternalIcon" size={10} aria-hidden="true" /></a>} />
            </div>
            <section className="sectionCard depositPositions"><div className="managedVaultsHeading"><div><span className="appPageIcon"><CircleDollarSign size={16} /></span><div><h2>OTF positions</h2><p>Shares held by the connected wallet.</p></div></div><span className="stateBadge muted">0 positions</span></div><div className="inlineEmptyState walletPositionEmpty"><CircleDollarSign size={18} /><div><strong>No OTF positions found</strong><span>Your OTF shares will appear here after a purchase or deposit.</span></div></div></section>
            <section className="sectionCard managedVaultsPanel"><div className="managedVaultsHeading"><div><span className="appPageIcon"><UserCog size={16} /></span><div><h2>OTFs you manage</h2><p>Manager controls and protocol operations for OTFs currently managed by this wallet.</p></div></div><div className="managedVaultsHeaderActions"><Link className="secondaryAction" href="/create?from=wallet">Create OTF</Link></div></div><div className="inlineEmptyState"><UserCog size={18} /><div><strong>No managed OTFs found</strong><span>OTFs will appear here whenever this wallet is their current manager.</span></div></div></section>
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
  if (initialView === "landing") return <SplashPage />;

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
