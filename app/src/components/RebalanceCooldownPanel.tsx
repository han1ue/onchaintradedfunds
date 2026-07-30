"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { managedOtfVaultAbi } from "@onchaintradedfunds/generated";
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowRightLeft,
  BadgeCent,
  BookOpen,
  ChartPie,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Coins,
  Copy,
  Droplets,
  ExternalLink,
  FilePlus2,
  HeartPulse,
  Info,
  ListChecks,
  LayoutGrid,
  Loader2,
  LockKeyhole,
  KeyRound,
  Landmark,
  Moon,
  Network,
  Plus,
  Percent,
  ReceiptText,
  RefreshCw,
  Scale,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  Trash2,
  TrendingUp,
  UserCog,
  Wallet,
  XCircle,
  Zap,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { formatUnits, isAddress } from "viem";
import { useAccount, useReadContracts } from "wagmi";
import {
  formatCooldown,
  formatRelativeAvailability,
  formatTimestamp,
  progressThroughCooldown,
} from "@/lib/time";
import { LandingPage } from "./LandingPage";

type ContractValue =
  | string
  | number
  | bigint
  | boolean
  | readonly string[]
  | readonly number[]
  | readonly bigint[]
  | undefined;

type ReadResult = readonly { result?: ContractValue }[];
type TxState = "idle" | "simulating" | "ready" | "pending" | "submitted" | "confirmed" | "reverted";
type AppView = "landing" | "detail" | "vaults" | "create" | "manage" | "deposits";

type Allocation = {
  symbol: string;
  name: string;
  address: string;
  targetWeightBps: number;
  actualWeightBps: number;
  balance: string;
  price: string;
  oracleAge: string;
  freshnessTone: "fresh" | "warning";
  tone: string;
};

type TargetAsset = {
  ticker: string;
  address: string;
  targetWeight: number;
};

type VaultView = {
  name: string;
  symbol: string;
  address?: `0x${string}`;
  manager?: string;
  feeRecipient?: string;
  creatorFeeBps: number;
  protocolFeeShareBps: number;
  totalSupply: string;
  currentThesis: string;
  cooldownSeconds: number;
  lastPortfolioChange?: number;
  nextPortfolioChange?: number;
  canRebalance: boolean;
  cooldownProgress: number;
  allocations: Allocation[];
  maxTurnoverBps: number;
  maxNavLossBps: number;
  maxWeightDeviationBps: number;
  maxSingleAssetWeightBps: number;
  minNonZeroAssetWeightBps: number;
  maxOracleStaleness: number;
  maxAssetCount: number;
  connectedIsManager: boolean;
  enabled: boolean;
  isLoading: boolean;
};

const navTabs = ["Vaults", "Create"];

const demoAllocations: Allocation[] = [
  {
    symbol: "mNVDA",
    name: "Mock NVDA",
    address: "0x2e4c81ab04a82f5dd3e0ca7f1234567890a6612f",
    targetWeightBps: 4_000,
    actualWeightBps: 4_120,
    balance: "14,208.4471",
    price: "$118.42",
    oracleAge: "38s ago",
    freshnessTone: "fresh",
    tone: "teal",
  },
  {
    symbol: "mMSFT",
    name: "Mock MSFT",
    address: "0x5f91bce20e82e85199b792a5595728117f8871ab",
    targetWeightBps: 3_500,
    actualWeightBps: 3_410,
    balance: "3,401.2210",
    price: "$421.07",
    oracleAge: "1m 12s ago",
    freshnessTone: "fresh",
    tone: "blue",
  },
  {
    symbol: "mGOOGL",
    name: "Mock GOOGL",
    address: "0xc70a3d6b0011391c3df907c5d2dc180481a4d813",
    targetWeightBps: 2_500,
    actualWeightBps: 2_470,
    balance: "5,912.8830",
    price: "$176.55",
    oracleAge: "9m 04s ago",
    freshnessTone: "warning",
    tone: "gold",
  },
];

const suggestedVaultAddress = "0x4f9c2a71c8d3e6b5a09f1274ce83d6412a5c1ae3";
const suggestedManagerAddress = "0x8b1a47e2c0d4a718b8a942c1557f99259fa14d11";

const knownCreateAssets = [
  ...demoAllocations.map(({ symbol, name, address }) => ({ symbol, name, address })),
  {
    symbol: "mAAPL",
    name: "Mock Apple",
    address: "0xa11a00000000000000000000000000000000a11a",
  },
  {
    symbol: "mAMZN",
    name: "Mock Amazon",
    address: "0xa6a200000000000000000000000000000000a6a2",
  },
  {
    symbol: "mMETA",
    name: "Mock Meta",
    address: "0x6e7a000000000000000000000000000000006e7a",
  },
] as const;

const allocationTones = ["teal", "green", "gold", "blue", "rose", "violet"];

function configuredVaultAddress(): `0x${string}` | undefined {
  const value = process.env.NEXT_PUBLIC_EXAMPLE_VAULT_ADDRESS;
  return value && isAddress(value) ? value : undefined;
}

