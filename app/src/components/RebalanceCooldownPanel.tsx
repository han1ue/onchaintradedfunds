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
  Pencil,
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
import { useAccount, useChainId, useReadContracts, useSwitchChain } from "wagmi";
import { robinhoodChain, robinhoodChainTestnet } from "@/lib/chains";
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

const navTabs = ["OTFs", "Create"];

const testnetAllocations: Allocation[] = [
  {
    symbol: "TSLA",
    name: "Tesla",
    address: "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E",
    targetWeightBps: 2_000,
    actualWeightBps: 2_120,
    balance: "1,842.4471",
    price: "$312.05",
    oracleAge: "38s ago",
    freshnessTone: "fresh",
    tone: "teal",
  },
  {
    symbol: "AMZN",
    name: "Amazon",
    address: "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02",
    targetWeightBps: 2_000,
    actualWeightBps: 1_940,
    balance: "2,401.2210",
    price: "$231.44",
    oracleAge: "1m 12s ago",
    freshnessTone: "fresh",
    tone: "blue",
  },
  {
    symbol: "PLTR",
    name: "Palantir Technologies",
    address: "0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0",
    targetWeightBps: 2_000,
    actualWeightBps: 1_980,
    balance: "3,912.8830",
    price: "$154.96",
    oracleAge: "52s ago",
    freshnessTone: "fresh",
    tone: "gold",
  },
  {
    symbol: "NFLX",
    name: "Netflix",
    address: "0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93",
    targetWeightBps: 2_000,
    actualWeightBps: 2_030,
    balance: "921.4052",
    price: "$1,195.18",
    oracleAge: "44s ago",
    freshnessTone: "fresh",
    tone: "rose",
  },
  {
    symbol: "AMD",
    name: "AMD",
    address: "0x71178BAc73cBeb415514eB542a8995b82669778d",
    targetWeightBps: 2_000,
    actualWeightBps: 1_930,
    balance: "4,218.7701",
    price: "$177.44",
    oracleAge: "1m 03s ago",
    freshnessTone: "fresh",
    tone: "violet",
  },
];

const testnetCreateAssets = testnetAllocations.map(({ symbol, name, address }) => ({
  symbol,
  name,
  address,
}));

const erc20BalanceAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "decimals", type: "uint8" }],
  },
] as const;

const suggestedVaultAddress = "0x4f9c2a71c8d3e6b5a09f1274ce83d6412a5c1ae3";
const suggestedManagerAddress = "0x8b1a47e2c0d4a718b8a942c1557f99259fa14d11";

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

