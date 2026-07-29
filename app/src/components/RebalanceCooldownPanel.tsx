"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { managedOtfVaultAbi } from "@onchaintradedfunds/generated";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Clock3,
  ExternalLink,
  Gauge,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
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

type Allocation = {
  symbol: string;
  address: string;
  weightBps: number;
  tone: string;
};

const demoAllocations: Allocation[] = [
  {
    symbol: "mNVDA",
    address: "0x1111111111111111111111111111111111111111",
    weightBps: 4_000,
    tone: "teal",
  },
  {
    symbol: "mMSFT",
    address: "0x2222222222222222222222222222222222222222",
    weightBps: 3_500,
    tone: "blue",
  },
  {
    symbol: "mGOOGL",
    address: "0x3333333333333333333333333333333333333333",
    weightBps: 2_500,
    tone: "gold",
  },
];

const allocationTones = ["teal", "blue", "gold", "rose", "violet", "green"];

function configuredVaultAddress(): `0x${string}` | undefined {
  const value = process.env.NEXT_PUBLIC_EXAMPLE_VAULT_ADDRESS;
  return value && isAddress(value) ? value : undefined;
}

function shortAddress(address?: string): string {
  if (!address) return "Not configured";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function bpsToPercent(value?: number): string {
  if (value === undefined) return "Not available";
  return `${(value / 100).toFixed(value % 100 === 0 ? 0 : 2)}%`;
}

function resultAt<T extends ContractValue>(results: ReadResult | undefined, index: number): T | undefined {
  return results?.[index]?.result as T | undefined;
}

function normalizeAllocations(
  assets?: readonly string[],
  weights?: readonly number[] | readonly bigint[],
): Allocation[] {
  if (!assets?.length || !weights?.length) return demoAllocations;

  return assets.map((address, index) => ({
    symbol: `Asset ${index + 1}`,
    address,
    weightBps: Number(weights[index] ?? 0),
    tone: allocationTones[index % allocationTones.length],
  }));
}

export function RebalanceCooldownPanel() {
  const vaultAddress = configuredVaultAddress();
  const enabled = Boolean(vaultAddress);
  const { address: connectedAddress } = useAccount();

  const { data, error, isLoading, refetch } = useReadContracts({
    contracts: enabled
      ? [
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
        ]
      : [],
    query: { enabled },
  });

  const results = data as ReadResult | undefined;
  const vaultName = resultAt<string>(results, 0) ?? "Onchain Technology Leaders";
  const vaultSymbol = resultAt<string>(results, 1) ?? "OTF-TECH";
  const manager = resultAt<string>(results, 2);
  const feeRecipient = resultAt<string>(results, 3);
  const creatorFeeBps = resultAt<number>(results, 4) ?? 20;
  const protocolFeeShareBps = resultAt<number>(results, 5) ?? 1_500;
  const totalSupply = resultAt<bigint>(results, 6);
  const assets = resultAt<readonly string[]>(results, 7);
  const targetWeights = resultAt<readonly number[] | readonly bigint[]>(results, 8);
  const maxTurnoverBps = resultAt<number>(results, 9) ?? 2_500;
  const maxNavLossBps = resultAt<number>(results, 10) ?? 100;
  const maxWeightDeviationBps = resultAt<number>(results, 11) ?? 50;
  const maxAssetCount = resultAt<number>(results, 12) ?? 10;
  const currentThesis =
    resultAt<string>(results, 13) ??
    "A transparent, actively managed basket of approved stock tokens with immutable safety limits.";
  const cooldownSeconds = Number(resultAt<number>(results, 14) ?? 7 * 86_400);
  const lastPortfolioChange = resultAt<bigint>(results, 15)
    ? Number(resultAt<bigint>(results, 15))
    : undefined;
  const nextPortfolioChange = resultAt<bigint>(results, 16)
    ? Number(resultAt<bigint>(results, 16))
    : undefined;
  const canRebalance = Boolean(resultAt<boolean>(results, 17));
  const allocations = normalizeAllocations(assets, targetWeights);
  const cooldownProgress = progressThroughCooldown(lastPortfolioChange, nextPortfolioChange);
  const connectedIsManager =
    connectedAddress && manager && connectedAddress.toLowerCase() === manager.toLowerCase();
  const supplyDisplay = totalSupply ? Number(formatUnits(totalSupply, 18)).toLocaleString() : "Demo";

  return (
    <div className="vaultShell">
      <header className="topBar">
        <div className="brandBlock">
          <div className="brandMark" aria-hidden="true">
            OT
          </div>
          <div>
            <p className="eyebrow">Onchain Traded Funds</p>
            <h1>{vaultName}</h1>
            <div className="metaRow">
              <span>{vaultSymbol}</span>
              <span>{enabled ? shortAddress(vaultAddress) : "Demo vault"}</span>
              <span>{enabled ? "Live RPC reads" : "Set NEXT_PUBLIC_EXAMPLE_VAULT_ADDRESS"}</span>
            </div>
          </div>
        </div>
        <div className="walletCluster">
          <button className="iconButton" type="button" onClick={() => void refetch()} title="Refresh vault data">
            <RefreshCw size={18} />
          </button>
          <ConnectButton />
        </div>
      </header>

      <section className="noticeStrip" aria-label="Risk notice">
        <AlertTriangle size={18} />
        <span>Experimental, unaudited MVP. Oracle-dependent actions fail closed when prices are stale.</span>
      </section>

      <section className="overviewGrid" aria-label="Vault overview">
        <article className="metricCard primaryMetric">
          <div className="metricLabel">
            <Activity size={16} />
            Rebalance status
          </div>
          <strong>{enabled ? (canRebalance ? "Ready" : "Cooling down") : "Demo mode"}</strong>
          <span>{formatRelativeAvailability(nextPortfolioChange)}</span>
        </article>

        <article className="metricCard">
          <div className="metricLabel">
            <Clock3 size={16} />
            Rebalance cooldown
          </div>
          <strong>{isLoading ? "Loading" : formatCooldown(cooldownSeconds)}</strong>
          <span>Minimum delay between successful portfolio changes</span>
        </article>

        <article className="metricCard">
          <div className="metricLabel">
            <WalletCards size={16} />
            Share supply
          </div>
          <strong>{supplyDisplay}</strong>
          <span>Vault ERC-20 shares</span>
        </article>

        <article className="metricCard">
          <div className="metricLabel">
            <Gauge size={16} />
            Creator fee
          </div>
          <strong>{bpsToPercent(creatorFeeBps)} / yr</strong>
          <span>{bpsToPercent(protocolFeeShareBps)} of minted fee shares to protocol</span>
        </article>
      </section>

      <section className="contentGrid">
        <article className="panel allocationPanel">
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">Portfolio</p>
              <h2>Target allocation</h2>
            </div>
            <span className="softPill">{allocations.length} assets</span>
          </div>

          <div className="allocationBar" aria-hidden="true">
            {allocations.map((asset) => (
              <span
                className={`allocationSegment ${asset.tone}`}
                key={asset.address}
                style={{ width: `${asset.weightBps / 100}%` }}
              />
            ))}
          </div>

          <div className="assetList">
            {allocations.map((asset) => (
              <div className="assetRow" key={asset.address}>
                <div className="assetIdentity">
                  <span className={`assetDot ${asset.tone}`} />
                  <div>
                    <strong>{asset.symbol}</strong>
                    <span>{shortAddress(asset.address)}</span>
                  </div>
                </div>
                <strong>{bpsToPercent(asset.weightBps)}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="panel cooldownPanel" aria-label="Rebalance cooldown">
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">Cooldown</p>
              <h2>Portfolio change window</h2>
            </div>
            <span className={enabled && canRebalance ? "statePill ready" : "statePill waiting"}>
              {enabled && canRebalance ? "Open" : "Locked"}
            </span>
          </div>

          <div className="timeline">
            <div className="timelineTrack">
              <span style={{ width: `${cooldownProgress}%` }} />
            </div>
            <div className="timelineLabels">
              <span>Last change</span>
              <span>{cooldownProgress}%</span>
              <span>Next window</span>
            </div>
          </div>

          <dl className="detailList">
            <div>
              <dt>Rebalance cooldown:</dt>
              <dd>{isLoading ? "Loading" : formatCooldown(cooldownSeconds)}</dd>
            </div>
            <div>
              <dt>Last portfolio change:</dt>
              <dd>{formatTimestamp(lastPortfolioChange)}</dd>
            </div>
            <div>
              <dt>Next portfolio change available:</dt>
              <dd>{formatTimestamp(nextPortfolioChange)}</dd>
            </div>
          </dl>
        </article>

        <article className="panel thesisPanel">
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">Thesis</p>
              <h2>Manager rationale</h2>
            </div>
            <ShieldCheck size={20} />
          </div>
          <p>{currentThesis}</p>
        </article>

        <article className="panel safetyPanel">
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">Safety</p>
              <h2>Immutable limits</h2>
            </div>
            <LockKeyhole size={20} />
          </div>
          <div className="limitGrid">
            <div>
              <span>Turnover cap</span>
              <strong>{bpsToPercent(maxTurnoverBps)}</strong>
            </div>
            <div>
              <span>NAV loss cap</span>
              <strong>{bpsToPercent(maxNavLossBps)}</strong>
            </div>
            <div>
              <span>Weight drift</span>
              <strong>{bpsToPercent(maxWeightDeviationBps)}</strong>
            </div>
            <div>
              <span>Asset limit</span>
              <strong>{maxAssetCount}</strong>
            </div>
          </div>
        </article>
      </section>

      <section className="managerDock" aria-label="Manager actions">
        <div>
          <p className="eyebrow">Manager</p>
          <h2>{shortAddress(manager)}</h2>
          <span>Fee recipient: {shortAddress(feeRecipient)}</span>
        </div>
        <div className="actionCluster">
          <button className="commandButton" type="button" disabled={!enabled || !connectedIsManager}>
            Amend thesis
            <ArrowRight size={16} />
          </button>
          <button className="commandButton primary" type="button" disabled={!enabled || !connectedIsManager || !canRebalance}>
            Build rebalance
            <ExternalLink size={16} />
          </button>
        </div>
      </section>

      {error ? (
        <p className="errorText">Unable to read live vault data. The dashboard is showing fallback values.</p>
      ) : null}
    </div>
  );
}