function shortAddress(address?: string): string {
  if (!address) return "Not configured";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function shortAssetAddress(address: string): string {
  return `${address.slice(0, 10)}...${address.slice(-6)}`;
}

function bpsToPercent(value?: number): string {
  if (value === undefined) return "Not available";
  return `${(value / 100).toFixed(value % 100 === 0 ? 0 : 2)}%`;
}

function bpsToAllocationPercent(value: number): string {
  return `${(value / 100).toFixed(1)}%`;
}

function signedBpsToAllocationPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${bpsToAllocationPercent(value)}`;
}

function resultAt<T extends ContractValue>(results: ReadResult | undefined, index: number): T | undefined {
  return results?.[index]?.result as T | undefined;
}

function normalizeAllocations(
  assets?: readonly string[],
  weights?: readonly number[] | readonly bigint[],
): Allocation[] {
  if (!assets?.length || !weights?.length) return demoAllocations;

  return assets.map((address, index) => {
    const weight = Number(weights[index] ?? 0);
    return {
      symbol: `Asset ${index + 1}`,
      name: "Approved token",
      address,
      targetWeightBps: weight,
      actualWeightBps: weight,
      balance: "Read contract",
      price: "Oracle",
      oracleAge: "Freshness check",
      freshnessTone: "fresh",
      tone: allocationTones[index % allocationTones.length],
    };
  });
}

function txStateLabel(state: TxState): { label: string; tone: "muted" | "info" | "success" | "warning" | "danger" } {
  if (state === "simulating") return { label: "Simulating transaction", tone: "info" };
  if (state === "ready") return { label: "Simulation passed", tone: "success" };
  if (state === "pending") return { label: "Awaiting wallet signature", tone: "warning" };
  if (state === "submitted") return { label: "Submitted, awaiting confirmation", tone: "info" };
  if (state === "confirmed") return { label: "Confirmed", tone: "success" };
  if (state === "reverted") return { label: "Transaction reverted", tone: "danger" };
  return { label: "Idle", tone: "muted" };
}

function runMockTx(setState: (state: TxState) => void) {
  setState("pending");
  window.setTimeout(() => setState("submitted"), 900);
  window.setTimeout(() => setState("confirmed"), 2_600);
}

export function RebalanceCooldownPanel() {
  const vaultAddress = configuredVaultAddress();
  const enabled = Boolean(vaultAddress);
  const { address: connectedAddress } = useAccount();
  const [view, setView] = useState<AppView>("landing");

  const readContracts = vaultAddress
    ? ([
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "name" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "symbol" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "manager" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "feeRecipient" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "creatorFeeBpsPerYear" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "protocolFeeShareBps" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "totalSupply" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "assets" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "targetWeightsBps" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "maxTurnoverBps" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "maxNavLossBps" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "maxWeightDeviationBps" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "maxAssetCount" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "currentThesis" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "rebalanceCooldown" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "lastRebalanceTimestamp" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "nextRebalanceTime" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "canRebalance" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "maxSingleAssetWeightBps" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "minNonZeroAssetWeightBps" },
        { address: vaultAddress, abi: managedOtfVaultAbi, functionName: "maxOracleStaleness" },
      ] as const)
    : undefined;

  const { data, error, isLoading } = useReadContracts({
    contracts: readContracts,
    query: { enabled: Boolean(readContracts) },
  });

  const results = data as ReadResult | undefined;
  const vaultName = resultAt<string>(results, 0) ?? "Onchain Technology Leaders";
  const vaultSymbol = resultAt<string>(results, 1) ?? "OTF-TECH";
  const manager = resultAt<string>(results, 2) ?? suggestedManagerAddress;
  const feeRecipient = resultAt<string>(results, 3) ?? suggestedManagerAddress;
  const creatorFeeBps = resultAt<number>(results, 4) ?? 50;
  const protocolFeeShareBps = resultAt<number>(results, 5) ?? 1_500;
  const totalSupply = resultAt<bigint>(results, 6);
  const assets = resultAt<readonly string[]>(results, 7);
  const targetWeights = resultAt<readonly number[] | readonly bigint[]>(results, 8);
  const maxTurnoverBps = resultAt<number>(results, 9) ?? 3_000;
  const maxNavLossBps = resultAt<number>(results, 10) ?? 200;
  const maxWeightDeviationBps = resultAt<number>(results, 11) ?? 500;
  const maxAssetCount = resultAt<number>(results, 12) ?? 10;
  const currentThesis =
    resultAt<string>(results, 13) ??
    "Technology leaders basket weighted toward AI semiconductor and cloud infrastructure exposure. The manager may adjust approved constituents and weights while remaining inside immutable turnover, NAV loss, oracle health, and cooldown limits.";
  const cooldownSeconds = Number(resultAt<number>(results, 14) ?? 7 * 86_400);
  const lastPortfolioChange = resultAt<bigint>(results, 15)
    ? Number(resultAt<bigint>(results, 15))
    : undefined;
  const nextPortfolioChange = resultAt<bigint>(results, 16)
    ? Number(resultAt<bigint>(results, 16))
    : undefined;
  const canRebalance = Boolean(resultAt<boolean>(results, 17));
  const maxSingleAssetWeightBps = resultAt<number>(results, 18) ?? 5_000;
  const minNonZeroAssetWeightBps = resultAt<number>(results, 19) ?? 100;
  const maxOracleStaleness = resultAt<number>(results, 20) ?? 600;
  const allocations = normalizeAllocations(assets, targetWeights);
  const cooldownProgress = progressThroughCooldown(lastPortfolioChange, nextPortfolioChange);
  const connectedIsManager =
    connectedAddress && manager && connectedAddress.toLowerCase() === manager.toLowerCase();
  const supplyDisplay = totalSupply ? `${Number(formatUnits(totalSupply, 18)).toLocaleString()} ${vaultSymbol}` : "100,012 OTF-TECH";

  const vault = {
    name: vaultName,
    symbol: vaultSymbol,
    address: vaultAddress ?? suggestedVaultAddress,
    manager,
    feeRecipient,
    creatorFeeBps,
    protocolFeeShareBps,
    totalSupply: supplyDisplay,
    currentThesis,
    cooldownSeconds,
    lastPortfolioChange,
    nextPortfolioChange,
    canRebalance,
    cooldownProgress,
    allocations,
    maxTurnoverBps,
    maxNavLossBps,
    maxWeightDeviationBps,
    maxSingleAssetWeightBps,
    minNonZeroAssetWeightBps,
    maxOracleStaleness,
    maxAssetCount,
    connectedIsManager: Boolean(connectedIsManager),
    enabled,
    isLoading,
  };
  const activeTab = view === "create" ? "Create" : "Vaults";

  function openView(nextView: AppView) {
    window.scrollTo({ top: 0, behavior: "auto" });
    setView(nextView);
  }

  function changeView(tab: string) {
    if (tab === "Create") openView("create");
    else openView("vaults");
  }

  if (view === "landing") {
    return (
      <LandingPage
        onCreate={() => openView("create")}
        onEnter={() => openView("vaults")}
      />
    );
  }

  return (
    <div className="otfAppShell">
      <TopNav
        activeTab={activeTab}
        depositsActive={view === "deposits"}
        onHome={() => openView("landing")}
        onTabChange={changeView}
        onOpenDeposits={() => openView("deposits")}
      />

      <main className="dashboardMain">
        {view === "detail" ? (
          <>
            <VaultHeader vault={vault} onBack={() => openView("vaults")} />
            <VaultMetrics vault={vault} />

            {error ? (
              <div className="warningBanner danger">
                <XCircle size={16} />
                <span>Unable to read live vault data. The dashboard is showing demo fallback values.</span>
              </div>
            ) : null}

            <div className="dashboardGrid">
              <div className="primaryColumn">
                <RebalanceCooldown vault={vault} />
                <PortfolioAllocation allocations={allocations} />
                <ManagerRebalanceBuilder vault={vault} />
              </div>

              <aside className="sideColumn">
                <SafetyLimits vault={vault} />
                <ThesisModule currentThesis={currentThesis} />
                <UserActions vaultSymbol={vaultSymbol} />
              </aside>
            </div>
          </>
        ) : null}

        {view === "vaults" ? (
          <VaultsDirectory
            currentVault={vault}
            onManageVault={() => openView("manage")}
            onOpenVault={() => openView("detail")}
            onCreateVault={() => openView("create")}
          />
        ) : null}

        {view === "create" ? (
          <CreateVaultView connectedAddress={connectedAddress} onBack={() => openView("vaults")} />
        ) : null}

        {view === "manage" ? (
          <ManageVaultsView
            vault={vault}
            onBack={() => openView("vaults")}
            onOpenVault={() => openView("detail")}
          />
        ) : null}

        {view === "deposits" ? (
          <DepositsView
            connectedAddress={connectedAddress}
            currentVault={vault}
            onBrowseVaults={() => openView("vaults")}
            onOpenVault={() => openView("detail")}
          />
        ) : null}

        <footer className="dashboardFooter">
          <span>Onchain Traded Funds · experimental, unaudited software</span>
          <div className="footerLinks">
            <span>ERC-4626 vaults · Robinhood Testnet</span>
            <a href="/docs">Docs</a>
          </div>
        </footer>
      </main>
    </div>
  );
}

function TopNav({
  activeTab,
  depositsActive,
  onHome,
  onTabChange,
  onOpenDeposits,
}: {
  activeTab: string;
  depositsActive: boolean;
  onHome: () => void;
  onTabChange: (tab: string) => void;
  onOpenDeposits: () => void;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const settingsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("otf-theme");
    const initialTheme = savedTheme === "light" ? "light" : "dark";
    setTheme(initialTheme);
    document.documentElement.dataset.theme = initialTheme;
  }, []);

  useEffect(() => {
    if (!settingsOpen) return;

    function closeOnOutsidePress(event: PointerEvent) {
      if (!settingsRef.current?.contains(event.target as Node)) {
        setSettingsOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setSettingsOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [settingsOpen]);

  function changeTheme(nextTheme: "dark" | "light") {
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem("otf-theme", nextTheme);
  }

  return (
    <header className="topNav">
      <div className="topNavInner">
        <button className="logoGroup brandHomeButton" type="button" onClick={onHome} title="Back to homepage">
          <div className="otfLogo">OTF</div>
          <div className="brandText">
            <strong>Onchain Traded Funds</strong>
          </div>
        </button>

        <nav className="navTabs" aria-label="Primary navigation">
          {navTabs.map((tab) => (
            <button
              className={!depositsActive && tab === activeTab ? "active" : ""}
              key={tab}
              type="button"
              onClick={() => onTabChange(tab)}
            >
              {tab}
            </button>
          ))}
          <a href="/docs">Docs</a>
        </nav>

        <div className="navActions">
          <button
            className={`depositsButton ${depositsActive ? "active" : ""}`}
            type="button"
            onClick={onOpenDeposits}
            title="My deposits"
          >
            <Wallet size={14} />
            <span>My deposits</span>
          </button>
          <div className="settingsControl" ref={settingsRef}>
            <button
              className={`iconOnly ${settingsOpen ? "active" : ""}`}
              type="button"
              title="Settings"
              aria-label="Open settings"
              aria-expanded={settingsOpen}
              aria-haspopup="dialog"
              onClick={() => setSettingsOpen((open) => !open)}
            >
              <Settings size={16} />
            </button>
            {settingsOpen ? (
              <div className="settingsMenu" role="dialog" aria-label="Application settings">
                <div className="settingsMenuHeader">
                  <strong>Settings</strong>
                  <span>Network and appearance</span>
                </div>
                <div className="settingsGroup">
                  <span className="settingsLabel">Network</span>
                  <div className="settingsOption selected">
                    <span className="settingsOptionIcon"><Network size={15} /></span>
                    <span className="settingsOptionText">
                      <strong>Robinhood Testnet</strong>
                      <small>Configured network</small>
                    </span>
                    <Check className="settingsCheck" size={15} />
                  </div>
                </div>
                <div className="settingsGroup">
                  <span className="settingsLabel">Appearance</span>
                  <button
                    className="settingsOption"
                    type="button"
                    aria-pressed={theme === "light"}
                    onClick={() => changeTheme(theme === "light" ? "dark" : "light")}
                  >
                    <span className="settingsOptionIcon">
                      {theme === "light" ? <Sun size={15} /> : <Moon size={15} />}
                    </span>
                    <span className="settingsOptionText">
                      <strong>Light mode</strong>
                      <small>{theme === "light" ? "On" : "Off"}</small>
                    </span>
                    <span className={`themeSwitch ${theme === "light" ? "active" : ""}`} aria-hidden="true">
                      <span />
                    </span>
                  </button>
                </div>
              </div>
            ) : null}
          </div>
          <OTFWalletButton />
        </div>
      </div>
    </header>
  );
}

function OTFWalletButton() {
  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        mounted,
        authenticationStatus,
        openAccountModal,
        openChainModal,
        openConnectModal,
      }) => {
        const ready = mounted && authenticationStatus !== "loading";
        const connected =
          ready &&
          account &&
          chain &&
          (!authenticationStatus || authenticationStatus === "authenticated");

        return (
          <div className="walletControl" data-ready={ready}>
            {!connected ? (
              <button className="walletButton connect" type="button" onClick={openConnectModal}>
                <Wallet size={14} />
                <span>Connect wallet</span>
              </button>
            ) : chain.unsupported ? (
              <button className="walletButton unsupported" type="button" onClick={openChainModal}>
                <AlertTriangle size={14} />
                <span>Switch network</span>
              </button>
            ) : (
              <button className="walletButton account" type="button" onClick={openAccountModal}>
                <span className="walletStatusDot" />
                <span>{account.displayName}</span>
                <ChevronDown size={13} />
              </button>
            )}
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}

function VaultHeader({ vault, onBack }: { vault: VaultView; onBack: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(value: string | undefined, key: string) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1_500);
    } catch {
      setCopied(null);
    }
  }

  return (
    <section className="vaultHeader">
      <div className="vaultBreadcrumb">
        <button type="button" onClick={onBack}>
          <ArrowLeft size={12} />
          Vaults
        </button>
        <span>/</span>
        <strong>{vault.name}</strong>
      </div>

      <div className="vaultTitleRow">
        <div className="vaultIdentity">
          <div className="vaultMonogram">TECH</div>
          <div>
            <div className="titleLine">
              <h1>{vault.name}</h1>
              <span className="symbolBadge">{vault.symbol}</span>
            </div>
            <div className="addressLine">
              <AddressPill label="Vault" address={vault.address} copied={copied === "vault"} onCopy={() => copy(vault.address, "vault")} />
              <AddressPill label="Manager" address={vault.manager} copied={copied === "manager"} onCopy={() => copy(vault.manager, "manager")} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function VaultMetrics({ vault }: { vault: VaultView }) {
  const freshOracleCount = vault.allocations.filter(
    ({ freshnessTone }) => freshnessTone === "fresh" || freshnessTone === "warning",
  ).length;
  const oracleCount = vault.allocations.length;
  const allOraclesFresh = oracleCount > 0 && freshOracleCount === oracleCount;

  return (
    <div className="metricGrid">
      <MetricCard label="NAV" value="$4,821,302.44" icon={<TrendingUp size={14} />} tone="success" sub="+1.42% / 24h" />
      <MetricCard label="NAV / Share" value="$48.21" icon={<Activity size={14} />} sub="USDC terms" />
      <MetricCard label="Total Supply" value={vault.totalSupply} icon={<Droplets size={14} />} sub={vault.symbol} />
      <MetricCard label="Creator Fee" value={bpsToPercent(vault.creatorFeeBps)} icon={<BadgeCent size={14} />} sub="Annualized" />
      <MetricCard
        label="Secondary Liquidity"
        value="$1.26M"
        icon={<ArrowRightLeft size={14} />}
        sub={`${vault.symbol} / USDC pool`}
      />
      <MetricCard
        label="Oracle Health"
        value={allOraclesFresh ? "Healthy" : "Needs attention"}
        icon={<HeartPulse size={14} />}
        tone={allOraclesFresh ? "success" : "warning"}
        sub={`${freshOracleCount}/${oracleCount} fresh`}
      />
    </div>
  );
}

function AddressPill({
  label,
  address,
  copied,
  onCopy,
}: {
  label: string;
  address?: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <span className={`addressPill ${copied ? "copied" : ""}`}>
      <span>{label}</span>
      <strong>{shortAddress(address)}</strong>
      <button type="button" onClick={onCopy} title={copied ? "Copied" : `Copy ${label.toLowerCase()} address`}>
        {copied ? <CheckCircle size={13} /> : <Copy size={13} />}
      </button>
      {copied ? <span className="copyFeedback" role="status" aria-live="polite">Copied</span> : null}
      <button type="button" title="Open explorer">
        <ExternalLink size={13} />
      </button>
    </span>
  );
}

function MetricCard({
  label,
  value,
  icon,
  tone = "neutral",
  sub,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
  sub?: string;
}) {
  return (
    <div className={`metricCard ${tone}`}>
      <div className="metricLabel">
        {icon}
        {label}
      </div>
      <strong>{value}</strong>
      {sub ? <span>{sub}</span> : null}
    </div>
  );
}

function SectionCard({
  title,
  subtitle,
  icon,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="sectionCard">
      <div className="sectionTitle">
        <div className="sectionHeading">
          <div className="sectionTitleLine">
            {icon}
            <h2>{title}</h2>
          </div>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {action}
      </div>
      <div className="sectionBody">{children}</div>
    </section>
  );
}

function RebalanceCooldown({ vault }: { vault: VaultView }) {
  return (
    <SectionCard
      title="Rebalance cooldown"
      subtitle={`${formatCooldown(vault.cooldownSeconds)} enforced interval between portfolio changes`}
      icon={<Clock3 size={15} />}
      action={<span className={`stateBadge ${vault.canRebalance ? "success" : "warning"}`}>{vault.canRebalance ? "Available now" : "Cooling down"}</span>}
    >
      <div className="cooldownStats">
        <TimelineItem label="Cooldown" value={vault.isLoading ? "Loading" : formatCooldown(vault.cooldownSeconds)} icon={<LockKeyhole size={13} />} />
        <TimelineItem label="Last change" value={formatTimestamp(vault.lastPortfolioChange)} icon={<Clock3 size={13} />} />
        <TimelineItem label="Next available" value={vault.canRebalance ? "Now" : formatTimestamp(vault.nextPortfolioChange)} icon={<Activity size={13} />} />
        <TimelineItem label="State" value={vault.canRebalance ? "Unlocked" : "Locked"} icon={<Activity size={13} />} />
      </div>

      <div className="progressBlock">
        <div className="progressMeta">
          <span>Cooldown progress</span>
          <strong>{formatRelativeAvailability(vault.nextPortfolioChange)}</strong>
        </div>
        <div className="progressTrack">
          <span style={{ width: `${vault.cooldownProgress}%` }} />
          <i style={{ left: `calc(${vault.cooldownProgress}% - 5px)` }} />
        </div>
        <div className="progressDates">
          <span>{formatTimestamp(vault.lastPortfolioChange)}</span>
          <span>{formatTimestamp(vault.nextPortfolioChange)}</span>
        </div>
      </div>

      <div className="cardFooterAction">
        <span className="mutedInline">
          <Info size={14} />
          {vault.canRebalance ? "Cooldown elapsed. A rebalance may be submitted." : "Thesis amendments and fee accrual do not reset this timer."}
        </span>
        <button className="primaryAction" type="button" disabled={!vault.enabled || !vault.canRebalance || !vault.connectedIsManager}>
          <RefreshCw size={14} />
          {vault.canRebalance ? "Rebalance portfolio" : "Rebalance locked"}
        </button>
      </div>
    </SectionCard>
  );
}

function TimelineItem({
  label,
  value,
  icon,
  highlight,
  status,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  highlight?: boolean;
  status?: "locked" | "open";
}) {
  return (
    <div className={`timelineItem ${highlight ? "highlight" : ""} ${status ?? ""}`}>
      <span>
        {icon}
        {label}
      </span>
      <strong>{value}</strong>
    </div>
  );
}

function PortfolioAllocation({ allocations }: { allocations: Allocation[] }) {
  const staleAssets = allocations.filter((asset) => asset.freshnessTone === "warning");
  const staleAsset = staleAssets[0];

  return (
    <SectionCard
      title="Portfolio allocation"
      subtitle="Target vs actual weights · live oracle pricing"
      icon={<ChartPie size={15} />}
      action={
        <div className="headerActions">
          <span className="stateBadge muted">{allocations.length} assets</span>
          <button className="iconOnly compact" type="button" title="Refresh oracle data">
            <RefreshCw size={13} />
          </button>
        </div>
      }
    >
      <div className="allocationBar">
        {allocations.map((asset) => (
          <span
            className={`allocationSegment ${asset.tone}`}
            key={asset.address}
            style={{ width: `${Math.max(asset.actualWeightBps / 100, 1)}%` }}
            title={`${asset.name}: ${bpsToAllocationPercent(asset.actualWeightBps)}`}
          />
        ))}
      </div>

      <div className="allocationLegend">
        {allocations.map((asset) => (
          <span className="legendItem" key={asset.address}>
            <span className={`legendSwatch ${asset.tone}`} />
            <span>{asset.symbol}</span>
            <strong>{bpsToAllocationPercent(asset.actualWeightBps)}</strong>
          </span>
        ))}
      </div>

      <div className="assetTableWrap">
        <table className="assetTable">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Target</th>
              <th>Actual</th>
              <th>Drift</th>
              <th>Balance</th>
              <th>Oracle Price</th>
              <th>Freshness</th>
            </tr>
          </thead>
          <tbody>
            {allocations.map((asset) => {
              const diff = asset.actualWeightBps - asset.targetWeightBps;
              const driftTone = diff > 0 ? "warning" : diff < 0 ? "success" : "neutral";
              return (
                <tr key={asset.address}>
                  <td>
                    <div className="assetIdentity">
                      <span className="assetToken">{asset.symbol.replace(/^m/, "").slice(0, 2)}</span>
                      <div>
                        <strong>{asset.symbol}</strong>
                        <span>{shortAssetAddress(asset.address)}</span>
                      </div>
                    </div>
                  </td>
                  <td>{bpsToAllocationPercent(asset.targetWeightBps)}</td>
                  <td className="actualWeight">{bpsToAllocationPercent(asset.actualWeightBps)}</td>
                  <td>
                    <span className={`driftValue ${driftTone}`}>{signedBpsToAllocationPercent(diff)}</span>
                  </td>
                  <td className="monoCell">{asset.balance}</td>
                  <td className="priceCell">{asset.price}</td>
                  <td>
                    <span
                      className={`freshnessBadge ${asset.freshnessTone}`}
                      title={`Last updated ${asset.oracleAge}`}
                      aria-label={`Fresh. Last updated ${asset.oracleAge}.`}
                    >
                      Fresh
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {staleAsset ? (
        <div className="oracleWarning">
          <AlertTriangle size={17} />
          <div>
            <strong>
              {staleAssets.length} oracle feed{staleAssets.length === 1 ? "" : "s"} approaching staleness limit
            </strong>
            <p>
              {staleAsset.symbol} last updated {staleAsset.oracleAge}; max staleness is 600s. Rebalances using this feed will revert past the threshold.
            </p>
          </div>
        </div>
      ) : null}
    </SectionCard>
  );
}

function ThesisModule({ currentThesis }: { currentThesis: string }) {
  const [isAppending, setIsAppending] = useState(false);
  const [draft, setDraft] = useState("");

  return (
    <SectionCard title="Thesis" subtitle="Public, append-only record" icon={<BookOpen size={15} />}>
      <div className="thesisBlock">
        <div className="subHeader">
          <span>Current Thesis</span>
          <small>Latest onchain version</small>
        </div>
        <p>{currentThesis}</p>
      </div>

      <div className="historyList">
        <div className="historyItem active">
          <span />
          <div>
            <strong>Latest amendment</strong>
            <p>Manager thesis is appended onchain and linked to the current portfolio hash.</p>
          </div>
        </div>
        <div className="historyItem">
          <span />
          <div>
            <strong>Initial thesis</strong>
            <p>Original thesis remains permanently retrievable and cannot be edited.</p>
          </div>
        </div>
      </div>

      {!isAppending ? (
        <div className="cardFooterAction">
          <span className="mutedInline">
            <Info size={14} />
            Thesis amendments do not reset the rebalance cooldown.
          </span>
          <button className="secondaryAction" type="button" onClick={() => setIsAppending(true)}>
            Append Amendment
          </button>
        </div>
      ) : (
        <div className="appendBox">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Describe the updated investment thesis or rationale..."
          />
          <div className="formActions">
            <button className="ghostAction" type="button" onClick={() => { setDraft(""); setIsAppending(false); }}>
              Cancel
            </button>
            <button className="primaryAction" type="button" disabled={!draft.trim()}>
              Submit Amendment
            </button>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function UserActions({ vaultSymbol }: { vaultSymbol: string }) {
  const [activeAction, setActiveAction] = useState<"mint" | "redeem">("mint");
  const [mintAmount, setMintAmount] = useState("");
  const [redeemAmount, setRedeemAmount] = useState("");
  const [approveState, setApproveState] = useState<TxState>("idle");
  const [mintState, setMintState] = useState<TxState>("idle");
  const [redeemState, setRedeemState] = useState<TxState>("idle");
  const [feeState, setFeeState] = useState<TxState>("idle");
  const navPerShare = 48.21;
  const mintShares = mintAmount ? (Number(mintAmount) / navPerShare).toFixed(4) : "-";

  return (
    <SectionCard title="Your position" subtitle={`Mint and redeem ${vaultSymbol}`} icon={<Wallet size={15} />}>
      <div className="actionTabs" role="tablist" aria-label="Vault position actions">
        <button className={activeAction === "mint" ? "active" : ""} type="button" onClick={() => setActiveAction("mint")}>Mint with basket</button>
        <button className={activeAction === "redeem" ? "active" : ""} type="button" onClick={() => setActiveAction("redeem")}>Redeem</button>
      </div>

      {activeAction === "mint" ? (
        <div className="positionFlow">
          <label className="fieldLabel">Basket value</label>
          <div className="inputWithSuffix">
            <input value={mintAmount} onChange={(event) => setMintAmount(event.target.value)} type="number" placeholder="0.00" />
            <span>USDC</span>
          </div>
          <div className="quoteLine">
            <span>You receive approx.</span>
            <strong>{mintShares} {vaultSymbol}</strong>
          </div>
          <div className="buttonRow">
            <button
              className="secondaryAction"
              type="button"
              disabled={approveState === "pending" || approveState === "confirmed"}
              onClick={() => runMockTx(setApproveState)}
            >
              {approveState === "confirmed" ? <CheckCircle size={14} /> : <ShieldCheck size={14} />}
              {approveState === "confirmed" ? "Approved" : "Approve Assets"}
            </button>
            <button className="primaryAction" type="button" disabled={!mintAmount || approveState !== "confirmed"} onClick={() => runMockTx(setMintState)}>
              <Coins size={14} />
              Mint
            </button>
          </div>
          <TxStatus state={mintState} />
        </div>
      ) : (
        <div className="positionFlow">
          <label className="fieldLabel">Shares to redeem</label>
          <div className="inputWithSuffix">
            <input value={redeemAmount} onChange={(event) => setRedeemAmount(event.target.value)} type="number" placeholder="0.00" />
            <span>{vaultSymbol}</span>
          </div>
          <div className="redeemPreview">
            <span>Est. mNVDA <strong>{redeemAmount ? (Number(redeemAmount) * 0.162).toFixed(4) : "-"}</strong></span>
            <span>Est. mMSFT <strong>{redeemAmount ? (Number(redeemAmount) * 0.039).toFixed(4) : "-"}</strong></span>
            <span>Est. mGOOGL <strong>{redeemAmount ? (Number(redeemAmount) * 0.061).toFixed(4) : "-"}</strong></span>
          </div>
          <button className="dangerAction" type="button" disabled={!redeemAmount} onClick={() => runMockTx(setRedeemState)}>
            <ArrowDownToLine size={14} />
            Redeem Proportionally
          </button>
          <TxStatus state={redeemState} />
        </div>
      )}

      <div className="feeAction">
        <div>
          <strong>Accrue creator fees</strong>
          <span>Fee accrual does not reset the rebalance cooldown.</span>
        </div>
        <button className="secondaryAction" type="button" onClick={() => runMockTx(setFeeState)}>
          <TrendingUp size={14} />
          {feeState === "confirmed" ? "Accrued" : "Accrue"}
        </button>
      </div>
    </SectionCard>
  );
}

function TxStatus({ state, persistent = false }: { state: TxState; persistent?: boolean }) {
  if (state === "idle" && !persistent) return null;
  const status = txStateLabel(state);
  return (
    <div className={`txStatus ${status.tone} ${persistent ? "persistent" : ""}`}>
      {persistent ? <span>Status</span> : null}
      <strong>
        {state === "pending" || state === "submitted" || state === "simulating" ? <Loader2 size={13} className="spin" /> : null}
        {state === "confirmed" || state === "ready" ? <CheckCircle size={13} /> : null}
        {state === "reverted" ? <XCircle size={13} /> : null}
        {status.label}
      </strong>
    </div>
  );
}

function ManagerRebalanceBuilder({ vault }: { vault: VaultView }) {
  const initialTargets = useMemo(
    () => vault.allocations.map((asset) => ({
      ticker: asset.symbol,
      address: shortAddress(asset.address),
      targetWeight: asset.targetWeightBps / 100,
    })),
    [vault.allocations],
  );
  const [targets, setTargets] = useState<TargetAsset[]>(initialTargets);
  const [rationale, setRationale] = useState("");
  const [txState, setTxState] = useState<TxState>("idle");

  const totalWeight = targets.reduce((sum, asset) => sum + Number(asset.targetWeight || 0), 0);
  const targetChanges = targets.map((asset, index) => {
    const current = (vault.allocations[index]?.actualWeightBps ?? 0) / 100;
    return { ...asset, current, delta: Number(asset.targetWeight || 0) - current };
  });
  const turnover = Math.max(0, targetChanges.reduce((sum, asset) => sum + Math.abs(asset.delta), 0) / 2);
  const maxDeviation = Math.max(0, ...targetChanges.map((asset) => Math.abs(asset.delta)));
  const weightsValid = Math.abs(totalWeight - 100) < 0.01;
  const turnoverLimit = vault.maxTurnoverBps / 100;
  const deviationLimit = vault.maxWeightDeviationBps / 100;
  const turnoverBreach = turnover > turnoverLimit;
  const deviationBreach = maxDeviation > deviationLimit;
  const staleAsset = vault.allocations.find((asset) => asset.freshnessTone === "warning");
  const reductions = targetChanges.filter((asset) => asset.delta < -0.01);
  const increases = targetChanges.filter((asset) => asset.delta > 0.01);
  const tradeInstructions = reductions.flatMap((sell) =>
    increases.map((buy) => ({
      from: sell.ticker || "Asset",
      to: buy.ticker || "Asset",
      notional: `${Math.min(Math.abs(sell.delta), buy.delta).toFixed(1)}% NAV`,
      adapter: "Approved adapter",
    })),
  ).slice(0, 3);

  function updateTarget(index: number, patch: Partial<TargetAsset>) {
    setTargets((current) => current.map((asset, itemIndex) => itemIndex === index ? { ...asset, ...patch } : asset));
  }

  return (
    <SectionCard
      title="Rebalance builder"
      subtitle="Manager-only · atomic basket execution"
      icon={<Scale size={15} />}
      action={<span className={`stateBadge ${vault.connectedIsManager ? "info" : "muted"}`}>Manager</span>}
    >
      <div className="builderBlock">
        <div className="subHeader">
          <span>Target weights</span>
          <small className={weightsValid ? "successText" : "warningText"}>Total: {totalWeight.toFixed(1)}%</small>
        </div>
        <div className="targetCardGrid">
          {targets.map((target, index) => (
            <div className="targetCard" key={`${target.ticker}-${index}`}>
              <div className="targetCardHeader">
                <input
                  className="targetTicker"
                  value={target.ticker}
                  onChange={(event) => updateTarget(index, { ticker: event.target.value })}
                  placeholder="Ticker"
                />
                <button
                  type="button"
                  title={`Remove ${target.ticker || "asset"}`}
                  onClick={() => setTargets((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <label>
                <span>Target weight</span>
                <div className="inputWithSuffix">
                  <input
                    value={target.targetWeight}
                    onChange={(event) => updateTarget(index, { targetWeight: Number(event.target.value) })}
                    type="number"
                    min={0}
                    max={100}
                    placeholder="0"
                  />
                  <span>%</span>
                </div>
              </label>
              <small>Current {targetChanges[index]?.current.toFixed(1) ?? "0.0"}%</small>
            </div>
          ))}
        </div>
        <button className="ghostAction addAssetAction" type="button" onClick={() => setTargets((current) => [...current, { ticker: "", address: "", targetWeight: 0 }])} disabled={targets.length >= vault.maxAssetCount}>
          <Plus size={13} />
          Add asset
        </button>
      </div>

      <div className="previewBlock">
        <div className="subHeader">
          <span>Current vs target</span>
          <small>Estimated turnover {turnover.toFixed(1)}%</small>
        </div>
        <div className="weightPreviewList">
          {targetChanges.map((target, index) => (
            <div className="weightPreviewRow" key={`${target.ticker}-preview-${index}`}>
              <strong>{target.ticker || "Asset"}</strong>
              <div className="weightTrack" aria-label={`${target.ticker} current ${target.current.toFixed(1)}%, target ${target.targetWeight.toFixed(1)}%`}>
                <span style={{ width: `${Math.min(target.current, 100)}%` }} />
                <i style={{ left: `${Math.min(Number(target.targetWeight || 0), 100)}%` }} />
              </div>
              <div>
                <span>{target.current.toFixed(1)}%</span>
                <ArrowRight size={12} />
                <strong>{Number(target.targetWeight || 0).toFixed(1)}%</strong>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="builderBlock">
        <div className="subHeader">
          <span className="inlineLabel"><ListChecks size={13} /> Trade instructions</span>
          <small>Approved adapters only</small>
        </div>
        <div className="tradeTableWrap">
          <table className="tradeTable">
            <thead>
              <tr>
                <th>Sell</th>
                <th>Buy</th>
                <th>Notional</th>
                <th>Adapter</th>
              </tr>
            </thead>
            <tbody>
              {tradeInstructions.length ? tradeInstructions.map((trade, index) => (
                <tr key={`${trade.from}-${trade.to}-${index}`}>
                  <td>{trade.from}</td>
                  <td>{trade.to}</td>
                  <td>{trade.notional}</td>
                  <td><span className="stateBadge success">{trade.adapter}</span></td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={4} className="emptyTableCell">No trades required for the current target set.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="riskMetricGrid">
        <div className={turnoverBreach ? "danger" : "warning"}>
          <span>Estimated turnover</span>
          <strong>{turnover.toFixed(1)}%</strong>
          <small>Limit {turnoverLimit.toFixed(1)}%</small>
        </div>
        <div>
          <span>Simulated NAV impact</span>
          <strong>-0.34%</strong>
          <small>Limit {bpsToPercent(vault.maxNavLossBps)}</small>
        </div>
        <div className={deviationBreach ? "danger" : "success"}>
          <span>Max weight deviation</span>
          <strong>{maxDeviation.toFixed(1)}%</strong>
          <small>Limit +/- {deviationLimit.toFixed(1)}%</small>
        </div>
      </div>

      <div className="builderBlock">
        <label className="fieldLabel">Rationale (recorded onchain)</label>
        <textarea value={rationale} onChange={(event) => setRationale(event.target.value)} placeholder="Why this rotation, and what would invalidate it?" />
      </div>

      <div className="builderWarnings">
        {!weightsValid ? (
          <div className="riskCallout warning"><AlertTriangle size={15} /><div><strong>Target weights must sum to 100%</strong><span>Adjust the proposed weights before simulation.</span></div></div>
        ) : null}
        {turnoverBreach ? (
          <div className="riskCallout danger"><XCircle size={15} /><div><strong>Turnover exceeds the immutable limit</strong><span>This transaction would revert atomically.</span></div></div>
        ) : null}
        {deviationBreach ? (
          <div className="riskCallout danger"><XCircle size={15} /><div><strong>Target deviation exceeds the vault limit</strong><span>Reduce the largest portfolio change.</span></div></div>
        ) : null}
        {staleAsset ? (
          <div className="riskCallout warning"><AlertTriangle size={15} /><div><strong>{staleAsset.symbol} oracle is approaching staleness</strong><span>Last updated {staleAsset.oracleAge}; refresh before submission.</span></div></div>
        ) : null}
        {!vault.canRebalance ? (
          <div className="riskCallout warning"><Clock3 size={15} /><div><strong>Cooldown active</strong><span>Prepare and simulate now; submission opens {formatRelativeAvailability(vault.nextPortfolioChange)}.</span></div></div>
        ) : null}
        {txState === "ready" ? (
          <div className="riskCallout success"><CheckCircle size={15} /><div><strong>Simulation passed</strong><span>All current adapter, oracle, and portfolio checks passed.</span></div></div>
        ) : null}
      </div>

      <TxStatus state={txState} persistent />
      <div className="builderActions">
        <button className="secondaryAction" type="button" disabled={!weightsValid} onClick={() => { setTxState("simulating"); window.setTimeout(() => setTxState("ready"), 1_200); }}>
          <Zap size={14} />
          Simulate transaction
        </button>
        <button className="primaryAction" type="button" disabled={!weightsValid || turnoverBreach || deviationBreach || !vault.canRebalance || !vault.connectedIsManager || !rationale.trim() || txState !== "ready"} onClick={() => runMockTx(setTxState)}>
          <RefreshCw size={14} />
          Submit atomic rebalance
        </button>
      </div>
      <p className="builderFootnote">Rebalances swap assets inside the vault only. The manager has no withdrawal path.</p>
    </SectionCard>
  );
}

function SafetyLimits({ vault }: { vault: VaultView }) {
  const limits = [
    ["Maximum turnover", bpsToPercent(vault.maxTurnoverBps), "Per rebalance, of NAV"],
    ["Maximum NAV loss", bpsToPercent(vault.maxNavLossBps), "Atomic revert threshold"],
    ["Maximum target deviation", `+/- ${bpsToPercent(vault.maxWeightDeviationBps)}`, "From oracle-priced actual weight"],
    ["Maximum assets", String(vault.maxAssetCount), "Concurrent positions"],
    ["Maximum individual weight", bpsToPercent(vault.maxSingleAssetWeightBps), "Single-position cap"],
    ["Minimum nonzero weight", bpsToPercent(vault.minNonZeroAssetWeightBps), "Dust threshold"],
    ["Oracle max staleness", `${vault.maxOracleStaleness}s`, "Freshness required at execution"],
    ["Rebalance cooldown", formatCooldown(vault.cooldownSeconds), "Cannot be shortened"],
  ] as const;

  return (
    <SectionCard
      title="Safety limits"
      subtitle="Immutable at deployment"
      icon={<ShieldCheck size={15} />}
      action={<span className="stateBadge muted"><LockKeyhole size={11} /> Immutable</span>}
    >
      <div className="limitList">
        {limits.map(([label, value, description]) => (
          <div className="limitRow" key={label}>
            <div>
              <strong>{label}</strong>
              <small>{description}</small>
            </div>
            <span>{value}<LockKeyhole size={12} /></span>
          </div>
        ))}
      </div>
      <div className="executionPolicy">
        <ShieldCheck size={14} />
        <div>
          <strong>Bounded execution</strong>
          <span>Every rebalance uses listed assets and approved adapters, and settles atomically or fully reverts.</span>
        </div>
      </div>
      <p className="safetyFootnote">The manager may rotate assets only inside these bounds and cannot transfer vault assets out.</p>
    </SectionCard>
  );
}

function AppPageHeader({
  title,
  description,
  icon,
  actions,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="appPageHeader">
      <div>
        <span className="appPageIcon">{icon}</span>
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </div>
      {actions ? <div className="appPageActions">{actions}</div> : null}
    </header>
  );
}

function VaultsDirectory({
  currentVault,
  onManageVault,
  onOpenVault,
  onCreateVault,
}: {
  currentVault: VaultView;
  onManageVault: () => void;
  onOpenVault: () => void;
  onCreateVault: () => void;
}) {
  const [query, setQuery] = useState("");
  const rows = useMemo(
    () => [
      {
        name: currentVault.name,
        symbol: currentVault.symbol,
        monogram: "TECH",
        nav: "$4,821,302",
        change: "+1.42%",
        assets: currentVault.allocations.length,
        fee: bpsToPercent(currentVault.creatorFeeBps),
        manager: shortAddress(currentVault.manager),
        liquidity: "$1.26M",
        oracle: `${currentVault.allocations.length}/${currentVault.allocations.length} fresh`,
        live: true,
      },
      {
        name: "Onchain Dividend Quality",
        symbol: "OTF-DIV",
        monogram: "DIV",
        nav: "$2,184,930",
        change: "+0.38%",
        assets: 8,
        fee: "0.60%",
        manager: "0x74e2...B109",
        liquidity: "$684K",
        oracle: "8/8 fresh",
        live: false,
      },
      {
        name: "Digital Asset Momentum",
        symbol: "OTF-MOM",
        monogram: "MOM",
        nav: "$1,093,448",
        change: "-0.72%",
        assets: 5,
        fee: "0.75%",
        manager: "0x1A86...90F4",
        liquidity: "$391K",
        oracle: "5/5 fresh",
        live: false,
      },
    ],
    [currentVault],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const visibleRows = rows.filter(
    (row) =>
      !normalizedQuery ||
      row.name.toLowerCase().includes(normalizedQuery) ||
      row.symbol.toLowerCase().includes(normalizedQuery),
  );
  const hasManagerAccess = currentVault.connectedIsManager || !currentVault.enabled;

  return (
    <div className="appView">
      <AppPageHeader
        title="Vaults"
        description="Discover and monitor permissionless managed portfolios."
        icon={<LayoutGrid size={18} />}
        actions={
          <button className="primaryAction" type="button" onClick={onCreateVault}>
            <Plus size={14} />
            Create vault
          </button>
        }
      />

      <div className="directoryMetrics">
        <MetricCard label="Protocol NAV" value="$8.10M" icon={<CircleDollarSign size={14} />} sub="Across 3 testnet vaults" />
        <MetricCard label="Active Vaults" value="3" icon={<Landmark size={14} />} sub="All accepting deposits" />
        <MetricCard label="Oracle Health" value="16/16" icon={<HeartPulse size={14} />} tone="success" sub="Feeds currently fresh" />
        <MetricCard label="Secondary Liquidity" value="$2.34M" icon={<ArrowRightLeft size={14} />} sub="Across vault share pools" />
      </div>

      {hasManagerAccess ? (
        <section className="sectionCard managedVaultsPanel">
          <div className="managedVaultsHeading">
            <div>
              <span className="appPageIcon"><UserCog size={16} /></span>
              <div>
                <h2>Vaults you manage</h2>
                <p>Manager controls and protocol operations for vaults created by this wallet.</p>
              </div>
            </div>
            <span className="stateBadge success">1 vault</span>
          </div>
          <div className="managedVaultRow">
            <div className="directoryVault">
              <span>TECH</span>
              <div>
                <strong>{currentVault.name}</strong>
                <small>{currentVault.symbol} · manager workspace</small>
              </div>
            </div>
            <div className="managedVaultStat">
              <span>NAV</span>
              <strong>$4,821,302</strong>
            </div>
            <div className="managedVaultStat">
              <span>Oracle health</span>
              <strong className="successText">{currentVault.allocations.length}/{currentVault.allocations.length} fresh</strong>
            </div>
            <div className="managedVaultStat">
              <span>Rebalance</span>
              <strong>{currentVault.canRebalance ? "Available" : "Cooling down"}</strong>
            </div>
            <div className="managedVaultActions">
              <button className="secondaryAction" type="button" onClick={onOpenVault}>
                Open vault
              </button>
              <button className="primaryAction" type="button" onClick={onManageVault}>
                <UserCog size={14} />
                Manage
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="sectionCard directoryPanel">
        <div className="directoryPanelHeading">
          <div>
            <h2>All vaults</h2>
            <p>Public vaults remain discoverable whether or not you manage them.</p>
          </div>
          <span className="stateBadge muted">{rows.length} vaults</span>
        </div>
        <div className="directoryToolbar">
          <label className="searchField">
            <Search size={14} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by vault name or symbol" />
          </label>
        </div>

        <div className="directoryTableWrap">
          <table className="directoryTable">
            <thead>
              <tr>
                <th>Vault</th>
                <th>NAV</th>
                <th>24h</th>
                <th>Assets</th>
                <th>Creator fee</th>
                <th>Manager</th>
                <th>Oracle health</th>
                <th>Liquidity</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr
                  key={row.symbol}
                  role="button"
                  tabIndex={0}
                  onClick={onOpenVault}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") onOpenVault();
                  }}
                >
                  <td>
                    <div className="directoryVault">
                      <span>{row.monogram}</span>
                      <div>
                        <strong>{row.name}</strong>
                        <small>{row.symbol}{row.live ? " · connected vault" : " · testnet preview"}</small>
                      </div>
                    </div>
                  </td>
                  <td>{row.nav}</td>
                  <td className={row.change.startsWith("+") ? "successText" : "dangerText"}>{row.change}</td>
                  <td>{row.assets}</td>
                  <td>{row.fee}</td>
                  <td className="monoValue">{row.manager}</td>
                  <td><span className="stateBadge success">{row.oracle}</span></td>
                  <td>{row.liquidity}</td>
                  <td><ChevronRight size={14} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visibleRows.length ? (
            <div className="emptyDirectory">
              <Search size={18} />
              <strong>No vaults found</strong>
              <span>Try a different vault name or symbol.</span>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function CreateVaultView({
  connectedAddress,
  onBack,
}: {
  connectedAddress?: string;
  onBack: () => void;
}) {
  const [step, setStep] = useState(0);
  const [deployState, setDeployState] = useState<TxState>("idle");
  const [draft, setDraft] = useState({
    name: "Onchain Technology Leaders",
    symbol: "OTF-TECH",
    thesis: "Concentrated exposure to tokenized technology leaders with durable cash flow and AI infrastructure growth.",
    manager: connectedAddress ?? suggestedManagerAddress,
    feeRecipient: connectedAddress ?? suggestedManagerAddress,
    creatorFee: "0.50",
    cooldownDays: "7",
    maxTurnover: "30",
    maxNavLoss: "2",
    maxDeviation: "5",
    maxSingleWeight: "50",
    minNonzeroWeight: "1",
    maxAssets: "10",
    oracleStaleness: "600",
  });
  const [portfolio, setPortfolio] = useState<TargetAsset[]>(
    demoAllocations.map((asset) => ({
      ticker: asset.symbol,
      address: asset.address,
      targetWeight: asset.targetWeightBps / 100,
    })),
  );
  const steps = [
    { label: "Basics", description: "Identity and roles" },
    { label: "Portfolio", description: "Assets and weights" },
    { label: "Safety", description: "Immutable limits" },
    { label: "Review", description: "Confirm deployment" },
  ];
  const totalWeight = portfolio.reduce((sum, asset) => sum + Number(asset.targetWeight || 0), 0);
  const basicsValid =
    draft.name.trim().length > 2 &&
    draft.symbol.trim().length > 2 &&
    draft.thesis.trim().length > 20 &&
    isAddress(draft.manager) &&
    isAddress(draft.feeRecipient);
  const portfolioValid =
    portfolio.length > 0 &&
    portfolio.every((asset) => asset.ticker.trim() && isAddress(asset.address) && asset.targetWeight > 0) &&
    Math.abs(totalWeight - 100) < 0.01;
  const safetyValid =
    Number(draft.cooldownDays) >= 7 &&
    Number(draft.creatorFee) >= 0 &&
    Number(draft.maxTurnover) > 0 &&
    Number(draft.maxNavLoss) > 0 &&
    Number(draft.maxDeviation) > 0 &&
    Number(draft.maxSingleWeight) <= 100 &&
    Number(draft.minNonzeroWeight) > 0 &&
    Number(draft.maxAssets) >= portfolio.length &&
    Number(draft.oracleStaleness) > 0;
  const stepValid = [basicsValid, portfolioValid, safetyValid, basicsValid && portfolioValid && safetyValid][step];
  const nextAvailableAsset = knownCreateAssets.find(
    (candidate) => !portfolio.some((asset) => asset.address === candidate.address),
  );

  useEffect(() => {
    if (!connectedAddress) return;
    setDraft((current) => ({
      ...current,
      manager: current.manager === suggestedManagerAddress ? connectedAddress : current.manager,
      feeRecipient: current.feeRecipient === suggestedManagerAddress ? connectedAddress : current.feeRecipient,
    }));
  }, [connectedAddress]);

  function updateDraft(field: keyof typeof draft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function updatePortfolio(index: number, patch: Partial<TargetAsset>) {
    setPortfolio((current) => current.map((asset, itemIndex) => itemIndex === index ? { ...asset, ...patch } : asset));
  }

  function addPortfolioAsset() {
    if (!nextAvailableAsset) return;
    setPortfolio((current) => [
      ...current,
      {
        ticker: nextAvailableAsset.symbol,
        address: nextAvailableAsset.address,
        targetWeight: 0,
      },
    ]);
  }

  return (
    <div className="appView">
      <AppPageHeader
        title="Create vault"
        description="Deploy a managed portfolio with immutable safety bounds."
        icon={<FilePlus2 size={18} />}
      />

      <div className="createLayout">
        <aside className="createSteps" aria-label="Vault creation progress">
          {steps.map((item, index) => (
            <button className={`${step === index ? "active" : ""} ${index < step ? "complete" : ""}`} key={item.label} type="button" onClick={() => setStep(index)}>
              <span>{index < step ? <CheckCircle size={14} /> : index + 1}</span>
              <div>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </div>
            </button>
          ))}
          <div className="createNotice">
            <LockKeyhole size={14} />
            <span>Portfolio limits and cooldown become immutable after deployment.</span>
          </div>
        </aside>

        <section className="sectionCard createForm">
          <div className="sectionTitle">
            <div className="sectionHeading">
              <div className="sectionTitleLine">
                <span className="stepNumber">{step + 1}</span>
                <h2>{steps[step].label}</h2>
              </div>
              <p>{steps[step].description}</p>
            </div>
            <span className="stateBadge muted">Step {step + 1} of {steps.length}</span>
          </div>
          <div className="sectionBody">
            {step === 0 ? (
              <div className="formSection">
                <div className="formGrid twoColumns">
                  <label>
                    <span>Vault name</span>
                    <input value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} placeholder="Technology Leaders" />
                  </label>
                  <label>
                    <span>Share symbol</span>
                    <input value={draft.symbol} onChange={(event) => updateDraft("symbol", event.target.value.toUpperCase())} placeholder="OTF-TECH" />
                  </label>
                </div>
                <label>
                  <span>Initial investment thesis</span>
                  <textarea value={draft.thesis} onChange={(event) => updateDraft("thesis", event.target.value)} rows={4} placeholder="Describe the portfolio mandate and investment rationale." />
                  <small>This begins the vault&apos;s permanent, append-only thesis history.</small>
                </label>
                <div className="formGrid twoColumns">
                  <label>
                    <span>Manager address</span>
                    <input className={!isAddress(draft.manager) && draft.manager ? "invalid" : ""} value={draft.manager} onChange={(event) => updateDraft("manager", event.target.value)} placeholder="0x..." />
                    <small>May propose rebalances and amend the thesis.</small>
                  </label>
                  <label>
                    <span>Fee recipient</span>
                    <input className={!isAddress(draft.feeRecipient) && draft.feeRecipient ? "invalid" : ""} value={draft.feeRecipient} onChange={(event) => updateDraft("feeRecipient", event.target.value)} placeholder="0x..." />
                    <small>Receives accrued creator-fee shares.</small>
                  </label>
                </div>
              </div>
            ) : null}

            {step === 1 ? (
              <div className="formSection">
                <div className="formIntro">
                  <div>
                    <strong>Initial target portfolio</strong>
                    <span>Select from the testnet asset catalog; token addresses resolve automatically.</span>
                  </div>
                  <span className={`stateBadge ${portfolioValid ? "success" : "warning"}`}>Total {totalWeight.toFixed(1)}%</span>
                </div>
                <div className="createAssetList">
                  {portfolio.map((asset, index) => (
                    <div className="createAssetRow" key={`${asset.ticker}-${index}`}>
                      <label>
                        <span>Asset</span>
                        <select
                          value={asset.address}
                          onChange={(event) => {
                            const selected = knownCreateAssets.find((candidate) => candidate.address === event.target.value);
                            if (selected) {
                              updatePortfolio(index, { ticker: selected.symbol, address: selected.address });
                            }
                          }}
                        >
                          {knownCreateAssets.map((candidate) => (
                            <option
                              key={candidate.address}
                              value={candidate.address}
                              disabled={portfolio.some(
                                (portfolioAsset, assetIndex) =>
                                  assetIndex !== index && portfolioAsset.address === candidate.address,
                              )}
                            >
                              {candidate.symbol} · {candidate.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Token address</span>
                        <div className="resolvedAssetAddress" title={asset.address}>
                          <code>{shortAssetAddress(asset.address)}</code>
                          <span><CheckCircle size={11} /> Resolved</span>
                        </div>
                      </label>
                      <label>
                        <span>Weight</span>
                        <div className="inputWithSuffix">
                          <input type="number" min={0} max={100} value={asset.targetWeight} onChange={(event) => updatePortfolio(index, { targetWeight: Number(event.target.value) })} />
                          <span>%</span>
                        </div>
                      </label>
                      <button type="button" title={`Remove ${asset.ticker}`} onClick={() => setPortfolio((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  className="secondaryAction"
                  type="button"
                  onClick={addPortfolioAsset}
                  disabled={!nextAvailableAsset || portfolio.length >= Number(draft.maxAssets)}
                >
                  <Plus size={14} />
                  Add asset
                </button>
                {!portfolioValid ? (
                  <div className="riskCallout warning">
                    <AlertTriangle size={15} />
                    <div><strong>Portfolio needs attention</strong><span>Use positive weights and make sure the total equals 100%.</span></div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {step === 2 ? (
              <div className="formSection">
                <div className="formGrid threeColumns">
                  <label><span>Creator fee</span><div className="inputWithSuffix"><input type="number" min={0} value={draft.creatorFee} onChange={(event) => updateDraft("creatorFee", event.target.value)} /><span>% / yr</span></div></label>
                  <label><span>Rebalance cooldown</span><div className="inputWithSuffix"><input type="number" min={7} value={draft.cooldownDays} onChange={(event) => updateDraft("cooldownDays", event.target.value)} /><span>days</span></div><small>Seven-day protocol minimum.</small></label>
                  <label><span>Maximum assets</span><input type="number" min={portfolio.length} value={draft.maxAssets} onChange={(event) => updateDraft("maxAssets", event.target.value)} /></label>
                  <label><span>Maximum turnover</span><div className="inputWithSuffix"><input type="number" value={draft.maxTurnover} onChange={(event) => updateDraft("maxTurnover", event.target.value)} /><span>% NAV</span></div></label>
                  <label><span>Maximum NAV loss</span><div className="inputWithSuffix"><input type="number" value={draft.maxNavLoss} onChange={(event) => updateDraft("maxNavLoss", event.target.value)} /><span>%</span></div></label>
                  <label><span>Maximum deviation</span><div className="inputWithSuffix"><input type="number" value={draft.maxDeviation} onChange={(event) => updateDraft("maxDeviation", event.target.value)} /><span>%</span></div></label>
                  <label><span>Maximum single weight</span><div className="inputWithSuffix"><input type="number" value={draft.maxSingleWeight} onChange={(event) => updateDraft("maxSingleWeight", event.target.value)} /><span>%</span></div></label>
                  <label><span>Minimum nonzero weight</span><div className="inputWithSuffix"><input type="number" value={draft.minNonzeroWeight} onChange={(event) => updateDraft("minNonzeroWeight", event.target.value)} /><span>%</span></div></label>
                  <label><span>Oracle max staleness</span><div className="inputWithSuffix"><input type="number" value={draft.oracleStaleness} onChange={(event) => updateDraft("oracleStaleness", event.target.value)} /><span>seconds</span></div></label>
                </div>
                <div className="executionPolicy createGuarantees">
                  <ShieldCheck size={14} />
                  <div>
                    <strong>Trade execution remains constrained</strong>
                    <span>Rebalances use listed assets, approved adapters, and exact temporary approvals in one atomic transaction.</span>
                  </div>
                </div>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="formSection reviewSection">
                <div className="reviewHero">
                  <span className="vaultMonogram">NEW</span>
                  <div><h2>{draft.name}</h2><span>{draft.symbol} · {portfolio.length} assets · {draft.creatorFee}% annual creator fee</span></div>
                </div>
                <div className="reviewGrid">
                  <div><span>Manager</span><strong>{shortAddress(draft.manager)}</strong></div>
                  <div><span>Fee recipient</span><strong>{shortAddress(draft.feeRecipient)}</strong></div>
                  <div><span>Cooldown</span><strong>{draft.cooldownDays} days</strong></div>
                  <div><span>Maximum turnover</span><strong>{draft.maxTurnover}%</strong></div>
                  <div><span>Maximum NAV loss</span><strong>{draft.maxNavLoss}%</strong></div>
                  <div><span>Oracle staleness</span><strong>{draft.oracleStaleness}s</strong></div>
                </div>
                <div>
                  <div className="subHeader"><span>Initial portfolio</span><small>Total {totalWeight.toFixed(1)}%</small></div>
                  <div className="reviewPortfolio">
                    {portfolio.map((asset) => <span key={asset.address}><strong>{asset.ticker}</strong>{asset.targetWeight.toFixed(1)}%</span>)}
                  </div>
                </div>
                <div className="riskCallout warning">
                  <LockKeyhole size={15} />
                  <div><strong>Review immutable settings carefully</strong><span>The manager cannot weaken safety limits or shorten the cooldown after deployment.</span></div>
                </div>
                <TxStatus state={deployState} persistent />
                {deployState === "confirmed" ? (
                  <div className="deploymentSuccess">
                    <CheckCircle size={18} />
                    <div><strong>Vault deployment confirmed</strong><span>The new vault is ready for initial funding and management.</span></div>
                    <button className="secondaryAction" type="button" onClick={onBack}>View in Vaults</button>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="createFormActions">
              <button className="secondaryAction" type="button" onClick={() => step === 0 ? onBack() : setStep((current) => current - 1)}>
                <ArrowLeft size={14} />
                {step === 0 ? "Back to vaults" : "Back"}
              </button>
              {step < steps.length - 1 ? (
                <button className="primaryAction" type="button" disabled={!stepValid} onClick={() => setStep((current) => current + 1)}>
                  Continue
                  <ArrowRight size={14} />
                </button>
              ) : (
                <button className="primaryAction" type="button" disabled={!stepValid || deployState === "pending" || deployState === "submitted" || deployState === "confirmed"} onClick={() => runMockTx(setDeployState)}>
                  <FilePlus2 size={14} />
                  Deploy vault
                </button>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function DepositsView({
  connectedAddress,
  currentVault,
  onBrowseVaults,
  onOpenVault,
}: {
  connectedAddress?: string;
  currentVault: VaultView;
  onBrowseVaults: () => void;
  onOpenVault: () => void;
}) {
  return (
    <div className="appView">
      <AppPageHeader
        title="My deposits"
        description="Track vault shares, current value, and portfolio returns across the protocol."
        icon={<Wallet size={18} />}
        actions={
          <button className="secondaryAction" type="button" onClick={onBrowseVaults}>
            <LayoutGrid size={14} />
            Explore vaults
          </button>
        }
      />

      {connectedAddress ? (
        <>
          <div className="depositMetrics">
            <MetricCard label="Current Value" value="$22,184.32" icon={<CircleDollarSign size={14} />} sub="Across 2 vault positions" />
            <MetricCard label="Net Deposits" value="$21,442.80" icon={<ArrowDownToLine size={14} />} sub="Lifetime principal" />
            <MetricCard label="Total Return" value="+$741.52" icon={<TrendingUp size={14} />} tone="success" sub="+3.46% all time" />
            <MetricCard label="Wallet" value={shortAddress(connectedAddress)} icon={<Wallet size={14} />} sub="Robinhood Testnet" />
          </div>

          <section className="sectionCard depositPositions">
            <div className="directoryPanelHeading">
              <div>
                <h2>Vault positions</h2>
                <p>Balances are valued with the same fresh onchain prices used by each vault.</p>
              </div>
              <span className="stateBadge muted">2 positions</span>
            </div>
            <div className="directoryTableWrap">
              <table className="directoryTable depositsTable">
                <thead>
                  <tr>
                    <th>Vault</th>
                    <th>Shares</th>
                    <th>Deposited</th>
                    <th>Current value</th>
                    <th>Total return</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  <tr role="button" tabIndex={0} onClick={onOpenVault} onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") onOpenVault();
                  }}>
                    <td>
                      <div className="directoryVault">
                        <span>TECH</span>
                        <div><strong>{currentVault.name}</strong><small>{currentVault.symbol}</small></div>
                      </div>
                    </td>
                    <td className="monoValue">82.4182</td>
                    <td>$10,214.40</td>
                    <td><strong>$10,583.12</strong></td>
                    <td className="successText">+$368.72 · 3.61%</td>
                    <td><ChevronRight size={14} /></td>
                  </tr>
                  <tr role="button" tabIndex={0} onClick={onOpenVault} onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") onOpenVault();
                  }}>
                    <td>
                      <div className="directoryVault">
                        <span>DIV</span>
                        <div><strong>Onchain Dividend Quality</strong><small>OTF-DIV</small></div>
                      </div>
                    </td>
                    <td className="monoValue">106.9320</td>
                    <td>$11,228.40</td>
                    <td><strong>$11,601.20</strong></td>
                    <td className="successText">+$372.80 · 3.32%</td>
                    <td><ChevronRight size={14} /></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <section className="sectionCard depositsEmpty">
          <span><Wallet size={22} /></span>
          <h2>Connect your wallet to view deposits</h2>
          <p>Your vault shares, deposited principal, and returns will appear here after the wallet connection is approved.</p>
          <button className="secondaryAction" type="button" onClick={onBrowseVaults}>
            <LayoutGrid size={14} />
            Browse vaults
          </button>
        </section>
      )}
    </div>
  );
}

function ManageVaultsView({
  vault,
  onBack,
  onOpenVault,
}: {
  vault: VaultView;
  onBack: () => void;
  onOpenVault: () => void;
}) {
  const [managerTarget, setManagerTarget] = useState("");
  const [feeTarget, setFeeTarget] = useState("");
  const [managerTx, setManagerTx] = useState<TxState>("idle");
  const [feeTx, setFeeTx] = useState<TxState>("idle");
  const [accrualTx, setAccrualTx] = useState<TxState>("idle");
  const [copied, setCopied] = useState(false);
  const managerValid = isAddress(managerTarget);
  const feeTargetValid = isAddress(feeTarget);

  async function copyVaultAddress() {
    if (!vault.address) return;
    try {
      await navigator.clipboard.writeText(vault.address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="appView">
      <div className="vaultBreadcrumb appBreadcrumb">
        <button type="button" onClick={onBack}>
          <ArrowLeft size={12} />
          Vaults
        </button>
        <span>/</span>
        <button type="button" onClick={onOpenVault}>{vault.name}</button>
        <span>/</span>
        <strong>Manage</strong>
      </div>
      <AppPageHeader
        title="Manage"
        description="Administer vault roles and routine protocol operations."
        icon={<UserCog size={18} />}
        actions={
          <button className="secondaryAction" type="button" onClick={onOpenVault}>
            Open vault
            <ChevronRight size={14} />
          </button>
        }
      />

      <section className="manageVaultHeader">
        <div className="vaultIdentity">
          <span className="vaultMonogram">TECH</span>
          <div>
            <div className="titleLine"><h2>{vault.name}</h2><span className="symbolBadge">{vault.symbol}</span></div>
            <div className="addressLine"><AddressPill label="Vault" address={vault.address} copied={copied} onCopy={copyVaultAddress} /></div>
          </div>
        </div>
        <div className="vaultMetaBadges">
          <span className={`stateBadge ${vault.connectedIsManager ? "success" : "muted"}`}>{vault.connectedIsManager ? "Manager connected" : "Read-only mode"}</span>
        </div>
      </section>

      <div className="manageMetrics">
        <MetricCard label="Current Manager" value={shortAddress(vault.manager)} icon={<KeyRound size={14} />} sub="Two-step transfer" />
        <MetricCard label="Fee Recipient" value={shortAddress(vault.feeRecipient)} icon={<ReceiptText size={14} />} sub="Two-step transfer" />
        <MetricCard label="Creator Fee" value={bpsToPercent(vault.creatorFeeBps)} icon={<Percent size={14} />} sub="Annualized" />
        <MetricCard label="Cooldown" value={formatCooldown(vault.cooldownSeconds)} icon={<Clock3 size={14} />} sub="Permanently immutable" />
      </div>

      <div className="manageGrid">
        <SectionCard title="Manager transfer" subtitle="Nominate a new portfolio manager" icon={<KeyRound size={15} />} action={<span className="stateBadge muted">Two-step</span>}>
          <div className="operationFlow">
            <div className="roleCurrent"><span>Current manager</span><strong>{shortAddress(vault.manager)}</strong></div>
            <label className="fieldLabel">New manager address</label>
            <input className={!managerValid && managerTarget ? "invalid" : ""} value={managerTarget} onChange={(event) => setManagerTarget(event.target.value)} placeholder="0x..." />
            <p>The nominee must accept onchain before the role changes. Portfolio assets never leave the vault.</p>
            <TxStatus state={managerTx} persistent />
            <button className="primaryAction" type="button" disabled={!managerValid || !vault.connectedIsManager} onClick={() => runMockTx(setManagerTx)}>
              <UserCog size={14} />
              Initiate manager transfer
            </button>
          </div>
        </SectionCard>

        <SectionCard title="Fee-recipient transfer" subtitle="Update the creator-fee beneficiary" icon={<ReceiptText size={15} />} action={<span className="stateBadge muted">Two-step</span>}>
          <div className="operationFlow">
            <div className="roleCurrent"><span>Current recipient</span><strong>{shortAddress(vault.feeRecipient)}</strong></div>
            <label className="fieldLabel">New fee-recipient address</label>
            <input className={!feeTargetValid && feeTarget ? "invalid" : ""} value={feeTarget} onChange={(event) => setFeeTarget(event.target.value)} placeholder="0x..." />
            <p>The recipient must accept before future creator-fee shares are redirected.</p>
            <TxStatus state={feeTx} persistent />
            <button className="primaryAction" type="button" disabled={!feeTargetValid || !vault.connectedIsManager} onClick={() => runMockTx(setFeeTx)}>
              <ReceiptText size={14} />
              Initiate recipient transfer
            </button>
          </div>
        </SectionCard>

        <SectionCard title="Fee accrual" subtitle="Mint elapsed protocol and creator-fee shares" icon={<CircleDollarSign size={15} />} action={<span className="stateBadge success">Permissionless</span>}>
          <div className="operationFlow">
            <div className="accrualSummary">
              <div><span>Creator fee</span><strong>{bpsToPercent(vault.creatorFeeBps)} / yr</strong></div>
              <div><span>Protocol share</span><strong>{bpsToPercent(vault.protocolFeeShareBps)}</strong></div>
              <div><span>Estimated claimable</span><strong>12,041.82 USDC</strong></div>
            </div>
            <div className="riskCallout success"><CheckCircle size={15} /><div><strong>Cooldown unaffected</strong><span>Fee accrual does not count as a portfolio rebalance.</span></div></div>
            <TxStatus state={accrualTx} persistent />
            <button className="secondaryAction" type="button" onClick={() => runMockTx(setAccrualTx)}>
              <CircleDollarSign size={14} />
              Accrue fees
            </button>
          </div>
        </SectionCard>

        <SectionCard title="Manager permissions" subtitle="Capabilities constrained by the vault contract" icon={<ShieldCheck size={15} />} action={<span className="stateBadge muted">Onchain</span>}>
          <div className="permissionList">
            <div><CheckCircle size={14} /><span><strong>May propose atomic rebalances</strong><small>Only approved assets and adapters, inside immutable limits.</small></span></div>
            <div><CheckCircle size={14} /><span><strong>May append thesis amendments</strong><small>History remains permanent and public.</small></span></div>
            <div><XCircle size={14} /><span><strong>Cannot withdraw portfolio assets</strong><small>No arbitrary manager-call or asset-transfer path exists.</small></span></div>
            <div><XCircle size={14} /><span><strong>Cannot shorten the cooldown</strong><small>The configured delay is permanently immutable.</small></span></div>
          </div>
        </SectionCard>
      </div>

      <div className="riskCallout warning manageNotice">
        <Info size={15} />
        <div><strong>Role transfers do not reset the rebalance cooldown</strong><span>Manager and fee-recipient changes are administrative operations, not portfolio changes.</span></div>
      </div>
    </div>
  );
}