function formatWalletTokenBalance(value: bigint | undefined, decimals: number): string {
  if (value === undefined) return "—";
  const amount = Number(formatUnits(value, decimals));
  return amount.toLocaleString(undefined, { maximumFractionDigits: 6 });
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
  if (!assets?.length || !weights?.length) return testnetAllocations;

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
  const { address: connectedAddress } = useAccount();
  const chainId = useChainId();
  const isTestnet = chainId === robinhoodChainTestnet.id;
  const enabled = Boolean(vaultAddress) && isTestnet;
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
    query: { enabled: Boolean(readContracts) && isTestnet },
  });

  const results = data as ReadResult | undefined;
  const vaultName = resultAt<string>(results, 0) ?? "Onchain Technology Leaders";
  const vaultSymbol = resultAt<string>(results, 1) ?? "OTF-TECH";
  const managerResult = resultAt<string>(results, 2);
  const feeRecipientResult = resultAt<string>(results, 3);
  const manager = managerResult && isAddress(managerResult) ? managerResult : suggestedManagerAddress;
  const feeRecipient =
    feeRecipientResult && isAddress(feeRecipientResult) ? feeRecipientResult : suggestedManagerAddress;
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
  const activeTab = view === "create" ? "Create" : "OTFs";

  useEffect(() => {
    if (!isTestnet && (view === "detail" || view === "manage")) {
      setView("vaults");
    }
  }, [isTestnet, view]);

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
        {view === "detail" && isTestnet ? (
          <>
            <VaultHeader
              vault={vault}
              canManage={vault.connectedIsManager || !vault.enabled}
              onBack={() => openView("vaults")}
              onManage={() => openView("manage")}
            />
            <VaultMetrics vault={vault} />
            <VaultPerformance vaultSymbol={vault.symbol} />

            {error ? (
              <div className="warningBanner danger">
                <XCircle size={16} />
                <span>Unable to read live OTF data. The dashboard is showing testnet preview values.</span>
              </div>
            ) : null}

            <div className="dashboardGrid">
              <div className="primaryColumn">
                <ThesisModule currentThesis={currentThesis} />
                <PortfolioAllocation allocations={allocations} />
              </div>

              <aside className="sideColumn">
                <SafetyLimits vault={vault} />
                <RebalanceCooldown vault={vault} />
                <UserActions vaultSymbol={vaultSymbol} />
              </aside>
            </div>
          </>
        ) : null}

        {view === "vaults" ? (
          <VaultsDirectory
            currentVault={vault}
            isTestnet={isTestnet}
            onManageVault={() => openView("manage")}
            onOpenVault={() => openView("detail")}
            onCreateVault={() => openView("create")}
          />
        ) : null}

        {view === "create" ? (
          <CreateVaultView connectedAddress={connectedAddress} isTestnet={isTestnet} onBack={() => openView("vaults")} />
        ) : null}

        {view === "manage" && isTestnet ? (
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
            isTestnet={isTestnet}
            onBrowseVaults={() => openView("vaults")}
            onOpenVault={() => openView("detail")}
          />
        ) : null}

        <footer className="dashboardFooter">
          <span>Onchain Traded Funds · experimental, unaudited software</span>
          <div className="footerLinks">
            <span>ERC-4626 OTFs · {isTestnet ? "Robinhood Testnet" : "Robinhood Mainnet"}</span>
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
  const chainId = useChainId();
  const { switchChain, isPending: networkSwitchPending } = useSwitchChain();
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
            title="Wallet"
          >
            <Wallet size={14} />
            <span>Wallet</span>
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
                  <div className="networkOptions">
                    <button
                      className={`settingsOption ${chainId === robinhoodChainTestnet.id ? "selected" : ""}`}
                      type="button"
                      disabled={networkSwitchPending}
                      onClick={() => switchChain({ chainId: robinhoodChainTestnet.id })}
                    >
                      <span className="settingsOptionIcon"><Network size={15} /></span>
                      <span className="settingsOptionText">
                        <strong>Robinhood Testnet</strong>
                        <small>{chainId === robinhoodChainTestnet.id ? "Connected" : "Chain ID 46630"}</small>
                      </span>
                      {chainId === robinhoodChainTestnet.id ? <Check className="settingsCheck" size={15} /> : null}
                    </button>
                    <button
                      className={`settingsOption ${chainId === robinhoodChain.id ? "selected" : ""}`}
                      type="button"
                      disabled={networkSwitchPending}
                      onClick={() => switchChain({ chainId: robinhoodChain.id })}
                    >
                      <span className="settingsOptionIcon"><Network size={15} /></span>
                      <span className="settingsOptionText">
                        <strong>Robinhood Mainnet</strong>
                        <small>{chainId === robinhoodChain.id ? "Connected" : "Chain ID 4663"}</small>
                      </span>
                      {chainId === robinhoodChain.id ? <Check className="settingsCheck" size={15} /> : null}
                    </button>
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

