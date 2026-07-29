"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { managedOtfVaultAbi } from "@onchaintradedfunds/generated";
import {
  Activity,
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  BadgeCent,
  BookOpen,
  ChartPie,
  CheckCircle,
  ChevronDown,
  Clock3,
  Coins,
  Copy,
  Droplets,
  ExternalLink,
  HeartPulse,
  Info,
  ListChecks,
  Loader2,
  LockKeyhole,
  Plus,
  RefreshCw,
  Scale,
  Settings,
  ShieldCheck,
  Trash2,
  TrendingUp,
  Wallet,
  XCircle,
  Zap,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { formatUnits, isAddress } from "viem";
import { useAccount, useReadContracts } from "wagmi";
import {
  formatCooldown,
  formatRelativeAvailability,
  formatTimestamp,
  progressThroughCooldown,
} from "@/lib/time";

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

const navTabs = ["Vaults", "Create", "Manage", "Docs"];

const demoAllocations: Allocation[] = [
  {
    symbol: "mNVDA",
    name: "Mock NVDA",
    address: "0x2E4c81aB04A82F5dD3e0cA7f1234567890A6612f",
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
    address: "0x5F91bCe20E82E85199b792A5595728117f8871Ab",
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
    address: "0xC70a3D6b0011391C3Df907c5d2dC180481A4d813",
    targetWeightBps: 2_500,
    actualWeightBps: 2_470,
    balance: "5,912.8830",
    price: "$176.55",
    oracleAge: "9m 04s ago",
    freshnessTone: "warning",
    tone: "gold",
  },
];

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
  const [activeTab, setActiveTab] = useState("Vaults");

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

  const { data, error, isLoading, refetch } = useReadContracts({
    contracts: readContracts,
    query: { enabled: Boolean(readContracts) },
  });

  const results = data as ReadResult | undefined;
  const vaultName = resultAt<string>(results, 0) ?? "Onchain Technology Leaders";
  const vaultSymbol = resultAt<string>(results, 1) ?? "OTF-TECH";
  const manager = resultAt<string>(results, 2);
  const feeRecipient = resultAt<string>(results, 3);
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
    address: vaultAddress,
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

  return (
    <div className="otfAppShell">
      <TopNav activeTab={activeTab} onTabChange={setActiveTab} onRefresh={() => void refetch()} />

      <main className="dashboardMain">
        <VaultHeader vault={vault} />
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

        <footer className="dashboardFooter">
          <span>Onchain Traded Funds · experimental, unaudited software</span>
          <span>ERC-4626 vault · Robinhood Testnet</span>
        </footer>
      </main>
    </div>
  );
}

function TopNav({
  activeTab,
  onTabChange,
  onRefresh,
}: {
  activeTab: string;
  onTabChange: (tab: string) => void;
  onRefresh: () => void;
}) {
  return (
    <header className="topNav">
      <div className="topNavInner">
        <div className="logoGroup">
          <div className="otfLogo">
            <TrendingUp size={16} />
          </div>
          <div className="brandText">
            <strong>Onchain Traded Funds</strong>
            <span>OTF protocol</span>
          </div>
        </div>

        <nav className="navTabs" aria-label="Primary navigation">
          {navTabs.map((tab) => (
            <button
              className={tab === activeTab ? "active" : ""}
              key={tab}
              type="button"
              onClick={() => onTabChange(tab)}
            >
              {tab}
            </button>
          ))}
        </nav>

        <div className="navActions">
          <button className="networkButton" type="button">
            <span className="networkDot" />
            Robinhood Testnet
            <ChevronDown size={14} />
          </button>
          <button className="iconOnly" type="button" onClick={onRefresh} title="Refresh vault data">
            <RefreshCw size={16} />
          </button>
          <button className="iconOnly" type="button" title="Settings">
            <Settings size={16} />
          </button>
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}

function VaultHeader({ vault }: { vault: VaultView }) {
  const [copied, setCopied] = useState<string | null>(null);

  function copy(value: string | undefined, key: string) {
    if (!value) return;
    void navigator.clipboard.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied(null), 1_500);
  }

  return (
    <section className="vaultHeader">
      <div className="vaultBreadcrumb">
        <button type="button">
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
              <span className="auditBadge">
                <AlertTriangle size={12} />
                Experimental · unaudited
              </span>
            </div>
            <div className="addressLine">
              <AddressPill label="Vault" address={vault.address} copied={copied === "vault"} onCopy={() => copy(vault.address, "vault")} />
              <AddressPill label="Manager" address={vault.manager} copied={copied === "manager"} onCopy={() => copy(vault.manager, "manager")} />
            </div>
          </div>
        </div>
        <div className="vaultMetaBadges">
          <span className="stateBadge muted">ERC-4626 · Testnet</span>
          <span className="stateBadge info">v1.2.0</span>
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
        label="Rebalance"
        value={vault.canRebalance ? "Available" : "Cooling down"}
        icon={<Activity size={14} />}
        tone={vault.canRebalance ? "success" : "warning"}
        sub={formatRelativeAvailability(vault.nextPortfolioChange)}
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
    <span className="addressPill">
      <span>{label}</span>
      <strong>{shortAddress(address)}</strong>
      <button type="button" onClick={onCopy} title={`Copy ${label.toLowerCase()} address`}>
        {copied ? <CheckCircle size={13} /> : <Copy size={13} />}
      </button>
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
        <TimelineItem label="Next available" value={vault.canRebalance ? "Now" : formatTimestamp(vault.nextPortfolioChange)} icon={<Activity size={13} />} status={vault.canRebalance ? "open" : "locked"} />
        <TimelineItem label="State" value={vault.canRebalance ? "Unlocked" : "Locked"} icon={<Activity size={13} />} status={vault.canRebalance ? "open" : "locked"} />
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
      <div className="safetyGuarantees">
        <span><CheckCircle size={12} /> Approved assets only</span>
        <span><CheckCircle size={12} /> Approved adapters only</span>
        <span><CheckCircle size={12} /> Atomic execution</span>
      </div>
      <p className="safetyFootnote">The manager may rotate assets only inside these bounds and cannot transfer vault assets out.</p>
    </SectionCard>
  );
}
