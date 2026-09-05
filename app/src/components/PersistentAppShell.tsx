"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { OtfTokenIcon } from "@onchaintradedfunds/brand";
import { Check, LoaderCircle, Monitor, Settings, Sun, Wallet, Zap } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useChainId, useSwitchChain } from "wagmi";
import { Providers } from "@/app/providers";
import { robinhoodChain, robinhoodChainTestnet } from "@/lib/chains";
import { navigationItemForPath } from "@/lib/operate-navigation";

type AppearancePreference = "default" | "light" | "dark";
type ResolvedAppearance = Exclude<AppearancePreference, "default">;

const OPERATE_FLOW_LINES = Array.from({ length: 12 }, (_, index) => {
  const startY = 38 + index * 78;
  const pinchY = 440 + (index - 5.5) * 8;
  const endY = 76 + ((index * 137) % 760);
  return {
    d: `M -120 ${startY} C 260 ${startY - 54} 540 ${pinchY - 126} 850 ${pinchY} C 1080 ${pinchY + 92} 1260 ${endY - 48} 1560 ${endY}`,
    opacity: 0.32 + (index % 4) * 0.1,
  };
});

function OperateAmbientField() {
  return (
    <div className="operateAmbientField" aria-hidden="true">
      <svg viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" focusable="false">
        <defs>
          <linearGradient id="operate-ambient-flow" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.06" />
            <stop offset="0.38" stopColor="currentColor" stopOpacity="0.72" />
            <stop offset="0.62" stopColor="currentColor" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0.04" />
          </linearGradient>
        </defs>
        <g className="operateAmbientCurrent" stroke="url(#operate-ambient-flow)" strokeWidth="0.9" vectorEffect="non-scaling-stroke">
          {OPERATE_FLOW_LINES.map((line) => <path key={line.d} d={line.d} opacity={line.opacity} pathLength="1" />)}
        </g>
        <g className="operateAmbientOrbits" stroke="currentColor" strokeWidth="0.75" vectorEffect="non-scaling-stroke">
          <ellipse cx="850" cy="440" rx="164" ry="54" transform="rotate(-20 850 440)" />
          <ellipse cx="850" cy="440" rx="224" ry="78" transform="rotate(-14 850 440)" />
          <ellipse cx="850" cy="440" rx="292" ry="108" transform="rotate(-8 850 440)" />
        </g>
      </svg>
    </div>
  );
}

function HeaderWalletControl({ active }: { active: boolean }) {
  return (
    <ConnectButton.Custom>
      {({ account, mounted, authenticationStatus, openConnectModal }) => {
        const ready = mounted && authenticationStatus !== "loading";
        const connected = ready && account && (!authenticationStatus || authenticationStatus === "authenticated");
        if (!ready) return <button className="headerWalletButton isLoading" type="button" aria-label="Wallet connection pending" disabled><LoaderCircle className="createAssetSpinner" size={14} /><span>Connect wallet</span></button>;
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

function OperateNav({ theme, onThemeChange }: {
  theme: AppearancePreference;
  onThemeChange: (theme: AppearancePreference) => void;
}) {
  const pathname = usePathname();
  const current = navigationItemForPath(pathname);
  const [networkOpen, setNetworkOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const chainId = useChainId();
  const testnetMode = chainId === robinhoodChainTestnet.id;
  const { switchChain, isPending: networkSwitchPending } = useSwitchChain();
  const networkRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);

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

  return (
    <header className="topNav">
      <div className="topNavInner">
        <Link className="logoGroup" href="/" aria-label="Onchain Traded Funds">
          <OtfTokenIcon className="headerBrandMark" size={30} />
          <span className="brandText"><strong>Onchain Traded Funds</strong></span>
        </Link>
        <nav className="navTabs" aria-label="Primary navigation">
          <Link className={current === "swap" ? "active" : ""} href="/">Swap</Link>
          <Link className={current === "funds" ? "active" : ""} href="/funds">Funds</Link>
          <Link className={current === "token" ? "active" : ""} href="/token">$OTF</Link>
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
                    <span className="settingsOptionText"><strong>Mode</strong><small>Follow your browser or choose a mode.</small></span>
                  </div>
                  <div className="settingsThemeChoices" role="radiogroup" aria-label="Application appearance">
                    {(["default", "light", "dark"] as const).map((value) => (
                      <button className={`settingsThemeChoice ${theme === value ? "selected" : ""}`} key={value} type="button" role="radio" aria-checked={theme === value} onClick={() => onThemeChange(value)}>
                        {value === "default" ? <Monitor className="settingsSystemIcon" size={13} /> : <span className={`settingsThemeSwatch appearance-${value}`} aria-hidden="true" />}
                        <span>{value === "default" ? "Browser" : value[0].toUpperCase() + value.slice(1)}</span>
                        {theme === value ? <Check size={12} /> : null}
                      </button>
                    ))}
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

export function PersistentAppShell({ children, showOnRoot }: { children: ReactNode; showOnRoot: boolean }) {
  const pathname = usePathname();
  const showHeader = pathname !== "/" || showOnRoot;
  const [theme, setTheme] = useState<AppearancePreference>("default");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedAppearance>("dark");

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("otf-theme");
    setTheme(savedTheme === "light" || savedTheme === "dark" ? savedTheme : "default");
  }, []);

  useEffect(() => {
    const browserPreference = window.matchMedia("(prefers-color-scheme: light)");
    const applyTheme = () => {
      const nextTheme: ResolvedAppearance = theme === "default"
        ? browserPreference.matches ? "light" : "dark"
        : theme;
      setResolvedTheme(nextTheme);
      document.documentElement.dataset.theme = nextTheme;
    };
    applyTheme();
    if (theme !== "default") return;
    browserPreference.addEventListener("change", applyTheme);
    return () => browserPreference.removeEventListener("change", applyTheme);
  }, [theme]);

  function changeTheme(nextTheme: AppearancePreference) {
    setTheme(nextTheme);
    window.localStorage.setItem("otf-theme", nextTheme);
  }

  return (
    <Providers appearance={resolvedTheme}>
      <div className={showHeader ? "operateShell" : undefined}>
        {showHeader ? <OperateAmbientField /> : null}
        {showHeader ? <OperateNav theme={theme} onThemeChange={changeTheme} /> : null}
        {children}
      </div>
    </Providers>
  );
}