function VaultHeader({
  vault,
  canManage,
  onBack,
  onManage,
}: {
  vault: VaultView;
  canManage: boolean;
  onBack: () => void;
  onManage: () => void;
}) {
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
    <>
      <div className="vaultBreadcrumb detailBreadcrumb">
        <button type="button" onClick={onBack}>
          <ArrowLeft size={12} />
          OTFs
        </button>
        <span>/</span>
        <strong>{vault.name}</strong>
      </div>

      <section className="vaultHeader">
        <div className="vaultTitleRow">
          <div className="vaultIdentity">
            <div className="vaultMonogram">TECH</div>
            <div>
              <div className="titleLine">
                <h1>{vault.name}</h1>
                <span className="symbolBadge">{vault.symbol}</span>
              </div>
              <div className="addressLine">
                <AddressPill label="OTF" address={vault.address} copied={copied === "vault"} onCopy={() => copy(vault.address, "vault")} />
                <AddressPill label="Manager" address={vault.manager} copied={copied === "manager"} onCopy={() => copy(vault.manager, "manager")} />
              </div>
            </div>
          </div>
          {canManage ? (
            <button className="primaryAction vaultManageAction" type="button" onClick={onManage}>
              <UserCog size={14} />
              Manage OTF
            </button>
          ) : null}
        </div>
      </section>
    </>
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

const performanceSeries = {
  "1M": {
    start: "30 days ago",
    values: [0, 0.4, -0.2, 1.1, 1.8, 1.5, 2.9, 2.4, 3.6, 4.2],
  },
  "3M": {
    start: "3 months ago",
    values: [0, -1.1, 0.8, 2.4, 1.7, 4.6, 3.9, 6.1, 5.4, 7.2, 8.7],
  },
  "1Y": {
    start: "1 year ago",
    values: [0, 1.8, -1.2, 3.4, 2.1, 6.3, 8.9, 7.2, 11.8, 10.6, 14.1, 15.9],
  },
  ALL: {
    start: "Since inception",
    values: [0, -4.8, 2.2, 7.6, 5.1, 13.4, 17.8, 15.2, 24.6, 21.1, 30.4, 27.8, 34.2],
  },
} as const;

type PerformanceRange = keyof typeof performanceSeries;

function VaultPerformance({ vaultSymbol }: { vaultSymbol: string }) {
  const [range, setRange] = useState<PerformanceRange>("1Y");
  const series = performanceSeries[range];
  const values = [...series.values];
  const width = 960;
  const height = 220;
  const left = 52;
  const right = 18;
  const top = 18;
  const bottom = 30;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const minimum = Math.floor((Math.min(0, ...values) - 2) / 5) * 5;
  const maximum = Math.ceil((Math.max(0, ...values) + 2) / 5) * 5;
  const spread = Math.max(maximum - minimum, 1);
  const points = values.map((value, index) => ({
    value,
    x: left + (index / Math.max(values.length - 1, 1)) * chartWidth,
    y: top + ((maximum - value) / spread) * chartHeight,
  }));
  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const zeroY = top + ((maximum - 0) / spread) * chartHeight;
  const areaPath = `${linePath} L ${points.at(-1)?.x ?? left} ${zeroY} L ${left} ${zeroY} Z`;
  const ticks = Array.from({ length: 5 }, (_, index) => maximum - (spread * index) / 4);
  const periodReturn = values.at(-1) ?? 0;
  const navChange = 48.21 - 48.21 / (1 + periodReturn / 100);

  return (
    <SectionCard
      title="Performance"
      subtitle="OTF share return · oracle-valued NAV"
      icon={<TrendingUp size={15} />}
      action={
        <div className="performanceRanges" aria-label="Performance period">
          {(Object.keys(performanceSeries) as PerformanceRange[]).map((option) => (
            <button
              className={range === option ? "active" : ""}
              key={option}
              type="button"
              aria-pressed={range === option}
              onClick={() => setRange(option)}
            >
              {option}
            </button>
          ))}
        </div>
      }
    >
      <div className="performanceSummary">
        <div>
          <span>{range} return</span>
          <strong className={periodReturn >= 0 ? "successText" : "dangerText"}>
            {periodReturn >= 0 ? "+" : ""}{periodReturn.toFixed(1)}%
          </strong>
          <small>{series.start}</small>
        </div>
        <div>
          <span>Current NAV / share</span>
          <strong>$48.21</strong>
          <small>USDC terms</small>
        </div>
        <div>
          <span>Value change / share</span>
          <strong className={navChange >= 0 ? "successText" : "dangerText"}>
            {navChange >= 0 ? "+" : "-"}${Math.abs(navChange).toFixed(2)}
          </strong>
          <small>{vaultSymbol}</small>
        </div>
      </div>

      <div className="performanceChartWrap">
        <svg
          className="performanceChart"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${vaultSymbol} ${range} return chart ending at ${periodReturn.toFixed(1)} percent`}
        >
          {ticks.map((tick) => {
            const y = top + ((maximum - tick) / spread) * chartHeight;
            return (
              <g key={tick}>
                <line className="performanceGridLine" x1={left} x2={width - right} y1={y} y2={y} />
                <text className="performanceAxisLabel" x={left - 9} y={y + 3} textAnchor="end">
                  {tick > 0 ? "+" : ""}{tick.toFixed(0)}%
                </text>
              </g>
            );
          })}
          <path className="performanceArea" d={areaPath} />
          <path className="performanceLine" d={linePath} />
          {points.map((point, index) => (
            <circle className="performancePoint" cx={point.x} cy={point.y} key={`${point.x}-${point.y}`} r={index === points.length - 1 ? 4 : 2}>
              <title>{point.value >= 0 ? "+" : ""}{point.value.toFixed(1)}%</title>
            </circle>
          ))}
        </svg>
        <div className="performanceDates">
          <span>{series.start}</span>
          <span>Today</span>
        </div>
      </div>
    </SectionCard>
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

      <div className="cardFooterAction">
        <span className="mutedInline">
          <Info size={14} />
          Thesis amendments do not reset the rebalance cooldown.
        </span>
      </div>
    </SectionCard>
  );
}

function ThesisAmendmentCard({
  currentThesis,
  canManage,
}: {
  currentThesis: string;
  canManage: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [amendmentTx, setAmendmentTx] = useState<TxState>("idle");

  return (
    <SectionCard
      title="Thesis amendment"
      subtitle="Append to the public investment record"
      icon={<BookOpen size={15} />}
      action={<span className="stateBadge muted">Manager</span>}
    >
      <div className="operationFlow">
        <div className="thesisAmendmentCurrent">
          <span>Current thesis</span>
          <p>{currentThesis}</p>
        </div>
        <label className="fieldLabel" htmlFor="thesis-amendment">New amendment</label>
        <textarea
          id="thesis-amendment"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Describe the updated investment thesis or rationale..."
          rows={4}
        />
        <p>Amendments are permanent and public. Submitting one does not reset the rebalance cooldown.</p>
        <TxStatus state={amendmentTx} persistent />
        <button
          className="primaryAction"
          type="button"
          disabled={!draft.trim() || !canManage}
          onClick={() => runMockTx(setAmendmentTx)}
        >
          <BookOpen size={14} />
          Submit amendment
        </button>
      </div>
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
      <div className="actionTabs" role="tablist" aria-label="OTF position actions">
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
            <span>Est. TSLA <strong>{redeemAmount ? (Number(redeemAmount) * 0.042).toFixed(4) : "-"}</strong></span>
            <span>Est. AMZN <strong>{redeemAmount ? (Number(redeemAmount) * 0.057).toFixed(4) : "-"}</strong></span>
            <span>Est. PLTR <strong>{redeemAmount ? (Number(redeemAmount) * 0.084).toFixed(4) : "-"}</strong></span>
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
          <div className="riskCallout danger"><XCircle size={15} /><div><strong>Target deviation exceeds the OTF limit</strong><span>Reduce the largest portfolio change.</span></div></div>
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
      <p className="builderFootnote">Rebalances swap assets inside the OTF only. The manager has no withdrawal path.</p>
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
            <span>{value}</span>
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
      <p className="safetyFootnote">The manager may rotate assets only inside these bounds and cannot transfer OTF assets out.</p>
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
  isTestnet,
  onManageVault,
  onOpenVault,
  onCreateVault,
}: {
  currentVault: VaultView;
  isTestnet: boolean;
  onManageVault: () => void;
  onOpenVault: () => void;
  onCreateVault: () => void;
}) {
  const [query, setQuery] = useState("");
  const rows = useMemo(
    () => isTestnet ? [
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
    ] : [],
    [currentVault, isTestnet],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const visibleRows = rows.filter(
    (row) =>
      !normalizedQuery ||
      row.name.toLowerCase().includes(normalizedQuery) ||
      row.symbol.toLowerCase().includes(normalizedQuery),
  );
  const hasManagerAccess = isTestnet && (currentVault.connectedIsManager || !currentVault.enabled);

  return (
    <div className="appView">
      <AppPageHeader
        title="Onchain Traded Funds"
        description="Discover and monitor managed onchain funds."
        icon={<LayoutGrid size={18} />}
        actions={
          <button className="primaryAction" type="button" disabled={!isTestnet} onClick={onCreateVault}>
            <Plus size={14} />
            {isTestnet ? "Create OTF" : "Mainnet unavailable"}
          </button>
        }
      />

      <div className="directoryMetrics">
        <MetricCard label="Protocol NAV" value={isTestnet ? "$8.10M" : "$0"} icon={<CircleDollarSign size={14} />} sub={isTestnet ? "Across 3 testnet OTFs" : "No Mainnet deployments"} />
        <MetricCard label="Active OTFs" value={isTestnet ? "3" : "0"} icon={<Landmark size={14} />} sub={isTestnet ? "All accepting deposits" : "Mainnet not launched"} />
        <MetricCard label="Oracle Health" value={isTestnet ? "18/18" : "—"} icon={<HeartPulse size={14} />} tone={isTestnet ? "success" : undefined} sub={isTestnet ? "Feeds currently fresh" : "No supported feeds"} />
        <MetricCard label="Secondary Liquidity" value={isTestnet ? "$2.34M" : "$0"} icon={<ArrowRightLeft size={14} />} sub={isTestnet ? "Across OTF share pools" : "No Mainnet pools"} />
      </div>

      {hasManagerAccess ? (
        <section className="sectionCard managedVaultsPanel">
          <div className="managedVaultsHeading">
            <div>
              <span className="appPageIcon"><UserCog size={16} /></span>
              <div>
                <h2>OTFs you manage</h2>
                <p>Manager controls and protocol operations for OTFs created by this wallet.</p>
              </div>
            </div>
            <span className="stateBadge success">1 OTF</span>
          </div>
          <div className="directoryTableWrap">
            <table className="directoryTable managedDirectoryTable">
              <thead>
                <tr>
                  <th>OTF</th>
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
                <tr role="button" tabIndex={0} onClick={onOpenVault} onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") onOpenVault();
                }}>
                  <td>
                    <div className="directoryVault">
                      <span>TECH</span>
                      <div>
                        <strong>{currentVault.name}</strong>
                        <small>{currentVault.symbol} · manager workspace</small>
                      </div>
                    </div>
                  </td>
                  <td>$4,821,302</td>
                  <td className="successText">+1.42%</td>
                  <td>{currentVault.allocations.length}</td>
                  <td>{bpsToPercent(currentVault.creatorFeeBps)}</td>
                  <td className="monoValue">{shortAddress(currentVault.manager)}</td>
                  <td><span className="stateBadge success">{currentVault.allocations.length}/{currentVault.allocations.length} fresh</span></td>
                  <td>$1.26M</td>
                  <td>
                    <div className="managedTableActions">
                      <button className="secondaryAction" type="button" onClick={(event) => {
                        event.stopPropagation();
                        onOpenVault();
                      }}>
                        Open OTF
                      </button>
                      <button className="primaryAction" type="button" onClick={(event) => {
                        event.stopPropagation();
                        onManageVault();
                      }}>
                        <UserCog size={14} />
                        Manage
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="sectionCard directoryPanel">
        <div className="directoryPanelHeading">
          <div>
            <h2>All OTFs</h2>
            <p>{isTestnet ? "Public OTFs remain discoverable whether or not you manage them." : "Robinhood Mainnet support has not launched yet."}</p>
          </div>
          <span className="stateBadge muted">{rows.length} OTFs</span>
        </div>
        <div className="directoryToolbar">
          <label className="searchField">
            <Search size={14} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by OTF name or symbol" />
          </label>
        </div>

        <div className="directoryTableWrap">
          <table className="directoryTable">
            <thead>
              <tr>
                <th>OTF</th>
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
                        <small>{row.symbol}{row.live ? " · connected OTF" : " · testnet preview"}</small>
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
              <strong>{isTestnet ? "No OTFs found" : "No Mainnet OTFs"}</strong>
              <span>{isTestnet ? "Try a different OTF name or symbol." : "Switch to Robinhood Testnet to use the current protocol deployment."}</span>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function CreateVaultView({
  connectedAddress,
  isTestnet,
  onBack,
}: {
  connectedAddress?: string;
  isTestnet: boolean;
  onBack: () => void;
}) {
  const [step, setStep] = useState(0);
  const [deployState, setDeployState] = useState<TxState>("idle");
  const [customManager, setCustomManager] = useState(false);
  const [customFeeRecipient, setCustomFeeRecipient] = useState(false);
  const [draft, setDraft] = useState({
    name: "",
    symbol: "OTF-",
    thesis: "",
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
    testnetAllocations.map((asset) => ({
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
  const totalWeightValid = Math.abs(totalWeight - 100) < 0.01;
  const basicsValid =
    draft.name.trim().length > 2 &&
    /^OTF-[A-Z0-9][A-Z0-9-]*$/.test(draft.symbol) &&
    draft.thesis.trim().length > 20 &&
    isAddress(draft.manager) &&
    isAddress(draft.feeRecipient);
  const portfolioValid =
    portfolio.length > 0 &&
    portfolio.every((asset) => asset.ticker.trim() && isAddress(asset.address) && asset.targetWeight > 0) &&
    totalWeightValid;
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
  const nextAvailableAsset = testnetCreateAssets.find(
    (candidate) => !portfolio.some((asset) => asset.address === candidate.address),
  );

  useEffect(() => {
    setDraft((current) => ({
      ...current,
      manager: customManager ? current.manager : connectedAddress ?? suggestedManagerAddress,
      feeRecipient: customFeeRecipient
        ? current.feeRecipient
        : connectedAddress ?? suggestedManagerAddress,
    }));
  }, [connectedAddress, customFeeRecipient, customManager]);

  if (!isTestnet) {
    return (
      <div className="appView">
        <AppPageHeader
          title="Create OTF"
          description="Deploy an onchain traded fund with immutable safety bounds."
          icon={<FilePlus2 size={18} />}
        />
        <section className="sectionCard depositsEmpty">
          <span><Network size={22} /></span>
          <h2>OTF creation is not available on Mainnet</h2>
          <p>No assets, adapters, or OTF deployments are supported on Robinhood Mainnet yet. Switch to Robinhood Testnet in Settings to continue.</p>
          <button className="secondaryAction" type="button" onClick={onBack}>
            <ArrowLeft size={14} />
            View OTFs
          </button>
        </section>
      </div>
    );
  }

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
        title="Create OTF"
        description="Deploy an onchain traded fund with immutable safety bounds."
        icon={<FilePlus2 size={18} />}
      />

      <div className="createLayout">
        <aside className="createSteps" aria-label="OTF creation progress">
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
                    <span>OTF name</span>
                    <input value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} placeholder="Technology Leaders" />
                  </label>
                  <label>
                    <span>OTF ticker</span>
                    <div className="tickerInput">
                      <span>OTF-</span>
                      <input
                        value={draft.symbol.slice(4)}
                        onChange={(event) => {
                          const suffix = event.target.value
                            .toUpperCase()
                            .replace(/[^A-Z0-9-]/g, "")
                            .slice(0, 16);
                          updateDraft("symbol", `OTF-${suffix}`);
                        }}
                        placeholder="TECH"
                        aria-label="OTF ticker suffix"
                      />
                    </div>
                    <small>The OTF- prefix is fixed.</small>
                  </label>
                </div>
                <label>
                  <span>Initial investment thesis</span>
                  <textarea value={draft.thesis} onChange={(event) => updateDraft("thesis", event.target.value)} rows={4} placeholder="Describe the portfolio mandate and investment rationale." />
                  <small>This begins the OTF&apos;s permanent, append-only thesis history.</small>
                </label>
                <div className="formGrid twoColumns">
                  <div className="addressRoleField">
                    <div className="addressRoleFieldHeader">
                      <label htmlFor="manager-address">Manager address</label>
                      <button
                        type="button"
                        onClick={() => setCustomManager((enabled) => !enabled)}
                      >
                        {customManager ? <Wallet size={12} /> : <Pencil size={12} />}
                        {customManager ? "Use creator wallet" : "Use custom address"}
                      </button>
                    </div>
                    <input
                      id="manager-address"
                      className={!isAddress(draft.manager) && draft.manager ? "invalid" : ""}
                      value={draft.manager}
                      readOnly={!customManager}
                      aria-readonly={!customManager}
                      onChange={(event) => updateDraft("manager", event.target.value)}
                      placeholder="0x..."
                    />
                    <small>
                      {customManager
                        ? "Custom manager may propose rebalances and amend the thesis."
                        : connectedAddress
                          ? "Locked to the wallet creating this OTF."
                          : "Connect a wallet to use the creator address."}
                    </small>
                  </div>
                  <div className="addressRoleField">
                    <div className="addressRoleFieldHeader">
                      <label htmlFor="fee-recipient-address">Fee recipient</label>
                      <button
                        type="button"
                        onClick={() => setCustomFeeRecipient((enabled) => !enabled)}
                      >
                        {customFeeRecipient ? <Wallet size={12} /> : <Pencil size={12} />}
                        {customFeeRecipient ? "Use creator wallet" : "Use custom address"}
                      </button>
                    </div>
                    <input
                      id="fee-recipient-address"
                      className={!isAddress(draft.feeRecipient) && draft.feeRecipient ? "invalid" : ""}
                      value={draft.feeRecipient}
                      readOnly={!customFeeRecipient}
                      aria-readonly={!customFeeRecipient}
                      onChange={(event) => updateDraft("feeRecipient", event.target.value)}
                      placeholder="0x..."
                    />
                    <small>
                      {customFeeRecipient
                        ? "Custom address receives accrued creator-fee shares."
                        : connectedAddress
                          ? "Locked to the wallet creating this OTF."
                          : "Connect a wallet to use the creator address."}
                    </small>
                  </div>
                </div>
              </div>
            ) : null}

            {step === 1 ? (
              <div className="formSection">
                <div className="formIntro">
                  <div>
                    <strong>Initial target portfolio</strong>
                    <span>Select from the approved testnet asset catalog.</span>
                  </div>
                  <span className={`stateBadge ${totalWeightValid ? "success" : "danger"}`}>Total {totalWeight.toFixed(1)}%</span>
                </div>
                <div className="createAssetList">
                  {portfolio.map((asset, index) => (
                    <div className="createAssetRow" key={`${asset.ticker}-${index}`}>
                      <label>
                        <span>Asset</span>
                        <select
                          value={asset.address}
                          onChange={(event) => {
                            const selected = testnetCreateAssets.find((candidate) => candidate.address === event.target.value);
                            if (selected) {
                              updatePortfolio(index, { ticker: selected.symbol, address: selected.address });
                            }
                          }}
                        >
                          {testnetCreateAssets.map((candidate) => (
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
                        <small className="assetAddressLabel" title={asset.address}>Token: {shortAssetAddress(asset.address)}</small>
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
                    <div><strong>OTF deployment confirmed</strong><span>The new OTF is ready for initial funding and management.</span></div>
                    <button className="secondaryAction" type="button" onClick={onBack}>View in OTFs</button>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="createFormActions">
              <button className="secondaryAction" type="button" onClick={() => step === 0 ? onBack() : setStep((current) => current - 1)}>
                <ArrowLeft size={14} />
                {step === 0 ? "Back to OTFs" : "Back"}
              </button>
              {step < steps.length - 1 ? (
                <button className="primaryAction" type="button" disabled={!stepValid} onClick={() => setStep((current) => current + 1)}>
                  Continue
                  <ArrowRight size={14} />
                </button>
              ) : (
                <button className="primaryAction" type="button" disabled={!stepValid || deployState === "pending" || deployState === "submitted" || deployState === "confirmed"} onClick={() => runMockTx(setDeployState)}>
                  <FilePlus2 size={14} />
                  Deploy OTF
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
  isTestnet,
  onBrowseVaults,
  onOpenVault,
}: {
  connectedAddress?: string;
  currentVault: VaultView;
  isTestnet: boolean;
  onBrowseVaults: () => void;
  onOpenVault: () => void;
}) {
  const canReadBalances = isTestnet && Boolean(connectedAddress && isAddress(connectedAddress));
  const balanceContracts = canReadBalances
    ? testnetCreateAssets.flatMap((asset) => [
        {
          address: asset.address as `0x${string}`,
          abi: erc20BalanceAbi,
          functionName: "balanceOf" as const,
          args: [connectedAddress as `0x${string}`],
          chainId: robinhoodChainTestnet.id,
        },
        {
          address: asset.address as `0x${string}`,
          abi: erc20BalanceAbi,
          functionName: "decimals" as const,
          chainId: robinhoodChainTestnet.id,
        },
      ])
    : [];
  const { data: balanceResults, isLoading: balancesLoading } = useReadContracts({
    contracts: balanceContracts,
    query: { enabled: canReadBalances },
  });
  const walletAssets = testnetCreateAssets
    .map((asset, index) => {
      const balance = balanceResults?.[index * 2]?.result as bigint | undefined;
      const decimals = Number(balanceResults?.[index * 2 + 1]?.result ?? 18);
      return {
        ...asset,
        balance,
        catalogOrder: index,
        displayBalance: balancesLoading ? "Loading" : formatWalletTokenBalance(balance, decimals),
      };
    })
    .sort((left, right) => {
      const heldDifference = Number((right.balance ?? 0n) > 0n) - Number((left.balance ?? 0n) > 0n);
      return heldDifference || left.catalogOrder - right.catalogOrder;
    });
  const heldAssetCount = walletAssets.filter((asset) => (asset.balance ?? 0n) > 0n).length;

  if (!isTestnet) {
    return (
      <div className="appView">
        <AppPageHeader
          title="My wallet"
          description="View OTF positions and supported RWA assets held by this wallet."
          icon={<Wallet size={18} />}
          actions={
            <button className="secondaryAction" type="button" onClick={onBrowseVaults}>
              <LayoutGrid size={14} />
              Explore OTFs
            </button>
          }
        />
        <div className="depositMetrics">
          <MetricCard label="OTF Positions" value="0" icon={<CircleDollarSign size={14} />} sub="No Mainnet deployments" />
          <MetricCard label="RWA Assets" value="0" icon={<Coins size={14} />} sub="No supported assets" />
          <MetricCard label="OTF Return" value="—" icon={<TrendingUp size={14} />} sub="No position history" />
          <MetricCard label="Network" value="Mainnet" icon={<Network size={14} />} sub="Support not launched" />
        </div>
        <section className="sectionCard depositsEmpty">
          <span><Network size={22} /></span>
          <h2>Robinhood Mainnet is not supported yet</h2>
          <p>This app has no Mainnet OTFs, asset catalog, or wallet integrations. Switch to Robinhood Testnet in Settings to use the current deployment.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="appView">
      <AppPageHeader
        title="My wallet"
        description="View OTF positions and supported RWA assets held by this wallet."
        icon={<Wallet size={18} />}
        actions={
          <>
            <a
              className="secondaryAction"
              href="https://faucet.testnet.chain.robinhood.com/"
              target="_blank"
              rel="noreferrer"
            >
              <Droplets size={14} />
              Testnet faucet
              <ExternalLink size={12} />
            </a>
            <button className="secondaryAction" type="button" onClick={onBrowseVaults}>
              <LayoutGrid size={14} />
              Explore OTFs
            </button>
          </>
        }
      />

      {connectedAddress ? (
        <>
          <div className="depositMetrics">
            <MetricCard label="OTF Value" value="$22,184.32" icon={<CircleDollarSign size={14} />} sub="Across 2 positions" />
            <MetricCard label="RWA Holdings" value={String(heldAssetCount)} icon={<Coins size={14} />} sub={`${testnetCreateAssets.length} supported assets scanned`} />
            <MetricCard label="OTF Return" value="+$741.52" icon={<TrendingUp size={14} />} tone="success" sub="+3.46% all time" />
            <MetricCard label="Wallet" value={shortAddress(connectedAddress)} icon={<Wallet size={14} />} sub="Robinhood Testnet" />
          </div>

          <section className="sectionCard depositPositions">
            <div className="directoryPanelHeading">
              <div>
                <h2>OTF positions</h2>
                <p>Balances are valued with the same fresh onchain prices used by each OTF.</p>
              </div>
              <span className="stateBadge muted">2 positions</span>
            </div>
            <div className="directoryTableWrap">
              <table className="directoryTable depositsTable">
                <thead>
                  <tr>
                    <th>OTF</th>
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

          <section className="sectionCard walletAssets">
            <div className="directoryPanelHeading">
              <div>
                <h2>Supported RWA assets</h2>
                <p>Protocol-approved assets and their current balances in this wallet.</p>
              </div>
              <span className="stateBadge muted">{heldAssetCount} held · {testnetCreateAssets.length} supported</span>
            </div>
            <div className="directoryTableWrap">
              <table className="directoryTable rwaAssetsTable">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Token address</th>
                    <th>Wallet balance</th>
                  </tr>
                </thead>
                <tbody>
                  {walletAssets.map((asset) => (
                    <tr className={(asset.balance ?? 0n) === 0n ? "emptyBalance" : ""} key={asset.address}>
                      <td>
                        <div className="rwaAssetIdentity">
                          <strong>{asset.symbol}</strong>
                          <small>{asset.name}</small>
                        </div>
                      </td>
                      <td className="monoValue" title={asset.address}>{shortAssetAddress(asset.address)}</td>
                      <td className="monoValue">{asset.displayBalance}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <section className="sectionCard depositsEmpty">
          <span><Wallet size={22} /></span>
          <h2>Connect your wallet to view holdings</h2>
          <p>Your OTF positions and supported RWA asset balances will appear here after connecting.</p>
          <button className="secondaryAction" type="button" onClick={onBrowseVaults}>
            <LayoutGrid size={14} />
            Browse OTFs
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
          OTFs
        </button>
        <span>/</span>
        <button type="button" onClick={onOpenVault}>{vault.name}</button>
        <span>/</span>
        <strong>Manage</strong>
      </div>
      <AppPageHeader
        title="Manage"
        description="Administer OTF roles and routine protocol operations."
        icon={<UserCog size={18} />}
        actions={
          <button className="secondaryAction" type="button" onClick={onOpenVault}>
            Open OTF
            <ChevronRight size={14} />
          </button>
        }
      />

      <section className="manageVaultHeader">
        <div className="vaultIdentity">
          <span className="vaultMonogram">TECH</span>
          <div>
            <div className="titleLine"><h2>{vault.name}</h2><span className="symbolBadge">{vault.symbol}</span></div>
            <div className="addressLine"><AddressPill label="OTF" address={vault.address} copied={copied} onCopy={copyVaultAddress} /></div>
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

      <ManagerRebalanceBuilder vault={vault} />

      <div className="manageGrid">
        <SectionCard title="Manager transfer" subtitle="Nominate a new portfolio manager" icon={<KeyRound size={15} />} action={<span className="stateBadge muted">Two-step</span>}>
          <div className="operationFlow">
            <div className="roleCurrent"><span>Current manager</span><strong>{shortAddress(vault.manager)}</strong></div>
            <label className="fieldLabel">New manager address</label>
            <input className={!managerValid && managerTarget ? "invalid" : ""} value={managerTarget} onChange={(event) => setManagerTarget(event.target.value)} placeholder="0x..." />
            <p>The nominee must accept onchain before the role changes. Portfolio assets never leave the OTF.</p>
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

        <ThesisAmendmentCard currentThesis={vault.currentThesis} canManage={vault.connectedIsManager} />

        <SectionCard title="Manager permissions" subtitle="Capabilities constrained by the OTF contract" icon={<ShieldCheck size={15} />} action={<span className="stateBadge muted">Onchain</span>}>
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
