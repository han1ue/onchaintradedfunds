"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { managedOtfVaultAbi } from "@onchaintradedfunds/generated";
import { isAddress } from "viem";
import { useReadContracts } from "wagmi";
import { formatCooldown, formatTimestamp } from "@/lib/time";

type ReadResult = readonly [
  { result?: number },
  { result?: bigint },
  { result?: bigint },
  { result?: boolean },
];

function configuredVaultAddress(): `0x${string}` | undefined {
  const value = process.env.NEXT_PUBLIC_EXAMPLE_VAULT_ADDRESS;
  return value && isAddress(value) ? value : undefined;
}

export function RebalanceCooldownPanel() {
  const vaultAddress = configuredVaultAddress();
  const enabled = Boolean(vaultAddress);

  const { data, error, isLoading } = useReadContracts({
    contracts: enabled
      ? [
          {
            address: vaultAddress,
            abi: managedOtfVaultAbi,
            functionName: "rebalanceCooldown",
          },
          {
            address: vaultAddress,
            abi: managedOtfVaultAbi,
            functionName: "lastRebalanceTimestamp",
          },
          {
            address: vaultAddress,
            abi: managedOtfVaultAbi,
            functionName: "nextRebalanceTime",
          },
          {
            address: vaultAddress,
            abi: managedOtfVaultAbi,
            functionName: "canRebalance",
          },
        ]
      : [],
    query: { enabled },
  });

  const results = data as ReadResult | undefined;
  const cooldownSeconds = Number(results?.[0]?.result ?? 7 * 86_400);
  const lastPortfolioChange = results?.[1]?.result ? Number(results[1].result) : undefined;
  const nextPortfolioChange = results?.[2]?.result ? Number(results[2].result) : undefined;
  const canRebalance = Boolean(results?.[3]?.result);

  return (
    <section className="cooldownPanel" aria-label="Rebalance cooldown">
      <div className="panelHeader">
        <div>
          <p className="eyebrow">Vault Controls</p>
          <h1>Onchain Traded Funds</h1>
        </div>
        <ConnectButton />
      </div>

      <dl className="cooldownGrid">
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

      <div className={canRebalance ? "status ready" : "status waiting"}>
        {enabled
          ? canRebalance
            ? "Rebalance transaction window is open."
            : "Cooldown is still active."
          : "Set NEXT_PUBLIC_EXAMPLE_VAULT_ADDRESS to read a live vault."}
      </div>

      {error ? <p className="errorText">Unable to read cooldown data from the configured vault.</p> : null}
    </section>
  );
}
